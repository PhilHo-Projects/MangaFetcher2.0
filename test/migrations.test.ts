import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import {
  assertCurrentSchema,
  migrateDatabase,
  schemaVersion,
} from '../src/server/database/migrations.js';

function legacyDatabase(): Database.Database {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      password_hash TEXT,
      role TEXT DEFAULT 'user'
    );
    CREATE TABLE tracked_manga (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, manga_id TEXT NOT NULL,
      manga_title TEXT NOT NULL, cover_url TEXT, source_url TEXT, provider TEXT,
      provider_series_id TEXT, latest_chapter_number INTEGER, last_read_chapter_number INTEGER,
      migration_status TEXT, added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id), UNIQUE(user_id, manga_id)
    );
    CREATE TABLE read_chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, manga_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL, chapter_number TEXT, read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id), UNIQUE(user_id, chapter_id)
    );
    CREATE TABLE chapter_cache (
      manga_id TEXT NOT NULL, chapter_id TEXT NOT NULL, chapter_number TEXT, title TEXT,
      published_at DATETIME, created_at DATETIME, position INTEGER NOT NULL DEFAULT 0,
      cached_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (manga_id, chapter_id)
    );
    CREATE TABLE manga_cache_state (
      manga_id TEXT PRIMARY KEY, last_checked_at DATETIME, last_success_at DATETIME, last_error TEXT
    );
    CREATE TABLE unread_backlog (
      user_id INTEGER NOT NULL, manga_id TEXT NOT NULL, chapter_number INTEGER NOT NULL,
      detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, manga_id, chapter_number)
    );
    CREATE TABLE login_rate_limits (
      address TEXT PRIMARY KEY, window_started_at INTEGER NOT NULL, failure_count INTEGER NOT NULL
    );
    INSERT INTO users(id, username, password_hash, role) VALUES
      (1, 'phil', 'legacy-hash', 'owner'), (2, 'demo', NULL, 'demo');
  `);
  const tracked = database.prepare(
    `INSERT INTO tracked_manga(user_id, manga_id, manga_title) VALUES (1, ?, ?)`,
  );
  const read = database.prepare(
    `INSERT INTO read_chapters(user_id, manga_id, chapter_id, chapter_number) VALUES (1, ?, ?, ?)`,
  );
  const backlog = database.prepare(
    `INSERT INTO unread_backlog(user_id, manga_id, chapter_number) VALUES (1, ?, ?)`,
  );
  for (let index = 1; index <= 9; index += 1) tracked.run(`m${index}`, `Manga ${index}`);
  for (let index = 1; index <= 79; index += 1) read.run(`m${(index % 9) + 1}`, `c${index}`, index);
  for (let index = 1; index <= 29; index += 1) backlog.run('m1', index);
  return database;
}

describe('versioned database migrations', () => {
  it('baselines the expected legacy schema and preserves every scoped row through auth schema', () => {
    const database = legacyDatabase();
    migrateDatabase(database, 2);

    expect(schemaVersion(database)).toBe(2);
    expect(database.prepare('SELECT id, username FROM users ORDER BY id').all()).toEqual([
      { id: 1, username: 'phil' },
      { id: 2, username: 'demo' },
    ]);
    expect(database.prepare('SELECT COUNT(*) AS count FROM tracked_manga').get()).toEqual({ count: 9 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM read_chapters').get()).toEqual({ count: 79 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM unread_backlog').get()).toEqual({ count: 29 });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'session'").get()).toBeTruthy();
    expect(database.prepare('PRAGMA table_info(users)').all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'auth_user_id' })]),
    );
    database.close();
  });

  it('refuses unknown migration versions', () => {
    const database = legacyDatabase();
    migrateDatabase(database, 2);
    database.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (99, ?)').run(
      new Date().toISOString(),
    );
    expect(() => migrateDatabase(database)).toThrow(/unknown schema migration/i);
    database.close();
  });

  it('refuses application startup while a reviewed migration is still pending', () => {
    const database = legacyDatabase();
    migrateDatabase(database, 2);
    expect(() => assertCurrentSchema(database)).toThrow(/not current/i);
    database.close();
  });

  it('refuses to baseline a legacy schema missing required columns', () => {
    const database = legacyDatabase();
    database.exec('ALTER TABLE users DROP COLUMN password_hash');
    expect(() => migrateDatabase(database, 2)).toThrow(/legacy schema/i);
    database.close();
  });
});
