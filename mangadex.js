// mangadex.js
const axios = require('axios');

async function searchManga(title) {
  try {
    const url = `https://api.mangadex.org/manga?title=${encodeURIComponent(title)}&limit=10`;
    console.log('Searching MangaDex:', url);
    
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    console.error('MangaDex search error:', error);
    throw error;
  }
}

async function getLatestChapters(mangaId) {
  try {
    const url = `https://api.mangadex.org/manga/${mangaId}/feed?order[chapter]=desc&limit=20&translatedLanguage[]=en`;
    console.log('Fetching chapters:', url);
    
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    console.error('MangaDex chapters error:', error);
    throw error;
  }
}

module.exports = { searchManga, getLatestChapters };
