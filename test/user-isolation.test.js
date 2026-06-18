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

test('two users tracking the same manga keep separate unread backlogs', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-isolation-test-'));
  const dbModule = loadFreshDb(tempDir);

  try {
    const owner = dbModule.getUser(1);
    const demo = dbModule.getUserByUsername('demo');

    dbModule.trackManga(owner.id, 'shared-id', 'Shared', {
      provider: 'mangaupdates',
      providerSeriesId: 'shared-id',
      latestChapterNumber: 100,
      lastReadChapterNumber: 97,
      migrationStatus: 'resolved'
    });
    dbModule.trackManga(demo.id, 'shared-id', 'Shared', {
      provider: 'mangaupdates',
      providerSeriesId: 'shared-id',
      latestChapterNumber: 100,
      lastReadChapterNumber: 0,
      migrationStatus: 'resolved'
    });

    dbModule.replaceUnreadBacklog(owner.id, 'shared-id', [98, 99, 100]);
    dbModule.replaceUnreadBacklog(demo.id, 'shared-id', [10, 11]);

    assert.deepEqual(
      dbModule.getUnreadBacklog(owner.id, 'shared-id').map(e => e.chapterNumber),
      [100, 99, 98]
    );
    assert.deepEqual(
      dbModule.getUnreadBacklog(demo.id, 'shared-id').map(e => e.chapterNumber),
      [11, 10]
    );
    assert.equal(dbModule.getUnreadBacklogCount(owner.id, 'shared-id'), 3);
    assert.equal(dbModule.getUnreadBacklogCount(demo.id, 'shared-id'), 2);

    dbModule.advanceProgressToChapter(owner.id, 'shared-id', 99);

    assert.deepEqual(
      dbModule.getUnreadBacklog(owner.id, 'shared-id').map(e => e.chapterNumber),
      [100]
    );
    assert.deepEqual(
      dbModule.getUnreadBacklog(demo.id, 'shared-id').map(e => e.chapterNumber),
      [11, 10]
    );
  } finally {
    dbModule.closeDatabase();
    cleanup(tempDir);
  }
});

test('resetUserLibrary wipes only the target user', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-reset-lib-test-'));
  const dbModule = loadFreshDb(tempDir);

  try {
    const owner = dbModule.getUser(1);
    const demo = dbModule.getUserByUsername('demo');

    dbModule.trackManga(owner.id, 'm-owner', 'Owner Title', {
      provider: 'mangaupdates', providerSeriesId: 'm-owner',
      latestChapterNumber: 5, lastReadChapterNumber: 2, migrationStatus: 'resolved'
    });
    dbModule.replaceUnreadBacklog(owner.id, 'm-owner', [3, 4, 5]);

    dbModule.trackManga(demo.id, 'm-demo', 'Demo Title', {
      provider: 'mangaupdates', providerSeriesId: 'm-demo',
      latestChapterNumber: 5, lastReadChapterNumber: 2, migrationStatus: 'resolved'
    });
    dbModule.replaceUnreadBacklog(demo.id, 'm-demo', [3, 4, 5]);

    dbModule.resetUserLibrary(demo.id);

    assert.equal(dbModule.getTrackedManga(demo.id).length, 0);
    assert.equal(dbModule.getUnreadBacklogCount(demo.id, 'm-demo'), 0);
    assert.equal(dbModule.getTrackedManga(owner.id).length, 1);
    assert.equal(dbModule.getUnreadBacklogCount(owner.id, 'm-owner'), 3);
  } finally {
    dbModule.closeDatabase();
    cleanup(tempDir);
  }
});
