import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';

import { assertCurrentSchema } from './migrations.js';

export function openDatabase(path: string, requireCurrentSchema = true): Database.Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const database = new Database(path);
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  if (path !== ':memory:') {
    database.pragma('journal_mode = WAL');
    database.pragma('wal_autocheckpoint = 1000');
    database.pragma('journal_size_limit = 67108864');
  }
  if (requireCurrentSchema) assertCurrentSchema(database);
  return database;
}
