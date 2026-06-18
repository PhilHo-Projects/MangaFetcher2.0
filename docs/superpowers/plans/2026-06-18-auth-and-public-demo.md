# Auth & Public Demo Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add owner authentication (phil/0000) with a remembered cookie session, and a shared public demo (One Piece + Kagurabachi) that anyone may edit but which resets daily.

**Architecture:** A per-request `attachUser` middleware resolves the effective user from a signed HttpOnly cookie (owner) or falls back to a dedicated `demo` user. All existing data endpoints switch from the hardcoded `USER_ID = 1` to `req.userId`. The `unread_backlog` table becomes user-scoped so owner and demo never collide. A daily scheduler step resets and re-seeds the demo account.

**Tech Stack:** Node.js, Express 5, better-sqlite3, Node built-in `crypto` (scrypt + HMAC). No new npm dependencies. Tests use `node:test` with a temp DB via `MANGA_TRACKER_DATA_DIR`.

**Spec:** `docs/superpowers/specs/2026-06-18-auth-and-public-demo-design.md`

---

## File map

- **Create** `password.js` — pure password hashing/verification (`hashPassword`, `verifyPassword`). No dependencies.
- **Create** `auth.js` — session token + cookie helpers and Express middleware (`attachUser`, `requireOwner`, `setSessionCookie`, `clearSessionCookie`, `parseCookies`, `createSessionToken`, `verifySessionToken`). Requires `./db`.
- **Create** `demo-snapshot.js` — static list of demo titles + `PREVIEW_COUNT`.
- **Create** `demo.js` — `resetDemoAccount()`, `ensureDemoSeeded()`. Requires `./db`, `./demo-snapshot`, `./mangaupdates`.
- **Modify** `db.js` — add `password_hash`/`role` columns; seed owner + demo; user-scope `unread_backlog` (migration + signatures); add `resetUserLibrary`; export `dataDir`.
- **Modify** `chapter-service.js` — thread `userId` into backlog calls.
- **Modify** `provider-migration.js` — thread `userId` into `replaceUnreadBacklog`.
- **Modify** `server.js` — mount `attachUser`; replace `USER_ID` with `req.userId`; add `/api/login`, `/api/logout`, `/api/me`; gate `/api/refresh` with `requireOwner`; seed demo on startup.
- **Modify** `scheduler.js` — daily tick runs owner sync then demo reset.
- **Modify** `public/index.html`, `public/app.js`, `public/styles.css` — sign-in control, login modal, demo banner.
- **Modify** `ecosystem.config.js`, `README.md` — document new env vars.
- **Create tests:** `test/password.test.js`, `test/auth.test.js`, `test/user-isolation.test.js`, `test/auth-server.test.js`, `test/demo-reset.test.js`.
- **Modify tests:** `test/progress-db.test.js`, `test/server-progress.test.js`, `test/server-source-url.test.js`.

**Conventions to follow** (from existing tests): `const test = require('node:test'); const assert = require('node:assert/strict');`; create a temp dir with `fs.mkdtempSync(path.join(os.tmpdir(), '<prefix>-'))`; set `process.env.MANGA_TRACKER_DATA_DIR` before `require('../db')`; delete the relevant entries from `require.cache` and `fs.rmSync(tempDir, { recursive: true, force: true })` in a `finally`.

---

## Task 1: Password hashing module

**Files:**
- Create: `password.js`
- Test: `test/password.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/password.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');

const { hashPassword, verifyPassword } = require('../password');

test('hashPassword produces a scrypt string that verifyPassword accepts', () => {
  const stored = hashPassword('0000');
  assert.match(stored, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.equal(verifyPassword('0000', stored), true);
});

test('verifyPassword rejects a wrong password', () => {
  const stored = hashPassword('0000');
  assert.equal(verifyPassword('9999', stored), false);
});

test('verifyPassword rejects malformed stored values', () => {
  assert.equal(verifyPassword('0000', ''), false);
  assert.equal(verifyPassword('0000', null), false);
  assert.equal(verifyPassword('0000', 'not-a-hash'), false);
});

test('two hashes of the same password differ (random salt)', () => {
  assert.notEqual(hashPassword('same'), hashPassword('same'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/password.test.js`
Expected: FAIL — cannot find module `../password`.

- [ ] **Step 3: Write the implementation**

Create `password.js`:

```javascript
const crypto = require('node:crypto');

const SCRYPT_KEYLEN = 64;

function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(plain), salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(plain, stored) {
  if (typeof stored !== 'string') {
    return false;
  }

  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }

  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[1], 'hex');
    expected = Buffer.from(parts[2], 'hex');
  } catch {
    return false;
  }

  if (salt.length === 0 || expected.length === 0) {
    return false;
  }

  let actual;
  try {
    actual = crypto.scryptSync(String(plain), salt, expected.length);
  } catch {
    return false;
  }

  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = { hashPassword, verifyPassword };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/password.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add password.js test/password.test.js
git commit -m "$(cat <<'EOF'
Add scrypt password hashing module

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: User accounts — password/role columns and owner+demo seeding

**Files:**
- Modify: `db.js`
- Test: `test/auth.test.js` (account-seeding portion; token tests added in Task 4)

Owner = `user_id` 1 (preserves the existing library). Demo = a separate user with `role='demo'`.

- [ ] **Step 1: Write the failing test**

Create `test/auth.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadFreshDb(tempDir) {
  delete require.cache[require.resolve('../db')];
  process.env.MANGA_TRACKER_DATA_DIR = tempDir;
  return require('../db');
}

function cleanup(tempDir) {
  delete process.env.MANGA_TRACKER_DATA_DIR;
  delete require.cache[require.resolve('../db')];
  fs.rmSync(tempDir, { recursive: true, force: true });
}

test('db init seeds owner (user 1 = phil, role owner) with a usable password', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-auth-seed-test-'));
  const dbModule = loadFreshDb(tempDir);
  const { verifyPassword } = require('../password');

  try {
    const owner = dbModule.getUser(1);
    assert.equal(owner.username, 'phil');
    assert.equal(owner.role, 'owner');
    assert.equal(verifyPassword('0000', owner.password_hash), true);
  } finally {
    dbModule.closeDatabase();
    cleanup(tempDir);
  }
});

