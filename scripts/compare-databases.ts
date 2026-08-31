import Database from 'better-sqlite3';

const beforePath = process.env.MANGA_TRACKER_BEFORE_DB_PATH;
const afterPath = process.env.MANGA_TRACKER_AFTER_DB_PATH;
if (!beforePath || !afterPath) {
  throw new Error('MANGA_TRACKER_BEFORE_DB_PATH and MANGA_TRACKER_AFTER_DB_PATH are required');
}

const before = new Database(beforePath, { readonly: true, fileMustExist: true });
const after = new Database(afterPath, { readonly: true, fileMustExist: true });

function rows(database: Database.Database, table: string): Record<string, unknown>[] {
  return database
    .prepare(`SELECT user_id AS userId, COUNT(*) AS count FROM "${table}" GROUP BY user_id ORDER BY user_id`)
    .all() as Record<string, unknown>[];
}

try {
  const beforeIntegrity = before.pragma('integrity_check', { simple: true }) as string;
  const afterIntegrity = after.pragma('integrity_check', { simple: true }) as string;
  if (beforeIntegrity !== 'ok' || afterIntegrity !== 'ok') throw new Error('SQLite integrity check failed');
  const beforeUsers = before.prepare('SELECT id, username FROM users ORDER BY id').all();
  const afterUsers = after.prepare('SELECT id, username FROM users ORDER BY id').all();
  const tables = ['tracked_manga', 'read_chapters', 'unread_backlog'] as const;
  const comparisons = Object.fromEntries(
    tables.map((table) => {
      const beforeRows = rows(before, table);
      const afterRows = rows(after, table);
      if (JSON.stringify(beforeRows) !== JSON.stringify(afterRows)) {
        throw new Error(`User-scoped counts changed for ${table}`);
      }
      return [table, afterRows];
    }),
  );
  if (JSON.stringify(beforeUsers) !== JSON.stringify(afterUsers)) {
    throw new Error('Application user IDs or usernames changed');
  }
  console.info(JSON.stringify({ integrity: 'ok', users: afterUsers, userScopedCounts: comparisons }));
} finally {
  before.close();
  after.close();
}
