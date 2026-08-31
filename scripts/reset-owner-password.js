const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { hashPassword } = require('../password');

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('Replacement password must be at least 12 characters');
  }
  if (password === '0000') {
    throw new Error('Replacement password must not use the retired fallback');
  }
}

function resetOwnerPassword({ databasePath, password }) {
  validatePassword(password);
  const resolvedPath = path.resolve(databasePath);
  const database = new Database(resolvedPath, { fileMustExist: true });

  try {
    const reset = database.transaction(() => {
      const owner = database.prepare("SELECT id FROM users WHERE id = 1 AND role = 'owner'").get();
      if (!owner) {
        throw new Error('Owner row 1 was not found');
      }
      database.prepare('UPDATE users SET password_hash = ? WHERE id = 1').run(hashPassword(password));
    });
    reset();
  } finally {
    database.close();
  }
}

function resolveDatabasePath(environment) {
  if (environment.MANGA_TRACKER_DB_PATH) {
    return environment.MANGA_TRACKER_DB_PATH;
  }
  const dataDirectory = environment.MANGA_TRACKER_DATA_DIR || path.join(__dirname, '..', 'data');
  return path.join(dataDirectory, 'manga-tracker.db');
}

if (require.main === module) {
  try {
    const password = fs.readFileSync(0, 'utf8').replace(/\r?\n$/, '');
    resetOwnerPassword({
      databasePath: resolveDatabasePath(process.env),
      password
    });
    process.stdout.write('Owner password reset successfully.\n');
  } catch (error) {
    process.stderr.write(`Owner password reset failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { resetOwnerPassword, resolveDatabasePath };

