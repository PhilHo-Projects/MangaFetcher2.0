// mangadex.js
const axios = require('axios');

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const client = axios.create({
  baseURL: 'https://api.mangadex.org',
  timeout: readPositiveInt(process.env.MANGADEX_TIMEOUT_MS, 10000),
  headers: {
    'User-Agent': 'manga-tracker/1.0'
  }
});

async function searchManga(title) {
  try {
    const params = {
      title,
      limit: 10
    };
    
    const response = await client.get('/manga', { params });
    return response.data;
  } catch (error) {
    console.error('MangaDex search error:', error);
    throw error;
  }
}

async function getLatestChapters(mangaId) {
  try {
    const params = {
      'order[chapter]': 'desc',
      limit: 20,
      'translatedLanguage[]': 'en'
    };
    
    const response = await client.get(`/manga/${mangaId}/feed`, { params });
    return response.data;
  } catch (error) {
    console.error('MangaDex chapters error:', error);
    throw error;
  }
}

module.exports = { searchManga, getLatestChapters };
