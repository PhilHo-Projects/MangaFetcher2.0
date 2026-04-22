const axios = require('axios');

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeLatestChapter(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

const client = axios.create({
  baseURL: 'https://api.mangaupdates.com/v1',
  timeout: readPositiveInt(process.env.MANGAUPDATES_TIMEOUT_MS, 10000),
  headers: {
    'User-Agent': 'manga-tracker/1.0'
  }
});

function normalizeSearchRecord(result) {
  const record = result && result.record ? result.record : {};
  return {
    id: String(record.series_id ?? ''),
    title: record.title || 'Untitled',
    url: record.url || '',
    type: record.type || '',
    year: record.year || '',
    latestChapter: normalizeLatestChapter(record.latest_chapter),
    imageUrl: record.image && record.image.url ? (record.image.url.thumb || record.image.url.original || '') : ''
  };
}

async function searchSeries(query) {
  try {
    const response = await client.post('/series/search', { search: query });
    const results = Array.isArray(response.data && response.data.results)
      ? response.data.results
      : [];
    return results.map(normalizeSearchRecord).filter(result => result.id);
  } catch (error) {
    console.error('MangaUpdates search error:', error.message);
    throw error;
  }
}

async function getSeriesDetails(seriesId) {
  try {
    const response = await client.get(`/series/${encodeURIComponent(seriesId)}`);
    const record = response.data || {};
    return {
      id: String(record.series_id ?? seriesId),
      title: record.title || 'Untitled',
      url: record.url || '',
      type: record.type || '',
      status: record.status || '',
      latestChapter: normalizeLatestChapter(record.latest_chapter),
      imageUrl: record.image && record.image.url ? (record.image.url.thumb || record.image.url.original || '') : ''
    };
  } catch (error) {
    console.error(`MangaUpdates series detail error for ${seriesId}:`, error.message);
    throw error;
  }
}

module.exports = {
  searchSeries,
  getSeriesDetails
};