test('db init seeds a demo user with role demo', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-auth-demo-test-'));
  const dbModule = loadFreshDb(tempDir);

  try {
    const demo = dbModule.getUserByUsername('demo');
    assert.ok(demo, 'demo user should exist');
    assert.equal(demo.role, 'demo');
    assert.notEqual(demo.id, 1);
  } finally {
    dbModule.closeDatabase();
    cleanup(tempDir);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/auth.test.js`
Expected: FAIL — `owner.role` is undefined / `demo` user is undefined.

- [ ] **Step 3: Add the columns, the `require`, and the seeding to `db.js`**

At the top of `db.js`, after the existing `source-links` require block (around line 9), add:

```javascript
const { hashPassword } = require('./password');
```

In the schema setup, immediately after the existing `ensureColumn('chapter_cache', 'position', 'INTEGER DEFAULT 0');` line, add:

```javascript
  ensureColumn('users', 'password_hash', 'TEXT');
  ensureColumn('users', 'role', "TEXT DEFAULT 'user'");
```

Add this function near the other user helpers (e.g., after `getUserByUsername`):

```javascript
function seedAccounts() {
  const adminUsername = String(process.env.ADMIN_USERNAME || 'phil').trim() || 'phil';
  const adminPassword = process.env.ADMIN_PASSWORD || '0000';
  const demoUsername = String(process.env.DEMO_USERNAME || 'demo').trim() || 'demo';

  const owner = db.prepare('SELECT * FROM users WHERE id = 1').get();
  if (owner) {
    if (!owner.username || owner.username === 'default_user') {
      db.prepare('UPDATE users SET username = ? WHERE id = 1').run(adminUsername);
    }
    if (!owner.password_hash) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = 1').run(hashPassword(adminPassword));
    }
    db.prepare("UPDATE users SET role = 'owner' WHERE id = 1").run();
  }

  const demo = db.prepare('SELECT * FROM users WHERE username = ?').get(demoUsername);
  if (!demo) {
    db.prepare("INSERT INTO users (username, role) VALUES (?, 'demo')").run(demoUsername);
    console.log(`Created demo user: ${demoUsername}`);
  } else if (demo.role !== 'demo') {
    db.prepare("UPDATE users SET role = 'demo' WHERE id = ?").run(demo.id);
  }
}
```

In the init block, immediately after the existing `seedDefaultSourceUrls();` call, add:

```javascript
  seedAccounts();
```

Add `seedAccounts` to `module.exports` (alongside `seedDefaultSourceUrls`). Add `dataDir` to `module.exports` (needed by `auth.js` in Task 4): add a `dataDir,` line to the exports object.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/auth.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite to confirm nothing regressed**

Run: `node --test`
Expected: PASS (existing tests unaffected — they use `user_id` 1 by id, not by username).

- [ ] **Step 6: Commit**

```bash
git add db.js test/auth.test.js
git commit -m "$(cat <<'EOF'
Seed owner and demo accounts with hashed passwords

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: User-scope the unread_backlog table

Make `unread_backlog` per-user (migrating existing rows to owner = user 1), thread `userId` through every backlog function, add `resetUserLibrary`, and update all internal callers (`chapter-service.js`, `provider-migration.js`) plus the two server call sites (still using the `USER_ID` constant — `req.userId` arrives in Task 5). Also update the direct-DB calls in the existing db/server tests.

**Files:**
- Modify: `db.js`, `chapter-service.js`, `provider-migration.js`, `server.js`
- Modify: `test/progress-db.test.js`, `test/server-progress.test.js`
- Test (new): `test/user-isolation.test.js`

- [ ] **Step 1: Write the failing isolation test**

Create `test/user-isolation.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadFreshDb(tempDir) {
  delete require.cache[require.resolve('../db')];
  process.env.MANGA_TRACKER_DATA_DIR = tempDir;
  return require('../db');
}

function cleanup(tempDir) {
  delete process.env.MANGA_TRACKER_DATA_DIR;
  delete require.cache[require.resolve('../db')];
  fs.rmSync(tempDir, { recursive: true, force: true });
}

test('two users tracking the same manga keep separate unread backlogs', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-isolation-test-'));
  const dbModule = loadFreshDb(tempDir);

  try {
    const owner = dbModule.getUser(1);
    const demo = dbModule.getUserByUsername('demo');

    dbModule.trackManga(owner.id, 'shared-id', 'Shared', {
      provider: 'mangaupdates',
      providerSeriesId: 'shared-id',
      latestChapterNumber: 100,
      lastReadChapterNumber: 97,
      migrationStatus: 'resolved'
    });
    dbModule.trackManga(demo.id, 'shared-id', 'Shared', {
      provider: 'mangaupdates',
      providerSeriesId: 'shared-id',
      latestChapterNumber: 100,
      lastReadChapterNumber: 0,
      migrationStatus: 'resolved'
    });

    dbModule.replaceUnreadBacklog(owner.id, 'shared-id', [98, 99, 100]);
    dbModule.replaceUnreadBacklog(demo.id, 'shared-id', [10, 11]);

    assert.deepEqual(
      dbModule.getUnreadBacklog(owner.id, 'shared-id').map(e => e.chapterNumber),
      [100, 99, 98]
    );
    assert.deepEqual(
      dbModule.getUnreadBacklog(demo.id, 'shared-id').map(e => e.chapterNumber),
      [11, 10]
    );
    assert.equal(dbModule.getUnreadBacklogCount(owner.id, 'shared-id'), 3);
    assert.equal(dbModule.getUnreadBacklogCount(demo.id, 'shared-id'), 2);

    dbModule.advanceProgressToChapter(owner.id, 'shared-id', 99);

    assert.deepEqual(
      dbModule.getUnreadBacklog(owner.id, 'shared-id').map(e => e.chapterNumber),
      [100]
    );
    assert.deepEqual(
      dbModule.getUnreadBacklog(demo.id, 'shared-id').map(e => e.chapterNumber),
      [11, 10]
    );
  } finally {
    dbModule.closeDatabase();
    cleanup(tempDir);
  }
});

test('resetUserLibrary wipes only the target user', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-reset-lib-test-'));
  const dbModule = loadFreshDb(tempDir);

  try {
    const owner = dbModule.getUser(1);
    const demo = dbModule.getUserByUsername('demo');

    dbModule.trackManga(owner.id, 'm-owner', 'Owner Title', {
      provider: 'mangaupdates', providerSeriesId: 'm-owner',
      latestChapterNumber: 5, lastReadChapterNumber: 2, migrationStatus: 'resolved'
    });
    dbModule.replaceUnreadBacklog(owner.id, 'm-owner', [3, 4, 5]);

    dbModule.trackManga(demo.id, 'm-demo', 'Demo Title', {
      provider: 'mangaupdates', providerSeriesId: 'm-demo',
      latestChapterNumber: 5, lastReadChapterNumber: 2, migrationStatus: 'resolved'
    });
    dbModule.replaceUnreadBacklog(demo.id, 'm-demo', [3, 4, 5]);

    dbModule.resetUserLibrary(demo.id);

    assert.equal(dbModule.getTrackedManga(demo.id).length, 0);
    assert.equal(dbModule.getUnreadBacklogCount(demo.id, 'm-demo'), 0);
    assert.equal(dbModule.getTrackedManga(owner.id).length, 1);
    assert.equal(dbModule.getUnreadBacklogCount(owner.id, 'm-owner'), 3);
  } finally {
    dbModule.closeDatabase();
    cleanup(tempDir);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/user-isolation.test.js`
Expected: FAIL — `replaceUnreadBacklog` treats `owner.id` as `mangaId`; `resetUserLibrary` is not a function.

- [ ] **Step 3: Update the `unread_backlog` schema + add the migration in `db.js`**

In the big `db.exec(\`...\`)` schema string, replace the `unread_backlog` table definition with the user-scoped version:

```sql
    CREATE TABLE IF NOT EXISTS unread_backlog (
      user_id INTEGER NOT NULL,
      manga_id TEXT NOT NULL,
      chapter_number INTEGER NOT NULL,
      detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, manga_id, chapter_number)
    );
```

Add this function above the init block (e.g., just after `ensureColumn`):

```javascript
function migrateUnreadBacklogToUserScoped() {
  const columns = new Set(
    db.prepare('PRAGMA table_info(unread_backlog)').all().map(column => column.name)
  );

  if (columns.has('user_id')) {
    return;
  }

  const migrate = db.transaction(() => {
    db.exec('ALTER TABLE unread_backlog RENAME TO unread_backlog_legacy');
    db.exec(`
      CREATE TABLE unread_backlog (
        user_id INTEGER NOT NULL,
        manga_id TEXT NOT NULL,
        chapter_number INTEGER NOT NULL,
        detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, manga_id, chapter_number)
      )
    `);
    db.exec(`
      INSERT INTO unread_backlog (user_id, manga_id, chapter_number, detected_at)
      SELECT 1, manga_id, chapter_number, detected_at FROM unread_backlog_legacy
    `);
    db.exec('DROP TABLE unread_backlog_legacy');
  });

  migrate();
  console.log('Migrated unread_backlog to user-scoped schema');
}
```

