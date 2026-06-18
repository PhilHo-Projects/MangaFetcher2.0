# Auth & Public Demo Mode — Design

**Date:** 2026-06-18
**Status:** Approved (ready for implementation plan)

## Problem

The manga tracker is being linked from a portfolio as a showcase. Today every
request is hardcoded to `USER_ID = 1` (see `server.js:20`), so any visitor can
view **and modify** the owner's tracked manga. We need:

1. **Authentication** so the owner (phil) signs in once and manages a private
   library, with the session remembered across visits (cookie).
2. A **public demo** for logged-out visitors: a separate, pre-populated library
   (One Piece + Kagurabachi) that anyone may play with but that **resets daily**
   to a clean snapshot.
3. The daily job keeps the owner's library fresh **and** resets/re-seeds the
   demo so it always displays the 3 newest chapters per demo title.
4. A real, multi-user-capable backend (hashed passwords, sessions, user-scoped
   data) so additional accounts could be added later — **without** building a
   public sign-up flow now.

## Decisions (locked during brainstorming)

- **Accounts scope:** Multi-user-ready backend, seeded with `phil` / `0000`. No
  public sign-up UI/endpoint yet.
- **Demo model:** A single **shared** demo library. All anonymous visitors share
  it; concurrent visitors see each other's edits. Resets daily. (Per-visitor
  isolation is explicitly out of scope.)
- **Auth mechanism:** Stateless signed cookie + `crypto.scrypt` password hashing.
  No new npm dependencies.
- **phil = existing `user_id` 1**, so the live tracked library is preserved.
- **Demo reset rides the same daily 6 AM scheduler tick** as the owner sync
  (implemented as an isolated function so it can be split out later).

## Architecture Overview

```
Browser ──cookie──▶ auth middleware ──sets req.userId──▶ existing API handlers
                          │
                          ├─ valid session  → owner (phil)
                          └─ no/invalid      → demo user

scheduler (daily 6 AM, in-process setTimeout)
   ├─ refreshAllTrackedManga(ownerId)   (existing behavior)
   └─ resetDemoAccount()                (new: wipe + re-seed demo)
```

The central change is replacing the hardcoded `USER_ID = 1` with a per-request
`req.userId` derived from the session cookie. Every existing data endpoint then
operates on the correct account with no per-endpoint branching.

## Component Design

### 1. Auth module (`auth.js`, new)

Responsibilities: password hashing/verification, cookie signing/verification,
and the Express middleware that resolves the effective user.

- **Password hashing:** `crypto.scrypt`. Stored as `scrypt$<saltHex>$<hashHex>`.
  - `hashPassword(plain) -> string`
  - `verifyPassword(plain, stored) -> boolean` (constant-time compare via
    `crypto.timingSafeEqual`).
- **Session secret:** read from `SESSION_SECRET` env. If unset, generate a random
  32-byte secret and persist it to `<dataDir>/session-secret` (the data dir is
  preserved across deploys), so logins survive restarts without manual env setup.
- **Cookie token format:** `base64url(userId).<expiryEpochMs>.<hmacHex>` where
  `hmac = HMAC-SHA256(secret, "<base64url(userId)>.<expiryEpochMs>")`.
  - `createSessionToken(userId, ttlMs) -> token`
  - `verifySessionToken(token) -> { userId } | null` (rejects bad signature or
    past expiry).
- **Cookie name:** `mt_session`. Attributes: `HttpOnly`, `SameSite=Lax`,
  `Path=<BASE_PATH or '/'>`, `Secure` when `NODE_ENV === 'production'`,
  `Max-Age` = 30 days ("remember me" is always on for now).
- **Cookie reading:** parse `req.headers.cookie` manually (small helper) to avoid
  adding `cookie-parser`. Cookies are written with the built-in Express
  `res.cookie()` / `res.clearCookie()`.
- **Middleware `attachUser(req, res, next)`:** verify the cookie; on success set
  `req.user = { id, username, role }` from the DB and `req.userId = id`. On
  failure set `req.user` = the demo user and `req.userId` = demo id. Resolve and
  cache the demo user id at startup.
- **Guard `requireOwner(req, res, next)`:** 403 unless `req.user.role === 'owner'`.

### 2. Database changes (`db.js`)

**`users` table — add columns (idempotent `ensureColumn`):**
- `password_hash TEXT`
- `role TEXT DEFAULT 'user'`

**Seeding on startup (idempotent, safe for live data):**
- Owner: ensure user_id 1 exists; if its username is still `default_user`, set it
  to `ADMIN_USERNAME` (default `phil`); if `password_hash` is null, set it from
  `ADMIN_PASSWORD` (default `0000`); set `role='owner'`. Never overwrite an
  already-set username/password (idempotent across restarts).
- Demo: ensure a user with username `DEMO_USERNAME` (default `demo`) exists with
  `role='demo'`.

**`unread_backlog` — make user-scoped (schema migration):**
- Target schema:
  ```sql
  CREATE TABLE unread_backlog (
    user_id INTEGER NOT NULL,
    manga_id TEXT NOT NULL,
    chapter_number INTEGER NOT NULL,
    detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, manga_id, chapter_number)
  );
  ```
- Migration: if `PRAGMA table_info(unread_backlog)` lacks a `user_id` column,
  rename the existing table to `unread_backlog_legacy`, create the new table,
  `INSERT INTO unread_backlog SELECT 1 AS user_id, manga_id, chapter_number,
  detected_at FROM unread_backlog_legacy` (assigns existing rows to owner = user
  1), then drop the legacy table. Wrapped in a transaction.
