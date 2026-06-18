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

test('session tokens round-trip and reject tampering/expiry', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-auth-token-test-'));
  process.env.MANGA_TRACKER_DATA_DIR = tempDir;
  delete require.cache[require.resolve('../db')];
  delete require.cache[require.resolve('../auth')];
  const auth = require('../auth');
  const dbModule = require('../db');

  try {
    const secret = 'test-secret';
    const token = auth.createSessionToken(7, secret);
    assert.deepEqual(auth.verifySessionToken(token, secret), { userId: 7 });

    assert.equal(auth.verifySessionToken(token, 'wrong-secret'), null);
    assert.equal(auth.verifySessionToken(token + 'x', secret), null);
    assert.equal(auth.verifySessionToken('a.b.c', secret), null);
    assert.equal(auth.verifySessionToken('', secret), null);

    const expired = auth.createSessionToken(7, secret, -1000);
    assert.equal(auth.verifySessionToken(expired, secret), null);
  } finally {
    dbModule.closeDatabase();
    delete process.env.MANGA_TRACKER_DATA_DIR;
    delete require.cache[require.resolve('../auth')];
    delete require.cache[require.resolve('../db')];
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('parseCookies parses a cookie header into a map', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-auth-cookie-test-'));
  process.env.MANGA_TRACKER_DATA_DIR = tempDir;
  delete require.cache[require.resolve('../db')];
  delete require.cache[require.resolve('../auth')];
  const auth = require('../auth');
  const dbModule = require('../db');

  try {
    assert.deepEqual(auth.parseCookies('a=1; b=two'), { a: '1', b: 'two' });
    assert.deepEqual(auth.parseCookies(''), {});
    assert.deepEqual(auth.parseCookies(undefined), {});
  } finally {
    dbModule.closeDatabase();
    delete process.env.MANGA_TRACKER_DATA_DIR;
    delete require.cache[require.resolve('../auth')];
    delete require.cache[require.resolve('../db')];
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