In the init block, call it after the `ensureColumn(...)` lines and **before** the `db.exec` that creates indexes:

```javascript
  migrateUnreadBacklogToUserScoped();
```

Update the `unread_backlog` index in the index `db.exec` to include `user_id`:

```sql
    CREATE INDEX IF NOT EXISTS idx_unread_backlog_manga
      ON unread_backlog(user_id, manga_id, chapter_number DESC);
```

- [ ] **Step 4: Update the backlog function signatures in `db.js`**

Replace the six backlog functions with user-scoped versions:

```javascript
function replaceUnreadBacklog(userId, mangaId, chapterNumbers, detectedAt = new Date().toISOString()) {
  const normalizedNumbers = [...new Set(
    chapterNumbers
      .map(normalizeChapterNumber)
      .filter(chapterNumber => chapterNumber !== null)
  )];

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM unread_backlog WHERE user_id = ? AND manga_id = ?').run(userId, mangaId);
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO unread_backlog (user_id, manga_id, chapter_number, detected_at)
      VALUES (?, ?, ?, ?)
    `);

    for (const chapterNumber of normalizedNumbers) {
      insertStmt.run(userId, mangaId, chapterNumber, detectedAt);
    }
  });

  transaction();
}

function addUnreadBacklogEntries(userId, mangaId, chapterNumbers, detectedAt = new Date().toISOString()) {
  const normalizedNumbers = [...new Set(
    chapterNumbers
      .map(normalizeChapterNumber)
      .filter(chapterNumber => chapterNumber !== null)
  )];

  const transaction = db.transaction(() => {
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO unread_backlog (user_id, manga_id, chapter_number, detected_at)
      VALUES (?, ?, ?, ?)
    `);

    for (const chapterNumber of normalizedNumbers) {
      insertStmt.run(userId, mangaId, chapterNumber, detectedAt);
    }
  });

  transaction();
}

function getUnreadBacklog(userId, mangaId, limit = 100) {
  return db.prepare(`
    SELECT chapter_number, detected_at
    FROM unread_backlog
    WHERE user_id = ? AND manga_id = ?
    ORDER BY chapter_number DESC
    LIMIT ?
  `).all(userId, mangaId, limit).map(row => ({
    id: `${mangaId}:${row.chapter_number}`,
    chapterNumber: row.chapter_number,
    detectedAt: row.detected_at
  }));
}

function getUnreadBacklogCount(userId, mangaId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS backlog_count
    FROM unread_backlog
    WHERE user_id = ? AND manga_id = ?
  `).get(userId, mangaId);

  return row ? row.backlog_count : 0;
}

function getHighestUnreadBacklogChapter(userId, mangaId) {
  const row = db.prepare(
    'SELECT MAX(chapter_number) AS chapter_number FROM unread_backlog WHERE user_id = ? AND manga_id = ?'
  ).get(userId, mangaId);
  return normalizeChapterNumber(row && row.chapter_number);
}

function clearUnreadBacklogThroughChapter(userId, mangaId, chapterNumber) {
  return db.prepare('DELETE FROM unread_backlog WHERE user_id = ? AND manga_id = ? AND chapter_number <= ?').run(
    userId,
    mangaId,
    normalizeChapterNumber(chapterNumber)
  );
}
```

Update the `DELETE FROM unread_backlog` inside `advanceProgressToChapter` (it already receives `userId`) to be user-scoped:

```javascript
    db.prepare('DELETE FROM unread_backlog WHERE user_id = ? AND manga_id = ? AND chapter_number <= ?').run(
      userId,
      mangaId,
      nextChapterNumber
    );
```

Add a new `resetUserLibrary` function near `untrackManga`:

```javascript
function resetUserLibrary(userId) {
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM read_chapters WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM unread_backlog WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM tracked_manga WHERE user_id = ?').run(userId);
  });
  transaction();
  console.log(`Reset library for user ${userId}`);
}
```

Add `resetUserLibrary` to `module.exports`.

- [ ] **Step 5: Update `chapter-service.js` callers**

- Line ~60 in `getChaptersForManga(mangaId, userId = 1)`:

```javascript
  return getUnreadBacklog(userId, mangaId, 50).map(toSyntheticChapter);
```

- Inside `getTrackedMangaWithChapters(userId)` (lines ~69 and ~72):

```javascript
    const backlog = manga.migration_status === 'resolved'
      ? getUnreadBacklog(userId, manga.manga_id, 10)
      : [];
    const unreadCount = manga.migration_status === 'resolved'
      ? getUnreadBacklogCount(userId, manga.manga_id)
      : 0;
```

- Inside `refreshAllTrackedManga` (lines ~117, ~134, ~143) use `row.user_id`:

```javascript
        const highestBacklogChapter = getHighestUnreadBacklogChapter(row.user_id, row.manga_id);
```
```javascript
          replaceUnreadBacklog(row.user_id, row.manga_id, []);
```
```javascript
            addUnreadBacklogEntries(row.user_id, row.manga_id, newChapters, new Date().toISOString());
```

- [ ] **Step 6: Update `provider-migration.js` caller**

Line ~139:

```javascript
  replaceUnreadBacklog(row.user_id, row.manga_id, unreadChapters, detectedAt);
```

- [ ] **Step 7: Update the two `server.js` call sites (still using the `USER_ID` constant)**

Line ~123:

```javascript
      const existingUnreadCount = existingTracked ? getUnreadBacklogCount(USER_ID, mangaId) : 0;
```

Line ~151:

```javascript
        replaceUnreadBacklog(USER_ID, mangaId, initialUnreadChapters);
