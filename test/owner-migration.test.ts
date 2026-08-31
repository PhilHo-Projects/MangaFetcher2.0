import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { buildAuth } from '../src/server/auth.js';
import type { RuntimeConfig } from '../src/server/config.js';
import { migrateDatabase, schemaVersion } from '../src/server/database/migrations.js';
import { migrateOwnerIdentity } from '../src/server/database/owner-migration.js';

const config: RuntimeConfig = {
  environment: 'test',
  publicOrigin: 'https://manga.example.test',
  sessionSecret: '0123456789abcdef0123456789abcdef',
  port: 3001,
  databasePath: ':memory:',
  dataDirectory: '.',
  clientDirectory: '.',
  sessionMaxAgeSeconds: 30 * 24 * 60 * 60,
  ownerBootstrap: {
    username: 'phil',
    email: 'Philippeho27@gmail.com',
    password: 'rotated-owner-password',
  },
};

function legacyDatabase(): Database.Database {
  const database = new Database(':memory:');
  migrateDatabase(database, 1);
  database.exec(`
    INSERT INTO users(id, username, password_hash, role) VALUES
      (1, 'phil', 'legacy', 'owner'), (2, 'demo', NULL, 'demo');
  `);
  migrateDatabase(database, 2);
  return database;
}

describe('owner identity migration', () => {
  it('maps Better Auth to integer owner 1 and removes the legacy credential only after success', async () => {
    const database = legacyDatabase();
    const auth = buildAuth({ database, config });
    const authUserId = await migrateOwnerIdentity({ auth, database, bootstrap: config.ownerBootstrap });
    migrateDatabase(database, 3);

    expect(schemaVersion(database)).toBe(3);
    expect(database.prepare('SELECT id, username, auth_user_id FROM users ORDER BY id').all()).toEqual([
      { id: 1, username: 'phil', auth_user_id: authUserId },
      { id: 2, username: 'demo', auth_user_id: null },
    ]);
    expect(
      database.prepare('SELECT "role", "approvalStatus" FROM "user" WHERE "id" = ?').get(authUserId),
    ).toEqual({ role: 'admin', approvalStatus: 'approved' });
    const columns = database.prepare('PRAGMA table_info(users)').all() as { name: string }[];
    expect(columns.map((column) => column.name)).not.toContain('password_hash');
    expect(columns.map((column) => column.name)).not.toContain('role');
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'login_rate_limits'").get()).toBeUndefined();

    const response = await auth.api.signInUsername({
      body: { username: 'phil', password: config.ownerBootstrap?.password ?? '' },
      asResponse: true,
    });
    expect(response.status).toBe(200);
    database.close();
  });

  it('requires bootstrap credentials only until the owner identity exists', async () => {
    const database = legacyDatabase();
    const auth = buildAuth({ database, config });
    await expect(migrateOwnerIdentity({ auth, database, bootstrap: null })).rejects.toThrow(
      /bootstrap credentials/i,
    );
    const first = await migrateOwnerIdentity({ auth, database, bootstrap: config.ownerBootstrap });
    const second = await migrateOwnerIdentity({ auth, database, bootstrap: null });
    expect(second).toBe(first);
    database.close();
  });
});
