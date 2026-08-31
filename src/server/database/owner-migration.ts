import type Database from 'better-sqlite3';

import type { AppAuth } from '../auth.js';
import type { OwnerBootstrap } from '../config.js';

type OwnerMigrationOptions = {
  auth: AppAuth;
  database: Database.Database;
  bootstrap: OwnerBootstrap | null;
  log?: (message: string) => void;
};

type AppOwner = {
  id: number;
  username: string;
  authUserId: string | null;
};

export async function migrateOwnerIdentity({
  auth,
  database,
  bootstrap,
  log,
}: OwnerMigrationOptions): Promise<string> {
  let owner = database
    .prepare('SELECT id, username, auth_user_id AS authUserId FROM users WHERE id = 1')
    .get() as AppOwner | undefined;

  if (!owner) {
    if (!bootstrap) throw new Error('Owner bootstrap credentials are required for an uninitialized owner');
    database.prepare('INSERT INTO users(id, username) VALUES (1, ?)').run(bootstrap.username);
    owner = { id: 1, username: bootstrap.username, authUserId: null };
  }
  if (owner.authUserId) {
    const identity = database
      .prepare('SELECT "id" FROM "user" WHERE "id" = ? AND "role" = ? AND "approvalStatus" = ?')
      .get(owner.authUserId, 'admin', 'approved');
    if (!identity) throw new Error('Mapped owner identity is missing or no longer approved');
    return owner.authUserId;
  }
  if (!bootstrap) throw new Error('Owner bootstrap credentials are required until migration succeeds');
  if (owner.username !== bootstrap.username) {
    throw new Error('Owner bootstrap username does not match legacy owner id=1');
  }

  let identity = database
    .prepare('SELECT "id", "email" FROM "user" WHERE "username" = ?')
    .get(bootstrap.username) as { id: string; email: string } | undefined;
  if (!identity) {
    await auth.api.signUpEmail({
      body: {
        email: bootstrap.email,
        name: bootstrap.username,
        password: bootstrap.password,
        username: bootstrap.username,
      },
    });
    identity = database
      .prepare('SELECT "id", "email" FROM "user" WHERE "username" = ?')
      .get(bootstrap.username) as { id: string; email: string } | undefined;
  }
  if (!identity || identity.email.toLocaleLowerCase() !== bootstrap.email.toLocaleLowerCase()) {
    throw new Error('Owner identity migration produced an unexpected identity');
  }

  const transaction = database.transaction(() => {
    const timestamp = new Date().toISOString();
    database
      .prepare(
        `UPDATE "user"
         SET "role" = 'admin', "approvalStatus" = 'approved', "mustChangePassword" = 0,
             "approvedAt" = ?, "approvedBy" = ?, "banned" = 0,
             "banReason" = NULL, "banExpires" = NULL
         WHERE "id" = ?`,
      )
      .run(timestamp, identity.id, identity.id);
    const mapped = database
      .prepare('UPDATE users SET auth_user_id = ? WHERE id = 1 AND auth_user_id IS NULL')
      .run(identity.id);
    if (mapped.changes !== 1) throw new Error('Owner application-user mapping failed');
    database
      .prepare("INSERT OR IGNORE INTO users(id, username, auth_user_id) VALUES (2, 'demo', NULL)")
      .run();
  });
  transaction();
  log?.(`migrated Better Auth owner identity for application user ${owner.id}`);
  return identity.id;
}