```

- [ ] **Step 8: Update the direct-DB calls in the existing tests**

In `test/progress-db.test.js`:
- `dbModule.replaceUnreadBacklog('legacy-eleceed', [396, 397, 398], '2026-04-21T12:00:00.000Z');` → `dbModule.replaceUnreadBacklog(1, 'legacy-eleceed', [396, 397, 398], '2026-04-21T12:00:00.000Z');`
- Both `dbModule.getUnreadBacklog('legacy-eleceed')` → `dbModule.getUnreadBacklog(1, 'legacy-eleceed')`

In `test/server-progress.test.js`:
- Line ~102 `dbModule.replaceUnreadBacklog('legacy-eleceed', [396, 397, 398], '2026-04-21T12:00:00.000Z');` → prefix with `1, `: `dbModule.replaceUnreadBacklog(1, 'legacy-eleceed', [396, 397, 398], '2026-04-21T12:00:00.000Z');`
- Line ~139 `dbModule.getUnreadBacklog('legacy-eleceed')` → `dbModule.getUnreadBacklog(1, 'legacy-eleceed')`
- Lines ~165-169 `dbModule.replaceUnreadBacklog('legacy-kagurabachi', Array.from(...), '2026-04-21T12:00:00.000Z')` → insert `1, ` as the first argument: `dbModule.replaceUnreadBacklog(1, 'legacy-kagurabachi', Array.from({ length: 120 }, (_, index) => index + 1), '2026-04-21T12:00:00.000Z');`
- Line ~223 `dbModule.getUnreadBacklog('114563652')` → `dbModule.getUnreadBacklog(1, '114563652')`

> Note: the endpoint calls in `server-progress.test.js` (`/api/manga`, `/api/read`, `/api/track`) still operate on `USER_ID` 1 because the auth middleware is not mounted until Task 5, so these tests stay green here. They are converted to authenticated requests in Task 5.

- [ ] **Step 9: Run the full suite**

Run: `node --test`
Expected: PASS — including the new `test/user-isolation.test.js` (2 tests) and all updated tests.

- [ ] **Step 10: Commit**

```bash
git add db.js chapter-service.js provider-migration.js server.js test/user-isolation.test.js test/progress-db.test.js test/server-progress.test.js
git commit -m "$(cat <<'EOF'
User-scope the unread backlog table

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Session tokens, cookies, and auth middleware

**Files:**
- Create: `auth.js`
- Test: `test/auth.test.js` (append token tests)

- [ ] **Step 1: Append failing token tests to `test/auth.test.js`**

Add these tests to `test/auth.test.js` (after the existing seeding tests):

```javascript
test('session tokens round-trip and reject tampering/expiry', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-auth-token-test-'));
  process.env.MANGA_TRACKER_DATA_DIR = tempDir;
  delete require.cache[require.resolve('../db')];
  delete require.cache[require.resolve('../auth')];
  const auth = require('../auth');
  const dbModule = require('../db');

  try {
    const secret = 'test-secret';
    const token = auth.createSessionToken(7, secret);
    assert.deepEqual(auth.verifySessionToken(token, secret), { userId: 7 });

    assert.equal(auth.verifySessionToken(token, 'wrong-secret'), null);
    assert.equal(auth.verifySessionToken(token + 'x', secret), null);
    assert.equal(auth.verifySessionToken('a.b.c', secret), null);
    assert.equal(auth.verifySessionToken('', secret), null);

    const expired = auth.createSessionToken(7, secret, -1000);
    assert.equal(auth.verifySessionToken(expired, secret), null);
  } finally {
    dbModule.closeDatabase();
    delete process.env.MANGA_TRACKER_DATA_DIR;
    delete require.cache[require.resolve('../auth')];
    delete require.cache[require.resolve('../db')];
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('parseCookies parses a cookie header into a map', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-auth-cookie-test-'));
  process.env.MANGA_TRACKER_DATA_DIR = tempDir;
  delete require.cache[require.resolve('../db')];
  delete require.cache[require.resolve('../auth')];
  const auth = require('../auth');
  const dbModule = require('../db');

  try {
    assert.deepEqual(auth.parseCookies('a=1; b=two'), { a: '1', b: 'two' });
    assert.deepEqual(auth.parseCookies(''), {});
    assert.deepEqual(auth.parseCookies(undefined), {});
  } finally {
    dbModule.closeDatabase();
    delete process.env.MANGA_TRACKER_DATA_DIR;
    delete require.cache[require.resolve('../auth')];
    delete require.cache[require.resolve('../db')];
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/auth.test.js`
Expected: FAIL — cannot find module `../auth`.

- [ ] **Step 3: Create `auth.js`**

```javascript
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');

const SESSION_COOKIE_NAME = 'mt_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function resolveSessionSecret(dataDir) {
  if (process.env.SESSION_SECRET) {
    return process.env.SESSION_SECRET;
  }

  const secretPath = path.join(dataDir, 'session-secret');
  try {
    if (fs.existsSync(secretPath)) {
      const existing = fs.readFileSync(secretPath, 'utf8').trim();
      if (existing) {
        return existing;
      }
    }
  } catch (error) {
    console.error('Could not read session secret:', error.message);
  }

  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(secretPath, generated, { mode: 0o600 });
  } catch (error) {
    console.error('Could not persist session secret:', error.message);
  }
  return generated;
}

const SECRET = resolveSessionSecret(db.dataDir);

function createSessionToken(userId, secret, ttlMs = SESSION_TTL_MS) {
  const encodedUserId = Buffer.from(String(userId)).toString('base64url');
  const payload = `${encodedUserId}.${Date.now() + ttlMs}`;
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${hmac}`;
}

function verifySessionToken(token, secret) {
  if (typeof token !== 'string') {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [encodedUserId, expiry, providedHmac] = parts;
  const payload = `${encodedUserId}.${expiry}`;
  const expectedHmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  // Reject anything that is not exactly a 64-char lowercase hex HMAC. Without
  // this, Buffer.from(hex, 'hex') silently truncates trailing non-hex chars, so
  // a tampered "<token>x" would decode to the same bytes and pass.
  if (!/^[0-9a-f]{64}$/.test(providedHmac)) {
    return null;
  }

  let expectedBuf;
  let providedBuf;
  try {
    expectedBuf = Buffer.from(expectedHmac, 'hex');
    providedBuf = Buffer.from(providedHmac, 'hex');
  } catch {
    return null;
  }

  if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    return null;
  }

  const expiryMs = Number(expiry);
  if (!Number.isFinite(expiryMs) || expiryMs < Date.now()) {
    return null;
  }

  const userId = Number(Buffer.from(encodedUserId, 'base64url').toString('utf8'));
  if (!Number.isInteger(userId)) {
    return null;
  }

  return { userId };
}