- Update the index to `(user_id, manga_id, chapter_number DESC)`.
- Thread `userId` through these functions (and their callers): `replaceUnreadBacklog`,
  `addUnreadBacklogEntries`, `getUnreadBacklog`, `getUnreadBacklogCount`,
  `getHighestUnreadBacklogChapter`, `clearUnreadBacklogThroughChapter`. The
  `advanceProgressToChapter` function already takes `userId`; its internal
  `DELETE FROM unread_backlog` becomes user-scoped.
- New helper `resetUserLibrary(userId)`: in one transaction, delete the user's
  rows from `tracked_manga`, `read_chapters`, and `unread_backlog` (used by the
  demo reset).

**Unchanged (global provider caches):** `chapter_cache`, `manga_cache_state`.
Verified that their only non-global reader, `getLegacyUnreadCount`, is used solely
by the legacy `provider-migration.js` path, which already passes `userId` for the
`read_chapters` side. No user-scoping needed there.

### 3. Server endpoints (`server.js`)

- Remove the `USER_ID = 1` constant. Mount `attachUser` middleware before the API
  routes. Replace all `USER_ID` usages with `req.userId`.
- **New:**
  - `POST /api/login` — body `{ username, password }`. Verify against `users`.
    On success set the session cookie and return `{ success: true, username,
    role }`. On failure return 401 `{ error: 'Invalid credentials' }`.
  - `POST /api/logout` — clear the cookie, return `{ success: true }`.
  - `GET /api/me` — return `{ authenticated: boolean, username, role,
    isDemo: boolean }`.
- **Changed:** `POST /api/refresh` is wrapped with `requireOwner` (403 for demo /
  anonymous). All other data endpoints work unchanged for both owner and demo via
  `req.userId`.
- `refreshAllTrackedManga` / `getTrackedMangaForSync` target the **owner id** (1)
  for the daily sync, so the demo is not double-processed by the sync path.

### 4. Demo snapshot & reset (`demo-snapshot.js` + `demo.js`, new)

- `demo-snapshot.js`: exported array of demo titles, each
  `{ providerSeriesId, title, sourceUrl }`. Series IDs for One Piece and
  Kagurabachi are resolved during implementation via the MangaUpdates search API
  and hardcoded here. `PREVIEW_COUNT = 3`.
- `demo.js` `resetDemoAccount()`:
  1. `resetUserLibrary(demoUserId)`.
  2. For each snapshot title: `getSeriesDetails(providerSeriesId)` to get
     `latestChapter`; `trackManga(demoUserId, …)` with
     `lastReadChapterNumber = max(latest - 3, 0)`; `replaceUnreadBacklog(
     demoUserId, [latest-2 … latest], detectedAt = now)`.
  3. On provider failure for a title, log and continue (best-effort; demo stays
     populated with whatever succeeded).
- Reuses the existing "latest − 3 → 3 newest unread, dated now" seeding semantics
  already present in the track endpoint, so the demo always shows 3 fresh chapters.

### 5. Scheduler (`scheduler.js`)

- After `refreshAllTrackedManga()` in the daily tick, call `resetDemoAccount()`
  (failures logged, never crash the tick).
- On startup, if the demo library is empty, run `resetDemoAccount()` once so the
  first deploy populates the demo immediately.

### 6. Frontend (`public/`)

- **Header (`index.html` + `app.js`):** top-right auth control.
  - Logged out: `SIGN IN` button + a slim banner "Public demo — changes reset
    daily."
  - Logged in: username label + `SIGN OUT` button.
- **Login modal:** reuse existing `.modal` styling; username + password inputs +
  submit; on success refresh data and header.
- On `DOMContentLoaded`, call `GET /api/me` to render header state; hide the
  manual refresh (↻) button when `isDemo` (endpoint is owner-only).
- `fetch` calls include `credentials: 'same-origin'` so the cookie is always sent.

### 7. Configuration / ops

New optional env vars (all have safe defaults; document in README + reference in
`ecosystem.config.js`):
- `ADMIN_USERNAME` (default `phil`)
- `ADMIN_PASSWORD` (default `0000`)
- `DEMO_USERNAME` (default `demo`)
- `SESSION_SECRET` (auto-generated + persisted to `<dataDir>/session-secret` if
  unset)

The deploy workflow already preserves the `data/` directory across deploys, so
the DB and the persisted session secret survive.

## Testing

Following the existing `node --test` + temp-DB-via-`MANGA_TRACKER_DB_PATH`
pattern:

- **auth unit:** `hashPassword`/`verifyPassword` round-trip and rejection;
  `createSessionToken`/`verifySessionToken` for valid, tampered, and expired
  tokens.
- **middleware:** valid cookie → owner; missing/invalid cookie → demo.
- **endpoints:** `POST /api/login` success + failure; `GET /api/me` reflects
  state; `POST /api/refresh` returns 403 for demo and 200 for owner.
- **user isolation:** owner and demo each tracking the same manga_id keep
  separate `unread_backlog`; marking read / resetting one does not affect the
  other.
- **demo reset:** `resetDemoAccount()` wipes prior demo state and re-seeds each
  snapshot title with exactly 3 unread chapters (latest − 2 … latest).

## Out of Scope (YAGNI)

- Public sign-up UI / `POST /api/register`.
- Per-visitor demo isolation.
- Rate-limiting anonymous `search` / `track` (low risk for a portfolio; can be
  added later).

## Risks / Notes

- **Shared demo concurrency:** two simultaneous anonymous visitors see each
  other's edits. Accepted per the demo-model decision.
- **`unread_backlog` migration is one-way** (adds `user_id`, assigns existing
  rows to owner). Safe because existing data belongs to the single current user.
  The deploy already backs up the DB before each release.
