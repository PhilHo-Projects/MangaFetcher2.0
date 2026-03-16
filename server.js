const express = require('express');
const cors = require('cors');
const path = require('path');
const { searchManga } = require('./mangadex');
const { trackManga, untrackManga, markChapterRead, markChapterUnread } = require('./db');
const { getChaptersForManga, getTrackedMangaWithChapters } = require('./chapter-service');
const { scheduleChapterCheck, checkForNewChapters, getNextCheckTime } = require('./scheduler');

const app = express();
const BASE_PATH = process.env.BASE_PATH || '';
const USER_ID = 1; // Single user app
const ENABLE_CORS = process.env.ENABLE_CORS === 'true';
const staticDir = path.join(__dirname, 'public');

if (ENABLE_CORS) {
  app.use(cors());
}

app.use(express.json({ limit: '32kb' }));
app.use(BASE_PATH, express.static(staticDir));

function getTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sendBadRequest(res, message) {
  res.status(400).json({ error: message });
}

app.get(BASE_PATH + '/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get(BASE_PATH + '/api/search', async (req, res) => {
  try {
    const title = getTrimmedString(req.query.title);

    if (title.length < 2) {
      return sendBadRequest(res, 'Search title must be at least 2 characters');
    }

    const results = await searchManga(title);
    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

app.get(BASE_PATH + '/api/manga/:id/chapters', async (req, res) => {
  try {
    const mangaId = getTrimmedString(req.params.id);

    if (!mangaId) {
      return sendBadRequest(res, 'Missing manga ID');
    }

    const chapters = await getChaptersForManga(mangaId);
    res.json(chapters);
  } catch (error) {
    console.error('Get chapters error:', error);
    res.status(500).json({ error: 'Failed to get chapters' });
  }
});

// Track a new manga
app.post(BASE_PATH + '/api/track', async (req, res) => {
  try {
    const mangaId = getTrimmedString(req.body.mangaId);
    const title = getTrimmedString(req.body.title);
    const coverUrl = getTrimmedString(req.body.coverUrl);

    if (!mangaId || !title) {
      return sendBadRequest(res, 'Missing required fields: mangaId, title');
    }

    trackManga(USER_ID, mangaId, title, coverUrl);
    res.json({ success: true });
  } catch (error) {
    console.error('Track manga error:', error);
    res.status(500).json({ error: 'Failed to track manga' });
  }
});

// Get tracked manga with unread counts
app.get(BASE_PATH + '/api/manga', async (req, res) => {
  try {
    const trackedManga = await getTrackedMangaWithChapters(USER_ID);
    res.json(trackedManga);
  } catch (error) {
    console.error('Get tracked manga error:', error);
    res.status(500).json({ error: 'Failed to get tracked manga' });
  }
});

// Mark chapter as read
app.post(BASE_PATH + '/api/read', (req, res) => {
  try {
    const mangaId = getTrimmedString(req.body.mangaId);
    const chapterId = getTrimmedString(req.body.chapterId);
    const chapterNumber = getTrimmedString(req.body.chapterNumber);

    if (!mangaId || !chapterId) {
      return sendBadRequest(res, 'Missing required fields: mangaId, chapterId');
    }

    markChapterRead(USER_ID, mangaId, chapterId, chapterNumber);
    res.json({ success: true });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark chapter as read' });
  }
});

// Mark chapter as unread
app.post(BASE_PATH + '/api/unread', (req, res) => {
  try {
    const chapterId = getTrimmedString(req.body.chapterId);

    if (!chapterId) {
      return sendBadRequest(res, 'Missing chapterId');
    }

    markChapterUnread(USER_ID, chapterId);
    res.json({ success: true });
  } catch (error) {
    console.error('Mark unread error:', error);
    res.status(500).json({ error: 'Failed to mark chapter as unread' });
  }
});

// Remove manga from library
app.delete(BASE_PATH + '/api/untrack/:mangaId', (req, res) => {
  try {
    const mangaId = getTrimmedString(req.params.mangaId);

    if (!mangaId) {
      return sendBadRequest(res, 'Missing manga ID');
    }

    untrackManga(USER_ID, mangaId);
    res.json({ success: true });
  } catch (error) {
    console.error('Untrack manga error:', error);
    res.status(500).json({ error: 'Failed to remove manga' });
  }
});

// Manual refresh endpoint
app.post(BASE_PATH + '/api/refresh', async (req, res) => {
  try {
    console.log('Manual refresh triggered');
    const result = await checkForNewChapters();
    res.json({ success: true, result });
  } catch (error) {
    console.error('Manual refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh chapters' });
  }
});

// Get next scheduled check time
app.get(BASE_PATH + '/api/next-check', (req, res) => {
  try {
    const nextCheck = getNextCheckTime();
    res.json({ nextCheck });
  } catch (error) {
    console.error('Get next check error:', error);
    res.status(500).json({ error: 'Failed to get next check time' });
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Base path: ${BASE_PATH || '(root)'}`);
  
  // Start the scheduler
  scheduleChapterCheck();
  console.log('Chapter check scheduler started - will run daily at 6:00 AM');
});
