import type Database from 'better-sqlite3';

type Migration = {
  version: number;
  sql: string;
  precondition?: (database: Database.Database) => void;
};

const LEGACY_SCHEMA_SQL = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    password_hash TEXT,
    role TEXT DEFAULT 'user'
  );
  CREATE TABLE tracked_manga (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    manga_id TEXT NOT NULL,
    manga_title TEXT NOT NULL,
    cover_url TEXT,
    source_url TEXT,
    provider TEXT,
    provider_series_id TEXT,
    latest_chapter_number INTEGER,
    last_read_chapter_number INTEGER,
    migration_status TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, manga_id)
  );
  CREATE TABLE read_chapters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    manga_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    chapter_number TEXT,
    read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, chapter_id)
  );
  CREATE TABLE chapter_cache (
    manga_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    chapter_number TEXT,
    title TEXT,
    published_at DATETIME,
    created_at DATETIME,
    position INTEGER NOT NULL DEFAULT 0,
    cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (manga_id, chapter_id)
  );
  CREATE TABLE manga_cache_state (
    manga_id TEXT PRIMARY KEY,
    last_checked_at DATETIME,
    last_success_at DATETIME,
    last_error TEXT
  );
  CREATE TABLE unread_backlog (
    user_id INTEGER NOT NULL,
    manga_id TEXT NOT NULL,
    chapter_number INTEGER NOT NULL,
    detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, manga_id, chapter_number)
  );
  CREATE TABLE login_rate_limits (
    address TEXT PRIMARY KEY,
    window_started_at INTEGER NOT NULL,
    failure_count INTEGER NOT NULL
  );
`;

const REQUIRED_LEGACY_COLUMNS: Record<string, readonly string[]> = {
  users: ['id', 'username', 'created_at', 'password_hash', 'role'],
  tracked_manga: [
    'id',
    'user_id',
    'manga_id',
    'manga_title',
    'source_url',
    'provider',
    'provider_series_id',
    'latest_chapter_number',
    'last_read_chapter_number',
    'migration_status',
  ],
  read_chapters: ['id', 'user_id', 'manga_id', 'chapter_id', 'chapter_number'],
  chapter_cache: ['manga_id', 'chapter_id', 'chapter_number', 'position'],
  manga_cache_state: ['manga_id', 'last_checked_at', 'last_success_at', 'last_error'],
  unread_backlog: ['user_id', 'manga_id', 'chapter_number', 'detected_at'],
  login_rate_limits: ['address', 'window_started_at', 'failure_count'],
};

const AUTH_SCHEMA_SQL = `
  ALTER TABLE users ADD COLUMN auth_user_id TEXT;
  CREATE UNIQUE INDEX users_auth_user_id_uidx ON users(auth_user_id);

  CREATE TABLE "user" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL UNIQUE,
    "emailVerified" INTEGER NOT NULL,
    "image" TEXT,
    "createdAt" DATE NOT NULL,
    "updatedAt" DATE NOT NULL,
    "username" TEXT UNIQUE,
    "displayUsername" TEXT,
    "role" TEXT NOT NULL,
    "approvalStatus" TEXT NOT NULL,
    "mustChangePassword" INTEGER NOT NULL,
    "approvedAt" TEXT,
    "approvedBy" TEXT,
    "banned" INTEGER DEFAULT 0,
    "banReason" TEXT,
    "banExpires" DATE
  );
  CREATE TABLE "session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "expiresAt" DATE NOT NULL,
    "token" TEXT NOT NULL UNIQUE,
    "createdAt" DATE NOT NULL,
    "updatedAt" DATE NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "impersonatedBy" TEXT
  );
  CREATE TABLE "account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issuer" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" DATE,
    "refreshTokenExpiresAt" DATE,
    "scope" TEXT,
    "password" TEXT,
    "createdAt" DATE NOT NULL,
    "updatedAt" DATE NOT NULL
  );
  CREATE TABLE "verification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" DATE NOT NULL,
    "createdAt" DATE NOT NULL,
    "updatedAt" DATE NOT NULL
  );
  CREATE TABLE "rateLimit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL UNIQUE,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL
  );
  CREATE TABLE operation_rate_limits (
    bucket TEXT NOT NULL,
    subject TEXT NOT NULL,
    window_started_at INTEGER NOT NULL,
    request_count INTEGER NOT NULL,
    PRIMARY KEY (bucket, subject)
  );
  CREATE INDEX IF NOT EXISTS idx_tracked_manga_user ON tracked_manga(user_id);
  CREATE INDEX IF NOT EXISTS idx_tracked_manga_provider
    ON tracked_manga(provider, provider_series_id, migration_status);
  CREATE INDEX IF NOT EXISTS idx_read_chapters_user_manga ON read_chapters(user_id, manga_id);
  CREATE INDEX IF NOT EXISTS idx_chapter_cache_manga_position ON chapter_cache(manga_id, position);
  CREATE INDEX IF NOT EXISTS idx_manga_cache_state_success ON manga_cache_state(last_success_at);
  CREATE INDEX IF NOT EXISTS idx_unread_backlog_manga
    ON unread_backlog(user_id, manga_id, chapter_number DESC);
  CREATE INDEX session_userId_idx ON "session"("userId");
  CREATE INDEX account_userId_idx ON "account"("userId");
  CREATE INDEX verification_identifier_idx ON "verification"("identifier");
  CREATE UNIQUE INDEX account_issuer_accountId_uidx ON "account"("issuer", "accountId");
