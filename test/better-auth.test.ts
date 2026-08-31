import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildAuth } from '../src/server/auth.js';
import type { RuntimeConfig } from '../src/server/config.js';
import { migrateDatabase } from '../src/server/database/migrations.js';

const PASSWORD = 'correct-horse-battery';
const config: RuntimeConfig = {
  environment: 'test',
  publicOrigin: 'https://manga.example.test',
  sessionSecret: '0123456789abcdef0123456789abcdef',
  port: 3001,
  databasePath: ':memory:',
  dataDirectory: '.',
  clientDirectory: '.',
  sessionMaxAgeSeconds: 30 * 24 * 60 * 60,
  ownerBootstrap: null,
};

let database: Database.Database;
let auth: ReturnType<typeof buildAuth>;

beforeEach(() => {
  database = new Database(':memory:');
  migrateDatabase(database, 2);
  auth = buildAuth({ database, config });
});

afterEach(() => database.close());

async function signUp(username: string): Promise<void> {
  await auth.api.signUpEmail({
    body: { email: `${username}@example.test`, name: username, password: PASSWORD, username },
  });
}

function approve(username: string): void {
  database
    .prepare('UPDATE "user" SET "approvalStatus" = ? WHERE "username" = ?')
    .run('approved', username);
}

describe('Better Auth account gate', () => {
  it('rejects role injection and strips server-owned approval fields', async () => {
    await expect(auth.api.signUpEmail({
      body: {
        email: 'sneak@example.test',
        name: 'sneak',
        password: PASSWORD,
        username: 'sneak',
        role: 'admin',
      } as never,
    })).rejects.toThrow(/role is not allowed/i);

    await auth.api.signUpEmail({
      body: {
        email: 'friend@example.test',
        name: 'friend',
        password: PASSWORD,
        username: 'friend',
        approvalStatus: 'approved',
        mustChangePassword: true,
      } as never,
    });

    expect(
      database
        .prepare(
          'SELECT "role", "approvalStatus", "mustChangePassword" FROM "user" WHERE "username" = ?',
        )
        .get('friend'),
    ).toEqual({ role: 'user', approvalStatus: 'pending', mustChangePassword: 0 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM session').get()).toEqual({ count: 0 });
  });

  it.each([
    ['pending', 'ACCOUNT_PENDING'],
    ['rejected', 'ACCOUNT_REJECTED'],
  ])('refuses a %s identity without creating a session', async (status, code) => {
    await signUp('friend');
    database.prepare('UPDATE "user" SET "approvalStatus" = ?').run(status);
    await expect(
      auth.api.signInUsername({ body: { username: 'friend', password: PASSWORD } }),
    ).rejects.toMatchObject({ status: 'FORBIDDEN', body: { code } });
    expect(database.prepare('SELECT COUNT(*) AS count FROM session').get()).toEqual({ count: 0 });
  });

  it('creates a revocable database session for an approved identity', async () => {
    await signUp('friend');
    approve('friend');
    const response = await auth.api.signInUsername({
      body: { username: 'friend', password: PASSWORD },
      asResponse: true,
    });
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    expect(cookie).toBeTruthy();
    expect(await auth.api.getSession({ headers: new Headers({ cookie: cookie ?? '' }) })).not.toBeNull();
    database.prepare('DELETE FROM session').run();
    expect(await auth.api.getSession({ headers: new Headers({ cookie: cookie ?? '' }) })).toBeNull();
  });

  it('rejects tampered and expired database sessions', async () => {
    await signUp('friend');
    approve('friend');
    const response = await auth.api.signInUsername({
      body: { username: 'friend', password: PASSWORD },
      asResponse: true,
    });
    const cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
    expect(await auth.api.getSession({ headers: new Headers({ cookie: `${cookie}tampered` }) })).toBeNull();
    database.prepare('UPDATE session SET "expiresAt" = ?').run(new Date(0).toISOString());
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
  });
});

describe('persistent limits and production cookie', () => {
  it('throttles the sixth sign-in attempt per IP and persists the counter', async () => {
    await signUp('friend');
    approve('friend');
    const request = () =>
      auth.handler(
        new Request('https://manga.example.test/api/auth/sign-in/username', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
          body: JSON.stringify({ username: 'friend', password: 'wrong-password-here' }),
        }),
      );
    for (let attempt = 0; attempt < 5; attempt += 1) expect((await request()).status).toBe(401);
    expect((await request()).status).toBe(429);
    expect(database.prepare('SELECT COUNT(*) AS count FROM "rateLimit"').get()).toEqual({ count: 1 });
  });

  it('throttles the fourth sign-up per IP in one hour', async () => {
    const request = (index: number) =>
      auth.handler(
        new Request('https://manga.example.test/api/auth/sign-up/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.2' },
          body: JSON.stringify({
            username: `member${index}`,
            name: `member${index}`,
            email: `member${index}@example.test`,
            password: PASSWORD,
          }),
        }),
      );
    for (let attempt = 1; attempt <= 3; attempt += 1) expect((await request(attempt)).status).toBe(200);
    expect((await request(4)).status).toBe(429);
  });

  it('emits the literal __Host cookie with every required attribute', async () => {
    const productionAuth = buildAuth({ database, config: { ...config, environment: 'production' } });
    await productionAuth.api.signUpEmail({
      body: { email: 'prod@example.test', name: 'prod', password: PASSWORD, username: 'prod' },
    });
    approve('prod');
    const response = await productionAuth.api.signInUsername({
      body: { username: 'prod', password: PASSWORD },
      asResponse: true,
    });
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie.split('=')[0]).toBe('__Host-mt_session');
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\//i);
    expect(cookie).toMatch(/Max-Age=2592000/i);
    expect(cookie).not.toMatch(/Domain=/i);
  });
});
