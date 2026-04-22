const test = require('node:test');
const assert = require('node:assert/strict');

const KAGURABACHI_ID = 'd65c0332-3764-4c89-84bd-b1a4e7278ad7';
const SAKAMOTO_DAYS_ID = '9d9b04ad-9a83-49f4-8ae4-a9a3780fe9c0';

test('provides seeded source URLs for known series', () => {
  assert.doesNotThrow(() => require('../source-links'));

  const { getDefaultSourceUrl } = require('../source-links');

  assert.equal(getDefaultSourceUrl(KAGURABACHI_ID), 'https://readkagura.com/');
  assert.equal(
    getDefaultSourceUrl(SAKAMOTO_DAYS_ID),
    'https://www.readsakamotodays.com/'
  );
  assert.equal(getDefaultSourceUrl('unknown-series'), '');
});

test('validates source URLs and normalizes blank values', () => {
  assert.doesNotThrow(() => require('../source-links'));

  const { isValidSourceUrl, normalizeSourceUrl } = require('../source-links');

  assert.equal(normalizeSourceUrl('  https://example.com/read  '), 'https://example.com/read');
  assert.equal(normalizeSourceUrl('   '), '');
  assert.equal(normalizeSourceUrl(null), '');

  assert.equal(isValidSourceUrl('https://example.com/read'), true);
  assert.equal(isValidSourceUrl('http://example.com/read'), true);
  assert.equal(isValidSourceUrl('ftp://example.com/read'), false);
  assert.equal(isValidSourceUrl('/relative/path'), false);
  assert.equal(isValidSourceUrl(''), false);
});
