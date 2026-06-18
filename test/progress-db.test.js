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

function cleanupDbModule() {
  delete process.env.MANGA_TRACKER_DATA_DIR;
  delete require.cache[require.resolve('../db')];
}

test('stores MangaUpdates progress fields and advances backlog progress by chapter number', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-progress-db-test-'));
  const dbModule = loadFreshDb(tempDir);

  try {
    dbModule.trackManga(1, 'legacy-eleceed', 'Eleceed', {
      provider: 'mangaupdates',
      providerSeriesId: '10076623491',
      latestChapterNumber: 398,
      lastReadChapterNumber: 395,
      migrationStatus: 'resolved'
    });

    let tracked = dbModule.getTrackedManga(1).find(row => row.manga_id === 'legacy-eleceed');
    assert.equal(tracked.provider, 'mangaupdates');
    assert.equal(tracked.provider_series_id, '10076623491');
    assert.equal(tracked.latest_chapter_number, 398);
    assert.equal(tracked.last_read_chapter_number, 395);
    assert.equal(tracked.migration_status, 'resolved');

    dbModule.replaceUnreadBacklog(1, 'legacy-eleceed', [396, 397, 398], '2026-04-21T12:00:00.000Z');

    let backlog = dbModule.getUnreadBacklog(1, 'legacy-eleceed');
    assert.deepEqual(
      backlog.map(entry => entry.chapterNumber),
      [398, 397, 396]
    );
    assert.equal(backlog[0].detectedAt, '2026-04-21T12:00:00.000Z');

    dbModule.advanceProgressToChapter(1, 'legacy-eleceed', 397);

    tracked = dbModule.getTrackedManga(1).find(row => row.manga_id === 'legacy-eleceed');
    assert.equal(tracked.last_read_chapter_number, 397);

    backlog = dbModule.getUnreadBacklog(1, 'legacy-eleceed');
    assert.deepEqual(
      backlog.map(entry => entry.chapterNumber),
      [398]
    );
  } finally {
    dbModule.closeDatabase();
    cleanupDbModule();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
