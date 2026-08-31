import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/server/app.js';
import { buildAuth } from '../src/server/auth.js';
import type { RuntimeConfig } from '../src/server/config.js';
import { LibraryRepository } from '../src/server/database/library-repository.js';
import { migrateDatabase } from '../src/server/database/migrations.js';
import { migrateOwnerIdentity } from '../src/server/database/owner-migration.js';

const ORIGIN = 'https://manga.example.test';
const PASSWORD = 'correct-horse-battery';
type MangaResponse = { manga_id: string };
const config: RuntimeConfig = {
  environment: 'test',
  publicOrigin: ORIGIN,
  sessionSecret: '0123456789abcdef0123456789abcdef',
  port: 3001,
  databasePath: ':memory:',
  dataDirectory: '.',
  clientDirectory: '.',
  sessionMaxAgeSeconds: 30 * 24 * 60 * 60,
  ownerBootstrap: { username: 'phil', email: 'phil@example.test', password: PASSWORD },
};

type Harness = {
  database: Database.Database;
  auth: ReturnType<typeof buildAuth>;
  repository: LibraryRepository;
  server: Server;
  base: string;
};
const open: Harness[] = [];

async function harness(): Promise<Harness> {
  const database = new Database(':memory:');
  migrateDatabase(database, 1);
  database.exec(`
    INSERT INTO users(id, username, password_hash, role) VALUES
      (1, 'phil', 'legacy', 'owner'), (2, 'demo', NULL, 'demo');
  `);
  migrateDatabase(database, 2);
  const auth = buildAuth({ database, config });
  await migrateOwnerIdentity({ auth, database, bootstrap: config.ownerBootstrap });
  migrateDatabase(database, 3);
  const repository = new LibraryRepository(database);
  repository.track(2, {
    mangaId: 'demo-title',
    title: 'Demo Title',
    coverUrl: '',
    sourceUrl: '',
    latestChapterNumber: 4,
    lastReadChapterNumber: 1,
  });
  repository.replaceBacklog(2, 'demo-title', [2, 3, 4]);
  const app = createApp({
    auth,
    config,
    repository,
    provider: {
      search: () => Promise.resolve([]),
      details: (id: string) => Promise.resolve({
        id,
        title: 'Test Manga',
        latestChapter: 5,
        imageUrl: '',
        url: '',
        type: '',
        status: '',
      }),
    },
    refresh: () => Promise.resolve({ success: true }),
    nextCheck: () => null,
    now: () => new Date('2026-08-31T12:00:00.000Z'),
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const result = { database, auth, repository, server, base };
  open.push(result);
  return result;
}

async function ownerCookie(auth: ReturnType<typeof buildAuth>): Promise<string> {
  const response = await auth.api.signInUsername({
    body: { username: 'phil', password: PASSWORD },
    asResponse: true,
  });
  return response.headers.get('set-cookie')?.split(';')[0] ?? '';
}

beforeEach(() => open.splice(0));
afterEach(async () => {
  for (const item of open) {
    await new Promise<void>((resolve, reject) =>
      item.server.close((error?: Error) => (error ? reject(error) : resolve())),
    );
    item.database.close();
  }
});

describe('default-deny API authorization', () => {
  it('exposes only the explicit anonymous demo allowlist', async () => {
    const app = await harness();
    const health = await fetch(`${app.base}/health`);
    expect(health.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(health.headers.get('x-content-type-options')).toBe('nosniff');
    for (const path of ['/health', '/api/me', '/api/manga', '/api/manga/demo-title/chapters', '/api/next-check']) {
      expect((await fetch(`${app.base}${path}`)).status, path).toBe(200);
    }
    expect((await fetch(`${app.base}/api/search?title=test`)).status).toBe(401);
    expect((await fetch(`${app.base}/api/not-a-public-route`)).status).toBe(401);
    expect((await fetch(`${app.base}/api/manga/not-demo-tracked/chapters`)).status).toBe(404);
  });

  it('rejects anonymous writes and every unsafe request from the wrong origin', async () => {
    const app = await harness();
    const input = JSON.stringify({ mangaId: 'm1', title: 'Manga' });
    const anonymous = await fetch(`${app.base}/api/track`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: input,
    });
    expect(anonymous.status).toBe(401);
    expect(((await anonymous.json()) as { error: { code: string } }).error.code).toBe('UNAUTHORIZED');

    const wrongOrigin = await fetch(`${app.base}/api/track`, {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: input,
    });
    expect(wrongOrigin.status).toBe(403);
    expect(((await wrongOrigin.json()) as { error: { code: string } }).error.code).toBe('ORIGIN_REJECTED');
  });
});

describe('owner account lifecycle', () => {
  it('approves exactly one mapped application user and re-approval is idempotent', async () => {
    const app = await harness();
    await app.auth.api.signUpEmail({
      body: { email: 'friend@example.test', name: 'friend', username: 'friend', password: PASSWORD },
    });
    const target = app.database
      .prepare('SELECT "id" FROM "user" WHERE "username" = ?')
      .get('friend') as { id: string };
    const cookie = await ownerCookie(app.auth);
    const approve = () =>
      fetch(`${app.base}/api/admin/users/${target.id}/approve`, {
        method: 'POST',
        headers: { cookie, origin: ORIGIN },
      });
    expect((await approve()).status).toBe(200);
    expect((await approve()).status).toBe(200);
    expect(
      app.database.prepare('SELECT COUNT(*) AS count FROM users WHERE auth_user_id = ?').get(target.id),
    ).toEqual({ count: 1 });
  });

  it('revokes a member immediately on rejection and keeps their library mapping', async () => {
    const app = await harness();
    await app.auth.api.signUpEmail({
      body: { email: 'friend@example.test', name: 'friend', username: 'friend', password: PASSWORD },
    });
    const target = app.database
      .prepare('SELECT "id" FROM "user" WHERE "username" = ?')
      .get('friend') as { id: string };
    app.repository.approveIdentity(target.id, 'owner', new Date());
    const memberSignIn = await app.auth.api.signInUsername({
      body: { username: 'friend', password: PASSWORD },
      asResponse: true,
    });
    const memberCookie = memberSignIn.headers.get('set-cookie')?.split(';')[0] ?? '';
    const owner = await ownerCookie(app.auth);
    expect(
      (
        await fetch(`${app.base}/api/admin/users/${target.id}/reject`, {
          method: 'POST',
          headers: { cookie: owner, origin: ORIGIN },
        })
      ).status,
    ).toBe(200);
    expect(await app.auth.api.getSession({ headers: new Headers({ cookie: memberCookie }) })).toBeNull();
    expect(app.repository.appUserByAuthId(target.id)).not.toBeNull();
    const applicationUserId = app.repository.appUserByAuthId(target.id)?.id;
    app.repository.approveIdentity(target.id, 'owner', new Date());
    expect(app.repository.appUserByAuthId(target.id)?.id).toBe(applicationUserId);
  });

  it('allows only the owner to refresh', async () => {
    const app = await harness();
    await app.auth.api.signUpEmail({
      body: { email: 'friend@example.test', name: 'friend', username: 'friend', password: PASSWORD },
    });
    const target = app.database
      .prepare('SELECT "id" FROM "user" WHERE "username" = ?')
      .get('friend') as { id: string };
    app.repository.approveIdentity(target.id, 'owner', new Date());
    const response = await app.auth.api.signInUsername({
      body: { username: 'friend', password: PASSWORD },
      asResponse: true,
    });
    const member = response.headers.get('set-cookie')?.split(';')[0] ?? '';
    expect(
      (
        await fetch(`${app.base}/api/refresh`, {
          method: 'POST',
          headers: { cookie: member, origin: ORIGIN },
        })
      ).status,
    ).toBe(403);
    expect((await fetch(`${app.base}/api/admin/users`, { headers: { cookie: member } })).status).toBe(403);
  });

  it('isolates a member library from the anonymous demo', async () => {
    const app = await harness();
    await app.auth.api.signUpEmail({
      body: { email: 'friend@example.test', name: 'friend', username: 'friend', password: PASSWORD },
    });
    const target = app.database
      .prepare('SELECT "id" FROM "user" WHERE "username" = ?')
      .get('friend') as { id: string };
    const mapped = app.repository.approveIdentity(target.id, 'owner', new Date());
    app.repository.track(mapped.id, {
      mangaId: 'private-title',
      title: 'Private Title',
      coverUrl: '',
      sourceUrl: '',
      latestChapterNumber: 1,
      lastReadChapterNumber: 0,
    });
    const signedIn = await app.auth.api.signInUsername({
      body: { username: 'friend', password: PASSWORD },
      asResponse: true,
    });
    const cookie = signedIn.headers.get('set-cookie')?.split(';')[0] ?? '';
    const privateLibrary = (await (
      await fetch(`${app.base}/api/manga`, { headers: { cookie } })
    ).json()) as { data: MangaResponse[] };
    const demoLibrary = (await (await fetch(`${app.base}/api/manga`)).json()) as {
      data: MangaResponse[];
    };
    expect(privateLibrary.data.map((manga) => manga.manga_id)).toContain('private-title');
    expect(demoLibrary.data.map((manga) => manga.manga_id)).not.toContain('private-title');
  });

  it('resets to a one-time temporary password and gates the session until password change', async () => {
    const app = await harness();
    await app.auth.api.signUpEmail({
      body: { email: 'friend@example.test', name: 'friend', username: 'friend', password: PASSWORD },
    });
    const target = app.database
      .prepare('SELECT "id" FROM "user" WHERE "username" = ?')
      .get('friend') as { id: string };
    app.repository.approveIdentity(target.id, 'owner', new Date());
    const original = await app.auth.api.signInUsername({
      body: { username: 'friend', password: PASSWORD },
      asResponse: true,
    });
    const originalCookie = original.headers.get('set-cookie')?.split(';')[0] ?? '';
    const owner = await ownerCookie(app.auth);
    const reset = await fetch(`${app.base}/api/admin/users/${target.id}/reset-password`, {
      method: 'POST',
      headers: { cookie: owner, origin: ORIGIN },
    });
    expect(reset.status).toBe(200);
    const temporaryPassword = ((await reset.json()) as { data: { temporaryPassword: string } }).data
      .temporaryPassword;
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(12);
    expect(await app.auth.api.getSession({ headers: new Headers({ cookie: originalCookie }) })).toBeNull();

    const temporary = await app.auth.api.signInUsername({
      body: { username: 'friend', password: temporaryPassword },
      asResponse: true,
    });
    const temporaryCookie = temporary.headers.get('set-cookie')?.split(';')[0] ?? '';
    const blocked = await fetch(`${app.base}/api/search?title=test`, {
      headers: { cookie: temporaryCookie },
    });
    expect(blocked.status).toBe(403);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe(
      'PASSWORD_CHANGE_REQUIRED',
    );
    const unrelatedAuth = await fetch(`${app.base}/api/auth/update-user`, {
      method: 'POST',
      headers: { cookie: temporaryCookie, origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bypass Attempt' }),
    });
    expect(unrelatedAuth.status).toBe(403);
    expect(((await unrelatedAuth.json()) as { error: { code: string } }).error.code).toBe(
      'PASSWORD_CHANGE_REQUIRED',
    );

    const changed = await fetch(`${app.base}/api/auth/change-password`, {
      method: 'POST',
      headers: { cookie: temporaryCookie, origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: temporaryPassword, newPassword: 'brand-new-password-123' }),
    });
    expect(changed.status).toBe(200);
    expect(
      app.database.prepare('SELECT "mustChangePassword" FROM "user" WHERE "id" = ?').get(target.id),
    ).toEqual({ mustChangePassword: 0 });
  });
});
