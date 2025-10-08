const express = require('express');
const cors = require('cors');
const { searchManga, getLatestChapters } = require('./mangadex');
const { trackManga, markChapterRead, getTrackedManga, getReadChapters, addUser, getUser } = require('./db');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // Serve static files from root directory

// CREATE DEFAULT USER - Put this BEFORE routes, AFTER imports
try {
  if (!getUser(1)) {
    addUser('yourself');
    console.log('Created default user (ID: 1)');
  } else {
    console.log('Default user already exists');
  }
} catch (e) {
  console.log('User setup skipped:', e.message);
}

// ROUTES START HERE
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/search', async (req, res) => {
  try {
    const results = await searchManga(req.query.title);
    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

app.get('/api/manga/:id/chapters', async (req, res) => {
  try {
    const chapters = await getLatestChapters(req.params.id);
    res.json(chapters);
  } catch (error) {
    console.error('Get chapters error:', error);
    res.status(500).json({ error: 'Failed to get chapters' });
  }
});

// Track a new manga
app.post('/api/user/:userId/track', async (req, res) => {
  try {
    const { mangaId, title, coverUrl } = req.body;
    trackManga(req.params.userId, mangaId, title, coverUrl);
    res.json({ success: true });
  } catch (error) {
    console.error('Track manga error:', error);
    res.status(500).json({ error: 'Failed to track manga' });
  }
});

// Get user's tracked manga with unread counts
app.get('/api/user/:userId/manga', async (req, res) => {
  try {
    const tracked = getTrackedManga(req.params.userId);
    
    // For each manga, fetch latest chapters and calculate unread
    const enriched = await Promise.all(tracked.map(async (manga) => {
      const chaptersData = await getLatestChapters(manga.manga_id);
      const chapters = chaptersData.data || [];
      const readChapters = getReadChapters(req.params.userId, manga.manga_id);
      const readSet = new Set(readChapters.map(r => r.chapter_id));
      
      const unreadChapters = chapters.filter(ch => !readSet.has(ch.id));
      
      return {
        ...manga,
        totalChapters: chapters.length,
        unreadCount: unreadChapters.length,
        unreadChapters: unreadChapters.slice(0, 10) // Latest 10 unread
      };
    }));
    
    res.json(enriched);
  } catch (error) {
    console.error('Get tracked manga error:', error);
    res.status(500).json({ error: 'Failed to get tracked manga' });
  }
});

// Mark chapter as read
app.post('/api/user/:userId/read', (req, res) => {
  try {
    const { mangaId, chapterId, chapterNumber } = req.body;
    markChapterRead(req.params.userId, mangaId, chapterId, chapterNumber);
    res.json({ success: true });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark chapter as read' });
  }
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
