const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadFreshDb(tempDir) {
  delete require.cache[require.resolve('../db')];
  process.env.MANGA_TRACKER_DATA_DIR = tempDir;
  return require('../db');
}

function cleanup(tempDir) {
  delete process.env.MANGA_TRACKER_DATA_DIR;
  delete require.cache[require.resolve('../db')];
  fs.rmSync(tempDir, { recursive: true, force: true });
}

test('db init seeds owner (user 1 = phil, role owner) with a usable password', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-auth-seed-test-'));
  const dbModule = loadFreshDb(tempDir);
  const { verifyPassword } = require('../password');

  try {
    const owner = dbModule.getUser(1);
    assert.equal(owner.username, 'phil');
    assert.equal(owner.role, 'owner');
    assert.equal(verifyPassword('0000', owner.password_hash), true);
  } finally {
    dbModule.closeDatabase();
    cleanup(tempDir);
  }
});

test('db init seeds a demo user with role demo', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-auth-demo-test-'));
  const dbModule = loadFreshDb(tempDir);

  try {
    const demo = dbModule.getUserByUsername('demo');
    assert.ok(demo, 'demo user should exist');
    assert.equal(demo.role, 'demo');
    assert.notEqual(demo.id, 1);
  } finally {
    dbModule.closeDatabase();
    cleanup(tempDir);
  }
});
