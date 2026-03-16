const { getLatestChapters } = require('./mangadex');
const {
  getTrackedManga,
  getAllTrackedMangaIds,
  getReadChapters,
  getCachedChapters,
  saveCachedChapters,
  getMangaCacheState,
  recordMangaCacheError
} = require('./db');

const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const CACHE_TTL_MS = readPositiveInt(process.env.CHAPTER_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS);
const RATE_LIMIT_DELAY_MS = readPositiveInt(process.env.MANGADEX_RATE_LIMIT_DELAY_MS, 250);

const refreshPromises = new Map();
let refreshAllPromise = null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getFreshnessMs(cacheState) {
  if (!cacheState || !cacheState.last_success_at) {
    return Number.POSITIVE_INFINITY;
  }

  return Date.now() - new Date(cacheState.last_success_at).getTime();
}

function isCacheFresh(cacheState) {
  return getFreshnessMs(cacheState) < CACHE_TTL_MS;
}

function normalizeChapterFeed(feed) {
  return Array.isArray(feed && feed.data) ? feed.data : [];
}

function filterDisplayChapters(chapters) {
  return chapters.filter(chapter => {
    const chapterNumber = Number.parseFloat(chapter.attributes.chapter);
    return Number.isNaN(chapterNumber) || chapterNumber > 3;
  });
}

async function refreshMangaChapters(mangaId) {
  if (refreshPromises.has(mangaId)) {
    return refreshPromises.get(mangaId);
  }

  const promise = (async () => {
    try {
      const feed = await getLatestChapters(mangaId);
      const chapters = normalizeChapterFeed(feed);
      saveCachedChapters(mangaId, chapters);
      return chapters;
    } catch (error) {
      recordMangaCacheError(mangaId, error.message);
      throw error;
    }
  })().finally(() => {
    refreshPromises.delete(mangaId);
  });

  refreshPromises.set(mangaId, promise);
  return promise;
}

async function getChaptersForManga(mangaId, options = {}) {
  const { forceRefresh = false } = options;
  const cachedChapters = getCachedChapters(mangaId);
  const cacheState = getMangaCacheState(mangaId);

  if (!forceRefresh && cachedChapters.length > 0 && isCacheFresh(cacheState)) {
    return cachedChapters;
  }

  try {
    return await refreshMangaChapters(mangaId);
  } catch (error) {
    if (cachedChapters.length > 0) {
      console.warn(
        `Using stale chapter cache for manga ${mangaId} after refresh failure: ${error.message}`
      );
      return cachedChapters;
    }

    throw error;
  }
}

async function getTrackedMangaWithChapters(userId) {
  const trackedManga = getTrackedManga(userId);
  const enriched = [];

  for (const manga of trackedManga) {
    const chapters = await getChaptersForManga(manga.manga_id);
    const visibleChapters = filterDisplayChapters(chapters);
    const readSet = new Set(
      getReadChapters(userId, manga.manga_id).map(chapter => chapter.chapter_id)
    );
    const unreadChapters = visibleChapters.filter(chapter => !readSet.has(chapter.id));
    const chaptersWithStatus = unreadChapters.slice(0, 10).map(chapter => ({
      ...chapter,
      isRead: false
    }));

    enriched.push({
      ...manga,
      totalChapters: visibleChapters.length,
      unreadCount: chaptersWithStatus.length,
      chapters: chaptersWithStatus
    });
  }

  return enriched;
}

async function refreshAllTrackedManga() {
  if (refreshAllPromise) {
    return refreshAllPromise;
  }

  refreshAllPromise = (async () => {
    const trackedIds = getAllTrackedMangaIds();

    if (trackedIds.length === 0) {
      return {
        success: true,
        message: 'No tracked manga to check',
        totalChecked: 0,
        successCount: 0,
        failCount: 0,
        usedCacheFallback: 0,
        duration: '0.00'
      };
    }

    const startTime = Date.now();
    let successCount = 0;
    let failCount = 0;
    let usedCacheFallback = 0;

    for (const mangaId of trackedIds) {
      const cachedChapters = getCachedChapters(mangaId);

      try {
        await refreshMangaChapters(mangaId);
        successCount += 1;
      } catch (error) {
        failCount += 1;

        if (cachedChapters.length > 0) {
          usedCacheFallback += 1;
        }

        console.error(`Error refreshing manga ${mangaId}:`, error.message);
      }

      await sleep(RATE_LIMIT_DELAY_MS);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    return {
      success: failCount === 0,
      duration,
      successCount,
      failCount,
      usedCacheFallback,
      totalChecked: trackedIds.length
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
