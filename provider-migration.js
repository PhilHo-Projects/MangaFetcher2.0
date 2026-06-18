const {
  getTrackedMangaNeedingMigration,
  updateTrackedMangaProviderData,
  getMaxReadChapterNumber,
  getLegacyUnreadCount,
  replaceUnreadBacklog
} = require('./db');
const { getMangaDetails } = require('./mangadex');
const { searchSeries, getSeriesDetails } = require('./mangaupdates');

let migrationPromise = null;

function normalizeTitle(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ');
}

function getMdPrimaryTitle(mangaDetails, fallbackTitle) {
  const titleMap = mangaDetails && mangaDetails.data && mangaDetails.data.attributes
    ? mangaDetails.data.attributes.title
    : null;

  if (titleMap && typeof titleMap === 'object') {
    return titleMap.en || Object.values(titleMap)[0] || fallbackTitle;
  }

  return fallbackTitle;
}

function getMdAltTitles(mangaDetails) {
  const altTitles = mangaDetails && mangaDetails.data && mangaDetails.data.attributes
    ? mangaDetails.data.attributes.altTitles
    : [];

  if (!Array.isArray(altTitles)) {
    return [];
  }

  return altTitles.flatMap(entry => Object.values(entry || {})).filter(Boolean);
}

function getMdMuSlug(mangaDetails) {
  const links = mangaDetails && mangaDetails.data && mangaDetails.data.attributes
    ? mangaDetails.data.attributes.links
    : null;

  return links && typeof links.mu === 'string' ? links.mu.trim() : '';
}

function pickBestSearchMatch(searchResults, mdDetails, fallbackTitle) {
  if (!Array.isArray(searchResults) || searchResults.length === 0) {
    return null;
  }

  const muSlug = getMdMuSlug(mdDetails);
  if (muSlug) {
    const slugMatch = searchResults.find(result => result.url.includes(`/${muSlug}/`));
    if (slugMatch) {
      return slugMatch;
    }
  }

  const candidateTitles = [
    fallbackTitle,
    getMdPrimaryTitle(mdDetails, fallbackTitle),
    ...getMdAltTitles(mdDetails)
  ].map(normalizeTitle).filter(Boolean);

  return searchResults.find(result => candidateTitles.includes(normalizeTitle(result.title))) || null;
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

function determineInitialLastRead(row, latestChapterNumber) {
  const maxReadChapter = getMaxReadChapterNumber(row.user_id, row.manga_id);
  if (maxReadChapter !== null) {
    return maxReadChapter;
  }

  const legacyUnreadCount = getLegacyUnreadCount(row.user_id, row.manga_id);
  if (legacyUnreadCount > 0 && latestChapterNumber !== null) {
    return Math.max(latestChapterNumber - legacyUnreadCount, 0);
  }

  return latestChapterNumber;
}

async function migrateTrackedRow(row) {
  let mdDetails = null;

  try {
    mdDetails = await getMangaDetails(row.manga_id);
  } catch (error) {
    mdDetails = null;
  }

  const searchQuery = getMdPrimaryTitle(mdDetails, row.manga_title);
  const searchResults = await searchSeries(searchQuery);
  const match = pickBestSearchMatch(searchResults, mdDetails, row.manga_title);

  if (!match) {
    updateTrackedMangaProviderData(row.user_id, row.manga_id, {
      provider: 'mangaupdates',
      migrationStatus: 'unresolved'
    });
    return { status: 'unresolved', mangaId: row.manga_id };
  }

  const details = await getSeriesDetails(match.id);
  const latestChapterNumber = details.latestChapter;
  const lastReadChapterNumber = determineInitialLastRead(row, latestChapterNumber);
  const detectedAt = new Date().toISOString();
  const unreadChapters = latestChapterNumber !== null && lastReadChapterNumber !== null
    ? buildChapterRange(lastReadChapterNumber + 1, latestChapterNumber)
    : [];

  updateTrackedMangaProviderData(row.user_id, row.manga_id, {
    title: details.title || row.manga_title,
    coverUrl: details.imageUrl || row.cover_url,
    provider: 'mangaupdates',
    providerSeriesId: match.id,
    latestChapterNumber,
    lastReadChapterNumber,
    migrationStatus: 'resolved'
  });
  replaceUnreadBacklog(row.user_id, row.manga_id, unreadChapters, detectedAt);

  return {
    status: 'resolved',
    mangaId: row.manga_id,
    providerSeriesId: match.id
  };
}

async function ensureProviderMigration() {
  if (migrationPromise) {
    return migrationPromise;
  }

  migrationPromise = (async () => {
    const rows = getTrackedMangaNeedingMigration();
    const results = [];

    for (const row of rows) {
      results.push(await migrateTrackedRow(row));
    }

    return results;
  })().finally(() => {
    migrationPromise = null;
  });

  return migrationPromise;
}

module.exports = {
  ensureProviderMigration
};
