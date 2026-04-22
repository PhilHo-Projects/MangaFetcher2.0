const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function installProviderStubs() {
  const mangadexPath = path.join(__dirname, '..', 'mangadex.js');
  const mangaupdatesPath = path.join(__dirname, '..', 'mangaupdates.js');

  require.cache[mangadexPath] = {
    id: mangadexPath,
    filename: mangadexPath,
    loaded: true,
    exports: {
      getMangaDetails: async () => ({
        data: {
          id: '7e544761-7d3d-4fce-8137-719814d7d138',
          attributes: {
            title: { en: 'Eleceed' },
            altTitles: [{ ko: '일렉시드' }],
            links: { mu: '4mnd0g3' }
          }
        }
      })
    }
  };

  require.cache[mangaupdatesPath] = {
    id: mangaupdatesPath,
    filename: mangaupdatesPath,
    loaded: true,
    exports: {
      searchSeries: async () => ([
        {
          id: '10076623491',
          title: 'Eleceed',
          type: 'Manhwa',
          url: 'https://www.mangaupdates.com/series/4mnd0g3/eleceed',
          latestChapter: 398
        }
      ]),
      getSeriesDetails: async () => ({
        id: '10076623491',
        title: 'Eleceed',
        type: 'Manhwa',
        url: 'https://www.mangaupdates.com/series/4mnd0g3/eleceed',
        latestChapter: 398,
        status: '396 Chapters (Ongoing)'
      })
    }
  };
}

function cleanupModules() {
  delete process.env.MANGA_TRACKER_DATA_DIR;
  [
    '../db',
    '../provider-migration',
    '../mangadex',
    '../mangaupdates'
  ].forEach(moduleName => {
    try {
      delete require.cache[require.resolve(moduleName)];
    } catch (error) {
      // Ignore missing modules during the red phase.
    }
  });
}

test('migrates existing MangaDex-tracked titles to MangaUpdates provider fields', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-provider-migration-test-'));
  process.env.MANGA_TRACKER_DATA_DIR = tempDir;
  installProviderStubs();

  const dbModule = require('../db');
  dbModule.trackManga(1, '7e544761-7d3d-4fce-8137-719814d7d138', 'Eleceed');
  dbModule.markChapterRead(1, '7e544761-7d3d-4fce-8137-719814d7d138', 'legacy-read', '392');

  const migrationModule = require('../provider-migration');

  try {
    await migrationModule.ensureProviderMigration();

    const tracked = dbModule.getTrackedManga(1).find(
      row => row.manga_id === '7e544761-7d3d-4fce-8137-719814d7d138'
    );

    assert.equal(tracked.provider, 'mangaupdates');
    assert.equal(tracked.provider_series_id, '10076623491');
    assert.equal(tracked.migration_status, 'resolved');
    assert.equal(tracked.latest_chapter_number, 398);
    assert.equal(tracked.last_read_chapter_number, 392);
  } finally {
    dbModule.closeDatabase();
    cleanupModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
