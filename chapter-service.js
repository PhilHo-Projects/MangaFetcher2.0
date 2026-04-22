const {
  getTrackedManga,
  getTrackedMangaById,
  getTrackedMangaForSync,
  getUnreadBacklog,
  getUnreadBacklogCount,
  getHighestUnreadBacklogChapter,
  addUnreadBacklogEntries,
  replaceUnreadBacklog,
  updateTrackedMangaLatestChapter,
  updateTrackedMangaProviderData
} = require('./db');
const { getSeriesDetails } = require('./mangaupdates');
const { ensureProviderMigration } = require('./provider-migration');

const RATE_LIMIT_DELAY_MS = (() => {
  const parsed = Number.parseInt(process.env.MANGAUPDATES_RATE_LIMIT_DELAY_MS, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 250;
})();

let refreshAllPromise = null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildChapterRange(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return [];
  }

  const chapters = [];
  for (let chapter = start; chapter <= end; chapter += 1) {
    chapters.push(chapter);
  }
  return chapters;
}

function toSyntheticChapter(entry) {
  return {
    id: entry.id,
    attributes: {
      chapter: String(entry.chapterNumber),
      title: null,
      publishAt: null,
      createdAt: entry.detectedAt
    },
    isRead: false
  };
}

async function getChaptersForManga(mangaId, userId = 1) {
  await ensureProviderMigration();

  const tracked = getTrackedMangaById(userId, mangaId);
  if (!tracked || tracked.migration_status !== 'resolved') {
    return [];
  }

  return getUnreadBacklog(mangaId, 50).map(toSyntheticChapter);
}

async function getTrackedMangaWithChapters(userId) {
  await ensureProviderMigration();

  const trackedManga = getTrackedManga(userId);
  return trackedManga.map(manga => {
    const backlog = manga.migration_status === 'resolved'
      ? getUnreadBacklog(manga.manga_id, 10)
      : [];
    const unreadCount = manga.migration_status === 'resolved'
      ? getUnreadBacklogCount(manga.manga_id)
      : 0;

    return {
      ...manga,
      lastReadChapter: manga.last_read_chapter_number,
      latestChapter: manga.latest_chapter_number,
      unreadCount,
      chapters: backlog.map(toSyntheticChapter)
    };
  });
}

async function refreshAllTrackedManga() {
  if (refreshAllPromise) {
    return refreshAllPromise;
  }

  refreshAllPromise = (async () => {
    await ensureProviderMigration();

    const trackedRows = getTrackedMangaForSync();
    if (trackedRows.length === 0) {
      return {
        success: true,
        totalChecked: 0,
        successCount: 0,
        failCount: 0,
        usedCacheFallback: 0
      };
    }

    let successCount = 0;
    let failCount = 0;

    for (const row of trackedRows) {
      try {
        const details = await getSeriesDetails(row.provider_series_id);
        const latestChapter = details.latestChapter;

        if (latestChapter === null) {
          successCount += 1;
          continue;
        }

        const highestBacklogChapter = getHighestUnreadBacklogChapter(row.manga_id);
        const baseline = Math.max(
          row.latest_chapter_number ?? 0,
          row.last_read_chapter_number ?? 0,
          highestBacklogChapter ?? 0
        );

        const newChapters = latestChapter > baseline
          ? buildChapterRange(baseline + 1, latestChapter)
          : [];

        if (row.latest_chapter_number === null && row.last_read_chapter_number === null) {
          updateTrackedMangaProviderData(row.user_id, row.manga_id, {
            latestChapterNumber: latestChapter,
            lastReadChapterNumber: latestChapter,
            migrationStatus: row.migration_status
          });
          replaceUnreadBacklog(row.manga_id, []);
        } else {
          updateTrackedMangaLatestChapter(
            row.user_id,
            row.manga_id,
            Math.max(row.latest_chapter_number ?? 0, latestChapter)
          );

          if (newChapters.length > 0) {
            addUnreadBacklogEntries(row.manga_id, newChapters, new Date().toISOString());
          }
        }

        successCount += 1;
      } catch (error) {
        failCount += 1;
        console.error(`Error refreshing manga ${row.manga_id}:`, error.message);
      }

      await sleep(RATE_LIMIT_DELAY_MS);
    }

    return {
      success: failCount === 0,
      totalChecked: trackedRows.length,
      successCount,
      failCount,
      usedCacheFallback: 0
    };
  })().finally(() => {
    refreshAllPromise = null;
  });

  return refreshAllPromise;
}

module.exports = {
  getChaptersForManga,
  getTrackedMangaWithChapters,
  refreshAllTrackedManga
};