`;

const MIGRATIONS: readonly Migration[] = [
  { version: 1, sql: LEGACY_SCHEMA_SQL },
  { version: 2, sql: AUTH_SCHEMA_SQL },
  {
    version: 3,
    precondition(database) {
      const owner = database
        .prepare(`
          SELECT users.auth_user_id AS authUserId, "user"."approvalStatus" AS approvalStatus
          FROM users
          JOIN "user" ON "user"."id" = users.auth_user_id
          WHERE users.id = 1
        `)
        .get() as { authUserId: string; approvalStatus: string } | undefined;
      if (!owner || owner.approvalStatus !== 'approved') {
        throw new Error('Owner Better Auth migration must succeed before legacy credentials are removed');
      }
      const credential = database
        .prepare("SELECT 1 AS found FROM account WHERE userId = ? AND providerId = 'credential'")
        .get(owner.authUserId);
      if (!credential) {
        throw new Error('Owner Better Auth credential is missing');
      }
    },
    sql: `
      ALTER TABLE users DROP COLUMN password_hash;
      ALTER TABLE users DROP COLUMN role;
      DROP TABLE login_rate_limits;
    `,
  },
];

export const CURRENT_SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0;

function tableExists(database: Database.Database, table: string): boolean {
  return Boolean(
    database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  );
}

function columns(database: Database.Database, table: string): Set<string> {
  const rows = database.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[];
  return new Set(rows.map((row) => row.name));
}

export function validateLegacySchema(database: Database.Database): void {
  for (const [table, expectedColumns] of Object.entries(REQUIRED_LEGACY_COLUMNS)) {
    if (!tableExists(database, table)) {
      throw new Error(`Legacy schema is missing table ${table}`);
    }
    const actual = columns(database, table);
    for (const column of expectedColumns) {
      if (!actual.has(column)) {
        throw new Error(`Legacy schema is missing ${table}.${column}`);
      }
    }
  }
  if (columns(database, 'users').has('auth_user_id') || tableExists(database, 'session')) {
    throw new Error('Legacy schema appears partially migrated');
  }
  const identities = database.prepare('SELECT id, username FROM users WHERE id IN (1, 2) ORDER BY id').all() as {
    id: number;
    username: string;
  }[];
  if (identities.length > 0 && (identities[0]?.id !== 1 || identities[1]?.id !== 2)) {
    throw new Error('Legacy schema must preserve owner id=1 and demo id=2');
  }
}

function ensureMigrationTable(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}

function establishBaseline(database: Database.Database): void {
  if (tableExists(database, 'schema_migrations')) return;
  database.exec('BEGIN IMMEDIATE');
  try {
    if (tableExists(database, 'users')) validateLegacySchema(database);
    else database.exec(LEGACY_SCHEMA_SQL);
    ensureMigrationTable(database);
    database
      .prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (1, ?)')
      .run(new Date().toISOString());
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function appliedVersions(database: Database.Database): number[] {
  return (database.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
    version: number;
  }[]).map((row) => row.version);
}

function assertKnownHistory(versions: readonly number[]): void {
  versions.forEach((version, index) => {
    if (version !== index + 1 || version > CURRENT_SCHEMA_VERSION) {
      throw new Error(`Unknown schema migration history: ${versions.join(', ')}`);
    }
  });
}

export function schemaVersion(database: Database.Database): number {
  if (!tableExists(database, 'schema_migrations')) return 0;
  const row = database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
    version: number | null;
  };
  return row.version ?? 0;
}

export function migrateDatabase(
  database: Database.Database,
  targetVersion = CURRENT_SCHEMA_VERSION,
): void {
  if (targetVersion < 1 || targetVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(`Unsupported schema target ${targetVersion}`);
  }
  establishBaseline(database);
  const versions = appliedVersions(database);
  assertKnownHistory(versions);
  let current = versions.at(-1) ?? 0;
  if (current > targetVersion) return;

  for (const migration of MIGRATIONS) {
    if (migration.version <= current || migration.version > targetVersion) continue;
    migration.precondition?.(database);
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(migration.sql);
      database
        .prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
        .run(migration.version, new Date().toISOString());
      database.exec('COMMIT');
      current = migration.version;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}

export function assertCurrentSchema(database: Database.Database): void {
  const versions = appliedVersions(database);
  assertKnownHistory(versions);
  if (versions.at(-1) !== CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Database schema ${versions.at(-1) ?? 0} is not current (${CURRENT_SCHEMA_VERSION}); run db:migrate`,
    );
  }
}
