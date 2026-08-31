const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { hashPassword, verifyPassword } = require('../password');

test('controlled reset replaces only the owner password and rejects weak replacements', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-owner-reset-test-'));
  const databasePath = path.join(tempDir, 'manga-tracker.db');
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL,
      password_hash TEXT,
      role TEXT NOT NULL
    )
  `);
  database.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run(1, 'phil', hashPassword('old-insecure-password'), 'owner');
  database.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run(2, 'demo', null, 'demo');
  database.close();

  try {
    const { resetOwnerPassword } = require('../scripts/reset-owner-password');
    assert.throws(
      () => resetOwnerPassword({ databasePath, password: 'too-short' }),
      /at least 12 characters/
    );

    resetOwnerPassword({ databasePath, password: 'new-correct-horse-battery' });

    const verified = new Database(databasePath, { readonly: true });
    const owner = verified.prepare('SELECT password_hash FROM users WHERE id = 1').get();
    const demo = verified.prepare('SELECT password_hash FROM users WHERE id = 2').get();
    assert.equal(verifyPassword('old-insecure-password', owner.password_hash), false);
    assert.equal(verifyPassword('new-correct-horse-battery', owner.password_hash), true);
    assert.equal(demo.password_hash, null);
    verified.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

