const test = require('node:test');
const assert = require('node:assert/strict');

const { hashPassword, verifyPassword } = require('../password');

test('hashPassword produces a scrypt string that verifyPassword accepts', () => {
  const stored = hashPassword('0000');
  assert.match(stored, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.equal(verifyPassword('0000', stored), true);
});

test('verifyPassword rejects a wrong password', () => {
  const stored = hashPassword('0000');
  assert.equal(verifyPassword('9999', stored), false);
});

test('verifyPassword rejects malformed stored values', () => {
  assert.equal(verifyPassword('0000', ''), false);
  assert.equal(verifyPassword('0000', null), false);
  assert.equal(verifyPassword('0000', 'not-a-hash'), false);
});

test('two hashes of the same password differ (random salt)', () => {
  assert.notEqual(hashPassword('same'), hashPassword('same'));
});