function parseCookies(cookieHeader) {
  const out = {};
  if (typeof cookieHeader !== 'string') {
    return out;
  }

  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) {
      continue;
    }
    const key = part.slice(0, index).trim();
    if (!key) {
      continue;
    }
    out[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function cookieOptions(basePath, includeMaxAge = true) {
  const options = {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: basePath || '/'
  };
  if (includeMaxAge) {
    options.maxAge = SESSION_TTL_MS;
  }
  return options;
}

function setSessionCookie(res, userId, basePath) {
  res.cookie(SESSION_COOKIE_NAME, createSessionToken(userId, SECRET), cookieOptions(basePath, true));
}

function clearSessionCookie(res, basePath) {
  res.clearCookie(SESSION_COOKIE_NAME, cookieOptions(basePath, false));
}

function resolveDemoUser() {
  const demoUsername = String(process.env.DEMO_USERNAME || 'demo').trim() || 'demo';
  return db.getUserByUsername(demoUsername) || null;
}

function attachUser(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const session = verifySessionToken(cookies[SESSION_COOKIE_NAME], SECRET);

  let user = null;
  if (session) {
    user = db.getUser(session.userId) || null;
  }
  if (!user || user.role === 'demo') {
    user = user && user.role === 'demo' ? user : resolveDemoUser();
  }

  req.user = user;
  req.userId = user ? user.id : null;
  next();
}

function requireOwner(req, res, next) {
  if (!req.user || req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

module.exports = {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  createSessionToken,
  verifySessionToken,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  attachUser,
  requireOwner
};
```

> Note on `attachUser`: a valid cookie for a non-demo user wins; otherwise the request resolves to the demo user. The slightly awkward demo branch keeps behavior correct if a cookie ever points directly at the demo user.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/auth.test.js`
Expected: PASS (4 tests total in the file).

- [ ] **Step 5: Run the full suite**

Run: `node --test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add auth.js test/auth.test.js
git commit -m "$(cat <<'EOF'
Add session token and auth middleware module

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire auth into the server (login/logout/me, req.userId, gate refresh)

**Files:**
- Modify: `server.js`
- Modify: `test/server-progress.test.js`, `test/server-source-url.test.js`
- Test (new): `test/auth-server.test.js`

- [ ] **Step 1: Write the failing integration test**

Create `test/auth-server.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

function installMangaupdatesStub() {
  const modulePath = path.join(__dirname, '..', 'mangaupdates.js');
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: {
      searchSeries: async () => [],
      getSeriesDetails: async seriesId => ({
        id: String(seriesId),
        title: 'Stub',
        url: '',
        type: 'Manga',
        status: '',
        latestChapter: 10,
        imageUrl: ''
      })
    }
  };
}

function cleanupModules() {
  delete process.env.MANGA_TRACKER_DATA_DIR;
  ['../db', '../auth', '../server', '../chapter-service', '../scheduler', '../demo', '../mangaupdates', '../provider-migration']
    .forEach(name => {
      try {
        delete require.cache[require.resolve(name)];
      } catch {}
    });
}

async function startServer() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-auth-server-test-'));
  process.env.MANGA_TRACKER_DATA_DIR = tempDir;
  installMangaupdatesStub();
  const serverModule = require('../server');
  const app = serverModule.createApp();
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const { port } = server.address();
  return { server, tempDir, baseUrl: `http://127.0.0.1:${port}` };
}

test('login rejects bad credentials and accepts phil/0000', async () => {
  const { server, tempDir, baseUrl } = await startServer();
  try {
    let response = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'phil', password: 'wrong' })
    });
    assert.equal(response.status, 401);

    response = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'phil', password: '0000' })
    });
    assert.equal(response.status, 200);
    const setCookie = response.headers.get('set-cookie');
    assert.match(setCookie || '', /mt_session=/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    require('../db').closeDatabase();
    cleanupModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('GET /api/me reflects demo vs owner, and refresh is owner-only', async () => {
  const { server, tempDir, baseUrl } = await startServer();
  try {
    // Anonymous → demo.
    let response = await fetch(`${baseUrl}/api/me`);
    let payload = await response.json();
    assert.equal(payload.authenticated, false);
    assert.equal(payload.isDemo, true);

    // Anonymous refresh is forbidden.
    response = await fetch(`${baseUrl}/api/refresh`, { method: 'POST' });
    assert.equal(response.status, 403);

    // Log in.
    response = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'phil', password: '0000' })
    });
    const cookie = (response.headers.get('set-cookie') || '').split(';')[0];

    response = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } });
    payload = await response.json();
    assert.equal(payload.authenticated, true);
    assert.equal(payload.isDemo, false);
    assert.equal(payload.username, 'phil');

    response = await fetch(`${baseUrl}/api/refresh`, { method: 'POST', headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
    require('../db').closeDatabase();
    cleanupModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/auth-server.test.js`
Expected: FAIL — `/api/login` returns 404 (route missing); `/api/refresh` returns 200 anonymously.

- [ ] **Step 3: Update `server.js` imports**

Replace the `const { ... } = require('./db');` destructure to also import `getUserByUsername`:

```javascript
const {
  trackManga,
  getTrackedMangaById,
  getUnreadBacklogCount,
  replaceUnreadBacklog,
  untrackManga,
  advanceProgressToChapter,
  markChapterUnread,
  updateMangaSourceUrl,
  getUserByUsername
} = require('./db');
```

After the existing requires, add:

```javascript
const { verifyPassword } = require('./password');
const { attachUser, requireOwner, setSessionCookie, clearSessionCookie } = require('./auth');
```

Remove the `const USER_ID = 1;` line.

- [ ] **Step 4: Mount the middleware in `createApp`**

Immediately after `app.use(express.json({ limit: '32kb' }));`, add:

```javascript
  app.use(attachUser);
```

- [ ] **Step 5: Add the auth routes in `createApp`**

After the `/health` route, add:

```javascript
  app.post(BASE_PATH + '/api/login', (req, res) => {
    const username = getTrimmedString(req.body.username);
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!username || !password) {
      return sendBadRequest(res, 'Missing username or password');
    }

    const user = getUserByUsername(username);
    if (!user || user.role === 'demo' || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    setSessionCookie(res, user.id, BASE_PATH);
    res.json({ success: true, username: user.username, role: user.role });
  });

  app.post(BASE_PATH + '/api/logout', (req, res) => {
    clearSessionCookie(res, BASE_PATH);
    res.json({ success: true });
  });

  app.get(BASE_PATH + '/api/me', (req, res) => {
    const user = req.user;
    const isDemo = !user || user.role === 'demo';
    res.json({
      authenticated: !isDemo,
      username: user ? user.username : null,
      role: user ? user.role : null,
      isDemo
    });
  });
```

- [ ] **Step 6: Replace `USER_ID` with `req.userId` in the data routes**

- `/api/track`:
```javascript
      const existingTracked = getTrackedMangaById(req.userId, mangaId);
      const existingUnreadCount = existingTracked ? getUnreadBacklogCount(req.userId, mangaId) : 0;
```
```javascript
      trackManga(req.userId, mangaId, resolvedTitle, {
```
```javascript
        replaceUnreadBacklog(req.userId, mangaId, initialUnreadChapters);
```
- `/api/manga`:
```javascript
      const trackedManga = await getTrackedMangaWithChapters(req.userId);
```
- `/api/manga/:id/chapters`:
```javascript
      const chapters = await getChaptersForManga(mangaId, req.userId);
```
- `/api/manga/:mangaId/source`:
```javascript
      const result = updateMangaSourceUrl(req.userId, mangaId, sourceUrl);
```
- `/api/read`:
```javascript
      const resolvedChapterNumber = advanceProgressToChapter(req.userId, mangaId, chapterNumber);
```
- `/api/unread`:
```javascript
      markChapterUnread(req.userId, chapterId);
```
- `/api/untrack/:mangaId`:
```javascript
      untrackManga(req.userId, mangaId);
```

- [ ] **Step 7: Gate `/api/refresh` with `requireOwner`**

```javascript
  app.post(BASE_PATH + '/api/refresh', requireOwner, async (req, res) => {
```

- [ ] **Step 8: Convert the existing server tests to authenticate as owner**

These tests hit user-scoped routes and previously relied on anonymous == user 1. Now anonymous == demo, so they must send the owner cookie.

In **`test/server-progress.test.js`**, add this helper near the top (after the requires):

```javascript
async function loginAsOwner(baseUrl) {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'phil', password: '0000' })
  });
  return (response.headers.get('set-cookie') || '').split(';')[0];
}
```

Then in each of the three tests, after `const baseUrl = ...;`, add:

```javascript
    const cookie = await loginAsOwner(baseUrl);
```

And add `Cookie: cookie` to the headers of every authenticated request:
- Test 1: the `/api/read` POST → `headers: { 'Content-Type': 'application/json', Cookie: cookie }`. (The `/api/search` GET does not require auth, but adding the cookie is harmless; leave it as-is.)
- Test 2: the `/api/manga` GET → `await fetch(\`${baseUrl}/api/manga\`, { headers: { Cookie: cookie } })`.
- Test 3: the `/api/track` POST → add `Cookie: cookie` to its headers.

In **`test/server-source-url.test.js`**, add the same `loginAsOwner` helper after the requires, add `const cookie = await loginAsOwner(baseUrl);` after `const baseUrl = ...;`, and add `Cookie: cookie` to the headers of all three PATCH requests.

> Why: `dbModule.trackManga(1, ...)` seeds owner data; the routes now resolve the user from the cookie, so the owner cookie is required for the route to see that data.

- [ ] **Step 9: Run the full suite**

Run: `node --test`
Expected: PASS — `auth-server.test.js` (2 tests) plus all updated server tests.

- [ ] **Step 10: Commit**

```bash
git add server.js test/server-progress.test.js test/server-source-url.test.js test/auth-server.test.js
git commit -m "$(cat <<'EOF'
Resolve request user from session and add auth routes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Demo snapshot and reset

**Files:**
- Create: `demo-snapshot.js`, `demo.js`
- Test (new): `test/demo-reset.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/demo-reset.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function installStubs() {
  const muPath = path.join(__dirname, '..', 'mangaupdates.js');
  require.cache[muPath] = {
    id: muPath,
    filename: muPath,
    loaded: true,
    exports: {
      searchSeries: async () => [],
      getSeriesDetails: async seriesId => ({
        id: String(seriesId),
        title: seriesId === 'op' ? 'One Piece' : 'Kagurabachi',
        url: '',
        type: 'Manga',
        status: '',
        latestChapter: seriesId === 'op' ? 1120 : 60,
        imageUrl: ''
      })
    }
  };

  const snapshotPath = path.join(__dirname, '..', 'demo-snapshot.js');
  require.cache[snapshotPath] = {
    id: snapshotPath,
    filename: snapshotPath,
    loaded: true,
    exports: {
      PREVIEW_COUNT: 3,
      DEMO_TITLES: [
        { providerSeriesId: 'op', title: 'One Piece', sourceUrl: '' },
        { providerSeriesId: 'kb', title: 'Kagurabachi', sourceUrl: '' }
      ]
    }
  };
}

function cleanupModules() {
  delete process.env.MANGA_TRACKER_DATA_DIR;
  ['../db', '../demo', '../demo-snapshot', '../mangaupdates', '../chapter-service', '../provider-migration']
    .forEach(name => {
      try {
        delete require.cache[require.resolve(name)];
      } catch {}
    });
}

test('resetDemoAccount seeds each demo title with PREVIEW_COUNT unread chapters', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-demo-reset-test-'));
  process.env.MANGA_TRACKER_DATA_DIR = tempDir;
  installStubs();

  const dbModule = require('../db');
  const { resetDemoAccount } = require('../demo');

  try {
    const demo = dbModule.getUserByUsername('demo');

    // Pre-pollute the demo to prove the reset wipes it.
    dbModule.trackManga(demo.id, 'junk', 'Junk', {
      provider: 'mangaupdates', providerSeriesId: 'junk',
      latestChapterNumber: 5, lastReadChapterNumber: 0, migrationStatus: 'resolved'
    });
    dbModule.replaceUnreadBacklog(demo.id, 'junk', [1, 2, 3, 4, 5]);

    const result = await resetDemoAccount();
    assert.equal(result.seeded, 2);

    const tracked = dbModule.getTrackedManga(demo.id);
    assert.equal(tracked.length, 2);
    assert.equal(tracked.find(t => t.manga_id === 'junk'), undefined);

    const op = tracked.find(t => t.manga_id === 'op');
    assert.equal(op.last_read_chapter_number, 1117);
    assert.deepEqual(
      dbModule.getUnreadBacklog(demo.id, 'op').map(e => e.chapterNumber),
      [1120, 1119, 1118]
    );

    const kb = tracked.find(t => t.manga_id === 'kb');
    assert.deepEqual(
      dbModule.getUnreadBacklog(demo.id, 'kb').map(e => e.chapterNumber),
      [60, 59, 58]
    );
  } finally {
    dbModule.closeDatabase();
    cleanupModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/demo-reset.test.js`
Expected: FAIL — cannot find module `../demo` (the snapshot is stubbed, but `demo.js` does not exist).

- [ ] **Step 3: Create `demo-snapshot.js`**

```javascript
// Demo library snapshot. providerSeriesId is the MangaUpdates series id used as
// the manga_id throughout the app. Real ids are filled in during Step 4.
const PREVIEW_COUNT = 3;

const DEMO_TITLES = [
  { providerSeriesId: 'ONE_PIECE_ID', title: 'One Piece', sourceUrl: '' },
  { providerSeriesId: 'KAGURABACHI_ID', title: 'Kagurabachi', sourceUrl: '' }
];

module.exports = { DEMO_TITLES, PREVIEW_COUNT };
```

- [ ] **Step 4: Resolve the real MangaUpdates series IDs and fill them in**

Run (network required):

```bash
node -e "require('./mangaupdates').searchSeries('One Piece').then(r => console.log(r.slice(0,5).map(x => x.id + '  ' + x.title + '  latest=' + x.latestChapter)))"
node -e "require('./mangaupdates').searchSeries('Kagurabachi').then(r => console.log(r.slice(0,5).map(x => x.id + '  ' + x.title + '  latest=' + x.latestChapter)))"
```

Pick the correct series for each (the canonical manga, not a spin-off/databook) and replace `ONE_PIECE_ID` / `KAGURABACHI_ID` in `demo-snapshot.js` with the chosen `providerSeriesId` strings. Optionally set `sourceUrl` to a reading site.

- [ ] **Step 5: Create `demo.js`**

```javascript
const {
  getUserByUsername,
  getTrackedManga,
  resetUserLibrary,
  trackManga,
  replaceUnreadBacklog
} = require('./db');
const { getSeriesDetails } = require('./mangaupdates');
const { DEMO_TITLES, PREVIEW_COUNT } = require('./demo-snapshot');

function getDemoUser() {
  const demoUsername = String(process.env.DEMO_USERNAME || 'demo').trim() || 'demo';
  return getUserByUsername(demoUsername) || null;
}

function buildChapterRange(start, end) {
  const chapters = [];
  for (let chapter = start; chapter <= end; chapter += 1) {
    chapters.push(chapter);
  }
  return chapters;
}

async function resetDemoAccount() {
  const demoUser = getDemoUser();
  if (!demoUser) {
    console.error('Demo user not found; skipping demo reset');
    return { success: false, seeded: 0 };
  }

  resetUserLibrary(demoUser.id);

  let seeded = 0;
  const detectedAt = new Date().toISOString();

  for (const entry of DEMO_TITLES) {
    try {
      const details = await getSeriesDetails(entry.providerSeriesId);
      const latest = details.latestChapter;
      if (latest === null) {
        continue;
      }

      const lastRead = Math.max(latest - PREVIEW_COUNT, 0);

      trackManga(demoUser.id, entry.providerSeriesId, entry.title, {
        coverUrl: entry.coverUrl || details.imageUrl || '',
        sourceUrl: entry.sourceUrl || '',
        provider: 'mangaupdates',
        providerSeriesId: entry.providerSeriesId,
        latestChapterNumber: latest,
        lastReadChapterNumber: lastRead,
        migrationStatus: 'resolved'
      });

      replaceUnreadBacklog(
        demoUser.id,
        entry.providerSeriesId,
        buildChapterRange(lastRead + 1, latest),
        detectedAt
      );

      seeded += 1;
    } catch (error) {
      console.error(`Demo reset failed for ${entry.title}:`, error.message);
    }
  }

  console.log(`Demo account reset; seeded ${seeded}/${DEMO_TITLES.length} titles`);
  return { success: true, seeded };
}

async function ensureDemoSeeded() {
  const demoUser = getDemoUser();
  if (!demoUser) {
    return;
  }
  if (getTrackedManga(demoUser.id).length === 0) {
    await resetDemoAccount();
  }
}

module.exports = { resetDemoAccount, ensureDemoSeeded };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test test/demo-reset.test.js`
Expected: PASS (1 test).

- [ ] **Step 7: Run the full suite**

Run: `node --test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add demo-snapshot.js demo.js test/demo-reset.test.js
git commit -m "$(cat <<'EOF'
Add demo snapshot reset for the public library

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Schedule the demo reset and seed on startup

**Files:**
- Modify: `scheduler.js`, `server.js`

- [ ] **Step 1: Update `scheduler.js`**

Add the demo require at the top:

```javascript
const { refreshAllTrackedManga } = require('./chapter-service');
const { resetDemoAccount } = require('./demo');
```

Add a maintenance wrapper that runs the owner sync then the demo reset (failures isolated):

```javascript
async function runDailyMaintenance() {
  await checkForNewChapters();
  try {
    await resetDemoAccount();
  } catch (error) {
    console.error('Demo reset failed during scheduled maintenance:', error.message);
  }
}
```

In `scheduleNextRun`, change the `setTimeout` callback to call `runDailyMaintenance()` instead of `checkForNewChapters()`:

```javascript
  schedulerTimeout = setTimeout(async () => {
    console.log('Running scheduled chapter check...');

    try {
      await runDailyMaintenance();
    } catch (error) {
      console.error('Scheduled check failed:', error);
    } finally {
      scheduleNextRun();
    }
  }, delay);
```

Add `runDailyMaintenance` to `module.exports` (keep `checkForNewChapters` exported — `/api/refresh` still uses it for owner-only manual sync, without touching the demo).

- [ ] **Step 2: Seed the demo on startup in `server.js`**

Add to the requires near the auth import:

```javascript
const { ensureDemoSeeded } = require('./demo');
```

In `startServer`, inside the `app.listen` callback, after `scheduleChapterCheck();` and its log line, add:

```javascript
    ensureDemoSeeded()
      .then(() => console.log('Demo library ready'))
      .catch(error => console.error('Failed to seed demo library:', error.message));
```

- [ ] **Step 3: Verify the suite still passes (no behavior change to tested paths)**

Run: `node --test`
Expected: PASS. (Tests use `createApp`, not `startServer`, so startup seeding does not run during tests; the scheduler is not started in tests.)

- [ ] **Step 4: Commit**

```bash
git add scheduler.js server.js
git commit -m "$(cat <<'EOF'
Reset demo daily and seed it on startup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Frontend — sign-in control, login modal, demo banner

No automated tests (the project has no browser test harness); verification is manual via the running app at the end of this task.

**Files:**
- Modify: `public/index.html`, `public/app.js`, `public/styles.css`

- [ ] **Step 1: Update the header and add the login modal in `public/index.html`**

Replace the `<header>` block with:

```html
    <header class="header">
      <div class="header-top">
        <h1 class="title">MANGA TRACKER</h1>
        <div class="auth-control" id="auth-control"></div>
      </div>
      <div class="header-line"></div>
      <div class="demo-banner" id="demo-banner" hidden>
        PUBLIC DEMO — anyone can edit this, and it resets daily. Sign in to manage your own library.
      </div>
    </header>
```

Add this modal just before `<script src="app.js"></script>`:

```html
  <div id="login-modal" class="modal">
    <div class="modal-content">
      <h3 class="modal-title">SIGN IN</h3>
      <label for="login-username" class="modal-label">Username</label>
      <input type="text" id="login-username" class="modal-input" autocomplete="username" spellcheck="false">
      <label for="login-password" class="modal-label">Password</label>
      <input type="password" id="login-password" class="modal-input" autocomplete="current-password">
      <p id="login-error" class="modal-error" hidden></p>
      <div class="modal-actions">
        <button id="login-cancel" class="btn btn-secondary">CANCEL</button>
        <button id="login-submit" class="btn btn-primary">SIGN IN</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 2: Add auth logic to `public/app.js`**

Add near the top-level state (after `let sourceModalState = ...`):

```javascript
let authState = { authenticated: false, username: null, role: null, isDemo: true };
```

Add these functions (anywhere above `DOMContentLoaded`):

```javascript
function renderAuthControl() {
  const control = document.getElementById('auth-control');
  const banner = document.getElementById('demo-banner');
  const refreshBtn = document.getElementById('refresh-btn');
  if (!control) {
    return;
  }

  if (authState.authenticated) {
    control.innerHTML = `
      <span class="auth-user">${escapeHtml(authState.username || '')}</span>
      <button class="btn btn-secondary btn-auth" id="logout-btn">SIGN OUT</button>
    `;
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', logout);
    }
  } else {
    control.innerHTML = `<button class="btn btn-primary btn-auth" id="signin-btn">SIGN IN</button>`;
    const signinBtn = document.getElementById('signin-btn');
    if (signinBtn) {
      signinBtn.addEventListener('click', showLoginModal);
    }
  }

  if (banner) {
    banner.hidden = !authState.isDemo;
  }
  if (refreshBtn) {
    refreshBtn.style.display = authState.isDemo ? 'none' : '';
  }
}

async function loadSession() {
  try {
    const response = await fetch(apiUrl('me'), { credentials: 'same-origin' });
    if (response.ok) {
      authState = await response.json();
    }
  } catch (error) {
    console.error('Failed to load session:', error);
  }
  renderAuthControl();
}

function showLoginModal() {
  const modal = document.getElementById('login-modal');
  const error = document.getElementById('login-error');
  const username = document.getElementById('login-username');
  const password = document.getElementById('login-password');
  if (!modal) {
    return;
  }
  if (error) {
    error.hidden = true;
    error.textContent = '';
  }
  if (username) {
    username.value = '';
  }
  if (password) {
    password.value = '';
  }
  modal.style.display = 'flex';
  if (username) {
    username.focus();
  }
}

function hideLoginModal() {
  const modal = document.getElementById('login-modal');
  if (modal) {
    modal.style.display = 'none';
  }
}

async function submitLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const error = document.getElementById('login-error');

  try {
    const response = await fetch(apiUrl('login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
      if (error) {
        error.textContent = 'Invalid username or password.';
        error.hidden = false;
      }
      return;
    }

    hideLoginModal();
    await loadSession();
    await loadTrackedManga();
  } catch (err) {
    console.error('Login error:', err);
    if (error) {
      error.textContent = 'Login failed. Try again.';
      error.hidden = false;
    }
  }
}

async function logout() {
  try {
    await fetch(apiUrl('logout'), { method: 'POST', credentials: 'same-origin' });
  } catch (error) {
    console.error('Logout error:', error);
  }
  await loadSession();
  await loadTrackedManga();
}

function initializeLoginModal() {
  const modal = document.getElementById('login-modal');
  const cancelBtn = document.getElementById('login-cancel');
  const submitBtn = document.getElementById('login-submit');
  const password = document.getElementById('login-password');
  if (!modal || !cancelBtn || !submitBtn) {
    return;
  }

  cancelBtn.addEventListener('click', hideLoginModal);
  submitBtn.addEventListener('click', submitLogin);
  modal.addEventListener('click', event => {
    if (event.target === modal) {
      hideLoginModal();
    }
  });
  if (password) {
    password.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submitLogin();
      }
    });
  }
}
```

In the `DOMContentLoaded` handler, add `initializeLoginModal();` and `loadSession();` alongside the existing init calls:

```javascript
  initializeSourceModal();
  initializeLoginModal();
  initializeHeaderPalette();
  loadSession();
  loadTrackedManga();
  startCountdownTimer();
```

- [ ] **Step 3: Add styles to `public/styles.css`**

Append:

```css
.header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.auth-control {
  display: flex;
  align-items: center;
  gap: 10px;
}

.auth-user {
  font-family: 'IBM Plex Mono', monospace;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.btn-auth {
  padding: 8px 14px;
  font-size: 0.85rem;
}

.demo-banner {
  margin-top: 12px;
  padding: 10px 14px;
  border: 3px solid #000;
  background: var(--theme-ui-bg, #FDBA74);
  font-family: 'IBM Plex Mono', monospace;
  font-weight: 700;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
```

- [ ] **Step 4: Manual verification**

Run: `npm run dev` (serves at `http://localhost:3000`).

Verify:
1. Logged out: top-right shows `SIGN IN`; the demo banner is visible; the refresh (↻) button is hidden; the library shows the demo titles (One Piece + Kagurabachi) — note the demo seeds on startup, which requires network access to MangaUpdates.
2. Click `SIGN IN`, enter `phil` / `0000` → modal closes, top-right shows `phil` + `SIGN OUT`, banner disappears, refresh button appears, and your real library loads.
3. Reload the page → still signed in (cookie remembered).
4. Click `SIGN OUT` → returns to the demo view.
5. Wrong password shows the inline error and does not sign in.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/app.js public/styles.css
git commit -m "$(cat <<'EOF'
Add sign-in control, login modal, and demo banner

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Configuration, docs, and final verification

**Files:**
- Modify: `ecosystem.config.js`, `README.md`

- [ ] **Step 1: Document env vars in `ecosystem.config.js`**

Add the new variables to `env_production` (and mirror harmless defaults to `env`). Replace the file contents with:

```javascript
module.exports = {
  apps: [{
    name: 'manga-tracker',
    script: './server.js',
    env: {
      NODE_ENV: 'development',
      PORT: 3000,
      BASE_PATH: ''
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3001,
      BASE_PATH: '/manga-tracker',
      // Auth — override ADMIN_PASSWORD on the server for real security.
      // ADMIN_USERNAME: 'phil',
      // ADMIN_PASSWORD: '0000',
      // DEMO_USERNAME: 'demo',
      // SESSION_SECRET is auto-generated and persisted to data/session-secret
      // if not set here.
    }
  }]
};
```

- [ ] **Step 2: Update `README.md`**

Insert this section before the existing "## Configuration" heading:

```markdown
## Authentication & Public Demo

The app has one owner account and a shared public demo.

- **Owner:** signed in via the top-right SIGN IN button. Credentials come from
  `ADMIN_USERNAME` / `ADMIN_PASSWORD` (default `phil` / `0000`). The login is
  remembered with an HttpOnly cookie for 30 days.
- **Public demo:** logged-out visitors share a demo library (`DEMO_USERNAME`,
  default `demo`) pre-populated with One Piece and Kagurabachi. Anyone can edit
  it, and the daily 6:00 AM job resets it back to the snapshot (each title shows
  its 3 newest chapters as unread).

### Auth environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADMIN_USERNAME` | `phil` | Owner login name (set once at first start). |
| `ADMIN_PASSWORD` | `0000` | Owner password. Override on the server. Only applied while the owner has no password set. |
| `DEMO_USERNAME` | `demo` | Username of the shared demo account. |
| `SESSION_SECRET` | auto | HMAC secret for session cookies. Auto-generated and persisted to `data/session-secret` if unset. |
```

In the "## API Endpoints" list, add:

```markdown
- `POST /api/login` - Sign in (owner)
- `POST /api/logout` - Sign out
- `GET /api/me` - Current session info
```

and change the refresh line to note it is owner-only:

```markdown
- `POST /api/refresh` - Manually trigger chapter check (owner only)
```

- [ ] **Step 3: Confirm `data/` (and the session secret) stays gitignored**

Run: `git check-ignore data/session-secret`
Expected: prints `data/session-secret` (it lives under the already-ignored `data/` dir). If it does NOT print, add `data/` to `.gitignore`.

- [ ] **Step 4: Final full verification**

Run: `node --test`
Expected: PASS — all suites green.

Run: `git status`
Expected: clean working tree (everything committed).

- [ ] **Step 5: Commit**

```bash
git add ecosystem.config.js README.md
git commit -m "$(cat <<'EOF'
Document auth and demo configuration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Deployment note (after merge)

The live deploy preserves `data/` (DB + auto-generated `session-secret`). On first deploy of this change:
- The existing `user_id` 1 becomes `phil` (username/password set only if unset), so the live library is preserved.
- The `unread_backlog` migration runs once, assigning existing rows to `phil`.
- The demo seeds on startup (needs outbound MangaUpdates access) and resets daily at 6 AM.
- To use a non-default owner password, set `ADMIN_PASSWORD` in Coolify/PM2 env **before** first start (once `password_hash` is set, it is not overwritten).
</content>
