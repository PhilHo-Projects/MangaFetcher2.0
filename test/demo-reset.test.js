const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function installStubs() {
  const muPath = path.join(__dirname, '..', 'mangaupdates.js');
  require.cache[muPath] = {
    id: muPath,
    filename: muPath,
    loaded: true,
    exports: {
      searchSeries: async () => [],
      getSeriesDetails: async seriesId => ({
        id: String(seriesId),
        title: seriesId === 'op' ? 'One Piece' : 'Kagurabachi',
        url: '',
        type: 'Manga',
        status: '',
        latestChapter: seriesId === 'op' ? 1120 : 60,
        imageUrl: ''
      })
    }
  };

  const snapshotPath = path.join(__dirname, '..', 'demo-snapshot.js');
  require.cache[snapshotPath] = {
    id: snapshotPath,
    filename: snapshotPath,
    loaded: true,
    exports: {
      PREVIEW_COUNT: 3,
      DEMO_TITLES: [
        { providerSeriesId: 'op', title: 'One Piece', sourceUrl: '' },
        { providerSeriesId: 'kb', title: 'Kagurabachi', sourceUrl: '' }
      ]
    }
  };
}

function cleanupModules() {
  delete process.env.MANGA_TRACKER_DATA_DIR;
  ['../db', '../demo', '../demo-snapshot', '../mangaupdates', '../chapter-service', '../provider-migration']
    .forEach(name => {
      try {
        delete require.cache[require.resolve(name)];
      } catch {}
    });
}

test('resetDemoAccount seeds each demo title with PREVIEW_COUNT unread chapters', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-demo-reset-test-'));
  process.env.MANGA_TRACKER_DATA_DIR = tempDir;
  installStubs();

  const dbModule = require('../db');
  const { resetDemoAccount } = require('../demo');

  try {
    const demo = dbModule.getUserByUsername('demo');

    dbModule.trackManga(demo.id, 'junk', 'Junk', {
      provider: 'mangaupdates', providerSeriesId: 'junk',
      latestChapterNumber: 5, lastReadChapterNumber: 0, migrationStatus: 'resolved'
    });
    dbModule.replaceUnreadBacklog(demo.id, 'junk', [1, 2, 3, 4, 5]);

    const result = await resetDemoAccount();
    assert.equal(result.seeded, 2);

    const tracked = dbModule.getTrackedManga(demo.id);
    assert.equal(tracked.length, 2);
    assert.equal(tracked.find(t => t.manga_id === 'junk'), undefined);

    const op = tracked.find(t => t.manga_id === 'op');
    assert.equal(op.last_read_chapter_number, 1117);
    assert.deepEqual(
      dbModule.getUnreadBacklog(demo.id, 'op').map(e => e.chapterNumber),
      [1120, 1119, 1118]
    );

    const kb = tracked.find(t => t.manga_id === 'kb');
    assert.deepEqual(
      dbModule.getUnreadBacklog(demo.id, 'kb').map(e => e.chapterNumber),
      [60, 59, 58]
    );
  } finally {
    dbModule.closeDatabase();
    cleanupModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
