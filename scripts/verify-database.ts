import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/database/connection.js';
import { CURRENT_SCHEMA_VERSION, schemaVersion } from '../src/server/database/migrations.js';

const config = loadConfig();
const database = openDatabase(config.databasePath);
try {
  const count = (table: string): number =>
    (database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number }).count;
  const owner = database.prepare('SELECT id, username, auth_user_id FROM users WHERE id = 1').get();
  const demo = database.prepare('SELECT id, username, auth_user_id FROM users WHERE id = 2').get();
  console.info(
    JSON.stringify({
      integrity: database.pragma('integrity_check', { simple: true }),
      schemaVersion: schemaVersion(database),
      expectedSchemaVersion: CURRENT_SCHEMA_VERSION,
      owner,
      demo,
      counts: {
        users: count('users'),
        trackedManga: count('tracked_manga'),
        readChapters: count('read_chapters'),
        unreadBacklog: count('unread_backlog'),
      },
    }),
  );
} finally {
  database.close();
}
