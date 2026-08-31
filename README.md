# Manga Tracker

A multi-user, neo-brutalist manga tracker powered by MangaUpdates. Anonymous visitors can browse a read-only demo; approved accounts receive isolated libraries.

## Stack

- strict TypeScript and native ESM across server, browser, scripts, and tests
- Express 5, Better Auth 1.7.1, SQLite, Zod, and Helmet
- Vite for the vanilla DOM client and Vitest for tests
- multi-stage Node 24 Docker image running as the non-root `node` user

## Authentication

Better Auth is the only credential and session implementation. Public sign-up creates a pending account without a session. The owner approves or rejects it from `/admin`; approval creates one mapped integer application user, while rejection immediately revokes database sessions and preserves the library.

Production sessions last 30 days and use the literal cookie `__Host-mt_session` with `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, and no `Domain`. Unsafe API requests require an exact `PUBLIC_ORIGIN` match. Anonymous application access is default-deny except for health, session state, the demo library, chapters for a demo-tracked title, and the next-check time.

## Required configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `PUBLIC_ORIGIN` | always | Exact origin, such as `https://manga.philippeho.dev` |
| `SESSION_SECRET` | always | High-entropy secret of at least 32 characters |
| `MANGA_TRACKER_DB_PATH` | optional | SQLite file; defaults to `<data dir>/manga-tracker.db` |
| `MANGA_TRACKER_DATA_DIR` | optional | Persistent data directory; defaults to `data` |
| `PORT` | optional | HTTP port; defaults to `3001` |
| `OWNER_USERNAME` | bootstrap only | Owner username; all three owner values must be supplied together |
| `OWNER_EMAIL` | bootstrap only | Owner email |
| `OWNER_PASSWORD` | bootstrap only | Rotated owner password, at least 12 characters |

Owner bootstrap values are used only by the explicit database migration command. Remove them after migration; normal startup neither needs nor reads a standing owner password.

## Commands

```bash
npm ci
npm run dev
npm test
npm run lint
npm run typecheck
npm run build
npm run db:migrate
npm run db:verify
```

Schema changes are committed, versioned migrations. Application startup validates the current version and refuses an unknown, partial, or outdated schema; it never changes schema automatically.

## API outline

- Better Auth: `/api/auth/*`
- Public application state: `GET /api/me`, `GET /api/manga`, `GET /api/manga/:id/chapters`, `GET /api/next-check`
- Approved account: search, track, progress, source edit, and untrack routes
- Owner: `POST /api/refresh` and `/api/admin/users/*`

Errors use `{ "error": { "code": "...", "message": "...", "details": ... } }` outside Better Auth's own protocol endpoints.

## Production

Production is deployed by Coolify from the Git-backed Dockerfile. `/app/data` must be a persistent mount. Run the reviewed migration against a copied live database first, then run the explicit production migration before starting the new server image. Retain the pre-migration database and previous image for rollback.
