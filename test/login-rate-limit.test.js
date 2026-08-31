const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function cleanupModules() {
  ['../db', '../config'].forEach(name => {
    try {
      delete require.cache[require.resolve(name)];
    } catch {}
  });
}

test('five failed attempts lock an address and the lock survives a database reload', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-login-rate-test-'));
  let database;
  process.env.MANGA_TRACKER_DATA_DIR = tempDir;
  process.env.NODE_ENV = 'test';
  process.env.PUBLIC_ORIGIN = 'https://manga.example.test';
  process.env.SESSION_SECRET = '0123456789abcdef0123456789abcdef';
  process.env.ADMIN_USERNAME = 'owner';
  process.env.ADMIN_PASSWORD = 'correct-horse-battery';

  try {
    database = require('../db');
    const now = Date.parse('2026-08-31T12:00:00Z');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal(database.isLoginBlocked('203.0.113.9', now), false);
      database.recordLoginFailure('203.0.113.9', now);
    }
    assert.equal(database.isLoginBlocked('203.0.113.9', now), true);
    assert.equal(database.isLoginBlocked('198.51.100.4', now), false);

    database.closeDatabase();
    cleanupModules();
    database = require('../db');
    assert.equal(database.isLoginBlocked('203.0.113.9', now), true);
    database.closeDatabase();
  } finally {
    try {
      database?.closeDatabase();
    } catch {}
    delete process.env.MANGA_TRACKER_DATA_DIR;
    delete process.env.NODE_ENV;
    delete process.env.PUBLIC_ORIGIN;
    delete process.env.SESSION_SECRET;
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD;
    cleanupModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
