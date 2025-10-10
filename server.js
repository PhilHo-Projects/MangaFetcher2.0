const express = require('express');
const cors = require('cors');
const { searchManga, getLatestChapters } = require('./mangadex');
const { trackManga, untrackManga, markChapterRead, markChapterUnread, getTrackedManga, getReadChapters } = require('./db');
const { scheduleChapterCheck, checkForNewChapters, getNextCheckTime } = require('./scheduler');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve static files from public directory

const USER_ID = 1; // Single user app
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
app.post('/api/track', async (req, res) => {
  try {
    const { mangaId, title, coverUrl } = req.body;
    trackManga(USER_ID, mangaId, title, coverUrl);
    res.json({ success: true });
  } catch (error) {
    console.error('Track manga error:', error);
    res.status(500).json({ error: 'Failed to track manga' });
  }
});

// Get tracked manga with unread counts
app.get('/api/manga', async (req, res) => {
  try {
    const tracked = getTrackedManga(USER_ID);
    
    // For each manga, fetch latest chapters and calculate unread
    const enriched = await Promise.all(tracked.map(async (manga) => {
      const chaptersData = await getLatestChapters(manga.manga_id);
      let chapters = chaptersData.data || [];
      
      // Filter out first 3 chapters (1, 2, 3) as they're always returned by MangaDex
      chapters = chapters.filter(ch => {
        const chNum = parseFloat(ch.attributes.chapter);
        return isNaN(chNum) || chNum > 3;
      });
      
      const readChapters = getReadChapters(USER_ID, manga.manga_id);
      const readSet = new Set(readChapters.map(r => r.chapter_id));
      
      // Return all chapters with read status
      const chaptersWithStatus = chapters.slice(0, 10).map(ch => ({
        ...ch,
        isRead: readSet.has(ch.id)
      }));
      
      const unreadCount = chaptersWithStatus.filter(ch => !ch.isRead).length;
      
      return {
        ...manga,
        totalChapters: chapters.length,
        unreadCount: unreadCount,
        chapters: chaptersWithStatus
      };
    }));
    
    res.json(enriched);
  } catch (error) {
    console.error('Get tracked manga error:', error);
    res.status(500).json({ error: 'Failed to get tracked manga' });
  }
});

// Mark chapter as read
app.post('/api/read', (req, res) => {
  try {
    const { mangaId, chapterId, chapterNumber } = req.body;
    markChapterRead(USER_ID, mangaId, chapterId, chapterNumber);
    res.json({ success: true });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark chapter as read' });
  }
});

// Mark chapter as unread
app.post('/api/unread', (req, res) => {
  try {
    const { chapterId } = req.body;
    markChapterUnread(USER_ID, chapterId);
    res.json({ success: true });
  } catch (error) {
    console.error('Mark unread error:', error);
    res.status(500).json({ error: 'Failed to mark chapter as unread' });
  }
});

// Remove manga from library
app.delete('/api/untrack/:mangaId', (req, res) => {
  try {
    untrackManga(USER_ID, req.params.mangaId);
    res.json({ success: true });
  } catch (error) {
    console.error('Untrack manga error:', error);
    res.status(500).json({ error: 'Failed to remove manga' });
  }
});

// Manual refresh endpoint
app.post('/api/refresh', async (req, res) => {
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
app.get('/api/next-check', (req, res) => {
  try {
    const nextCheck = getNextCheckTime();
    res.json({ nextCheck });
  } catch (error) {
    console.error('Get next check error:', error);
    res.status(500).json({ error: 'Failed to get next check time' });
  }
});

app.listen(3001, () => {
  console.log('Server running on port 3001');
  
  // Start the scheduler
  scheduleChapterCheck();
  console.log('Chapter check scheduler started - will run daily at 6:00 AM');
});
