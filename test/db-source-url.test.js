const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const KAGURABACHI_ID = 'd65c0332-3764-4c89-84bd-b1a4e7278ad7';
const KAGURABACHI_URL = 'https://readkagura.com/';

function loadFreshDb(tempDir) {
  delete require.cache[require.resolve('../db')];
  process.env.MANGA_TRACKER_DATA_DIR = tempDir;
  return require('../db');
}

function cleanupDbModule() {
  delete process.env.MANGA_TRACKER_DATA_DIR;
  delete require.cache[require.resolve('../db')];
}

test('stores, seeds, updates, and clears per-manga source URLs', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-tracker-test-'));
  const dbPath = path.join(tempDir, 'manga-tracker.db');

  const dbModule = loadFreshDb(tempDir);

  try {
    assert.ok(fs.existsSync(dbPath), 'expected the test database to be created in the temp directory');

    dbModule.trackManga(1, KAGURABACHI_ID, 'Kagurabachi');

    let tracked = dbModule.getTrackedManga(1).find(row => row.manga_id === KAGURABACHI_ID);
    assert.ok(tracked, 'expected tracked manga row to exist');
    assert.equal(tracked.source_url, KAGURABACHI_URL);

    dbModule.updateMangaSourceUrl(1, KAGURABACHI_ID, 'https://example.com/kagurabachi');
    tracked = dbModule.getTrackedManga(1).find(row => row.manga_id === KAGURABACHI_ID);
    assert.equal(tracked.source_url, 'https://example.com/kagurabachi');

    dbModule.updateMangaSourceUrl(1, KAGURABACHI_ID, '');
    tracked = dbModule.getTrackedManga(1).find(row => row.manga_id === KAGURABACHI_ID);
    assert.equal(tracked.source_url, '');
  } finally {
    dbModule.closeDatabase();
    cleanupDbModule();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
