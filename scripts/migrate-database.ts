import { buildAuth } from '../src/server/auth.js';
import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/database/connection.js';
import { migrateDatabase, schemaVersion } from '../src/server/database/migrations.js';
import { migrateOwnerIdentity } from '../src/server/database/owner-migration.js';

const config = loadConfig();
const database = openDatabase(config.databasePath, false);
try {
  migrateDatabase(database, 2);
  const auth = buildAuth({ database, config });
  await migrateOwnerIdentity({ auth, database, bootstrap: config.ownerBootstrap });
  migrateDatabase(database);
  const integrity = database.pragma('integrity_check', { simple: true }) as string;
  if (integrity !== 'ok') throw new Error(`SQLite integrity check failed: ${integrity}`);
  console.info(`Database migration complete at schema ${schemaVersion(database)}; integrity=${integrity}`);
} finally {
  database.close();
}
