const test = require('node:test');
const assert = require('node:assert/strict');

test('production config rejects a missing session secret', () => {
  const { loadConfig } = require('../config');

  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://manga.example.test' }),
    /SESSION_SECRET/
  );
});

test('production config rejects weak secrets and malformed origins', () => {
  const { loadConfig } = require('../config');

  assert.throws(
    () => loadConfig({
      NODE_ENV: 'production',
      PUBLIC_ORIGIN: 'https://manga.example.test/path',
      SESSION_SECRET: 'short'
    }),
    /SESSION_SECRET|PUBLIC_ORIGIN/
  );
});

test('production config accepts explicit secure values without credential defaults', () => {
  const { loadConfig } = require('../config');
  const config = loadConfig({
    NODE_ENV: 'production',
    PUBLIC_ORIGIN: 'https://manga.example.test',
    SESSION_SECRET: '0123456789abcdef0123456789abcdef',
    ADMIN_USERNAME: 'owner',
    ADMIN_PASSWORD: 'correct-horse-battery'
  });

  assert.equal(config.publicOrigin, 'https://manga.example.test');
  assert.equal(config.adminUsername, 'owner');
  assert.equal(config.adminPassword, 'correct-horse-battery');
});

