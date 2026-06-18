const express = require('express');
const cors = require('cors');
const path = require('path');
const { searchSeries, getSeriesDetails } = require('./mangaupdates');
const {
  trackManga,
  getTrackedMangaById,
  getUnreadBacklogCount,
  replaceUnreadBacklog,
  untrackManga,
  advanceProgressToChapter,
  markChapterUnread,
  updateMangaSourceUrl,
  getUserByUsername
} = require('./db');
const { getChaptersForManga, getTrackedMangaWithChapters } = require('./chapter-service');
const { scheduleChapterCheck, checkForNewChapters, getNextCheckTime } = require('./scheduler');
const { isValidSourceUrl, normalizeSourceUrl } = require('./source-links');
const { verifyPassword } = require('./password');
const { attachUser, requireOwner, setSessionCookie, clearSessionCookie } = require('./auth');

const BASE_PATH = process.env.BASE_PATH || '';
const ENABLE_CORS = process.env.ENABLE_CORS === 'true';
const staticDir = path.join(__dirname, 'public');
const INITIAL_TRACK_PREVIEW_COUNT = 3;

function getTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sendBadRequest(res, message) {
  res.status(400).json({ error: message });
}

function normalizeChapterNumber(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function getInitialPreviewLastRead(latestChapterNumber) {
  if (latestChapterNumber === null) {
    return null;
  }

  return Math.max(latestChapterNumber - INITIAL_TRACK_PREVIEW_COUNT, 0);
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

function createApp() {
  const app = express();

  if (ENABLE_CORS) {
    app.use(cors());
  }

  app.use(express.json({ limit: '32kb' }));
  app.use(attachUser);
  app.use(BASE_PATH, express.static(staticDir));

  app.get(BASE_PATH + '/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.post(BASE_PATH + '/api/login', (req, res) => {
    const username = getTrimmedString(req.body.username);
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!username || !password) {
      return sendBadRequest(res, 'Missing username or password');
    }

    const user = getUserByUsername(username);
    if (!user || user.role === 'demo' || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    setSessionCookie(res, user.id, BASE_PATH);
    res.json({ success: true, username: user.username, role: user.role });
  });

  app.post(BASE_PATH + '/api/logout', (req, res) => {
    clearSessionCookie(res, BASE_PATH);
    res.json({ success: true });
  });

  app.get(BASE_PATH + '/api/me', (req, res) => {
    const user = req.user;
    const isDemo = !user || user.role === 'demo';
    res.json({
      authenticated: !isDemo,
      username: user ? user.username : null,
      role: user ? user.role : null,
      isDemo
    });
  });

  app.get(BASE_PATH + '/api/search', async (req, res) => {
    try {
      const title = getTrimmedString(req.query.title);

      if (title.length < 2) {
        return sendBadRequest(res, 'Search title must be at least 2 characters');
      }

      const results = await searchSeries(title);
      res.json({ results });
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

      const chapters = await getChaptersForManga(mangaId, req.userId);
      res.json(chapters);
    } catch (error) {
      console.error('Get chapters error:', error);
      res.status(500).json({ error: 'Failed to get chapters' });
    }
  });

  app.post(BASE_PATH + '/api/track', async (req, res) => {
    try {
      const mangaId = getTrimmedString(req.body.mangaId);
      const title = getTrimmedString(req.body.title);
      const coverUrl = getTrimmedString(req.body.coverUrl);
      const sourceUrl = normalizeSourceUrl(req.body.sourceUrl);

      if (!mangaId || !title) {
        return sendBadRequest(res, 'Missing required fields: mangaId, title');
      }

      if (sourceUrl && !isValidSourceUrl(sourceUrl)) {
        return sendBadRequest(res, 'sourceUrl must start with http:// or https://');
      }

      const seriesDetails = await getSeriesDetails(mangaId);
      const resolvedTitle = title || seriesDetails.title;
      const latestChapterNumber = normalizeChapterNumber(seriesDetails.latestChapter);
      const existingTracked = getTrackedMangaById(req.userId, mangaId);
      const existingUnreadCount = existingTracked ? getUnreadBacklogCount(req.userId, mangaId) : 0;
      const shouldSeedInitialPreview = latestChapterNumber !== null && (
        !existingTracked ||
        (
          existingUnreadCount === 0 &&
          existingTracked.migration_status === 'resolved' &&
          existingTracked.last_read_chapter_number === existingTracked.latest_chapter_number
        )
      );
      const initialLastReadChapter = shouldSeedInitialPreview
        ? getInitialPreviewLastRead(latestChapterNumber)
        : null;

      trackManga(req.userId, mangaId, resolvedTitle, {
        coverUrl: coverUrl || seriesDetails.imageUrl || '',
        sourceUrl,
        provider: 'mangaupdates',
        providerSeriesId: mangaId,
        latestChapterNumber,
        lastReadChapterNumber: initialLastReadChapter,
        migrationStatus: 'resolved'
      });

      if (shouldSeedInitialPreview) {
        const initialUnreadChapters = buildChapterRange(
          (initialLastReadChapter ?? 0) + 1,
          latestChapterNumber
        );
        replaceUnreadBacklog(req.userId, mangaId, initialUnreadChapters);
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Track manga error:', error);
      res.status(500).json({ error: 'Failed to track manga' });
    }
  });

  app.get(BASE_PATH + '/api/manga', async (req, res) => {
    try {
      const trackedManga = await getTrackedMangaWithChapters(req.userId);
      res.json(trackedManga);
    } catch (error) {
      console.error('Get tracked manga error:', error);
      res.status(500).json({ error: 'Failed to get tracked manga' });
    }
  });

  app.patch(BASE_PATH + '/api/manga/:mangaId/source', (req, res) => {
    try {
      const mangaId = getTrimmedString(req.params.mangaId);

      if (!mangaId) {
        return sendBadRequest(res, 'Missing manga ID');
      }

      if (!Object.prototype.hasOwnProperty.call(req.body, 'sourceUrl')) {
        return sendBadRequest(res, 'Missing sourceUrl');
      }

      if (typeof req.body.sourceUrl !== 'string') {
        return sendBadRequest(res, 'sourceUrl must be a string');
      }

      const sourceUrl = normalizeSourceUrl(req.body.sourceUrl);

      if (sourceUrl && !isValidSourceUrl(sourceUrl)) {
        return sendBadRequest(res, 'sourceUrl must start with http:// or https://');
      }

      const result = updateMangaSourceUrl(req.userId, mangaId, sourceUrl);

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Manga not found' });
      }

      res.json({ success: true, sourceUrl });
    } catch (error) {
      console.error('Update manga source URL error:', error);
      res.status(500).json({ error: 'Failed to update manga source URL' });
    }
  });

  app.post(BASE_PATH + '/api/read', (req, res) => {
    try {
      const mangaId = getTrimmedString(req.body.mangaId);
      const chapterNumber = getTrimmedString(req.body.chapterNumber);

      if (!mangaId || !chapterNumber) {
        return sendBadRequest(res, 'Missing required fields: mangaId, chapterNumber');
      }

      const resolvedChapterNumber = advanceProgressToChapter(req.userId, mangaId, chapterNumber);
      res.json({ success: true, chapterNumber: resolvedChapterNumber });
    } catch (error) {
      console.error('Mark read error:', error);
      res.status(500).json({ error: 'Failed to mark chapter as read' });
    }
  });

  app.post(BASE_PATH + '/api/unread', (req, res) => {
    try {
      const chapterId = getTrimmedString(req.body.chapterId);

      if (!chapterId) {
        return sendBadRequest(res, 'Missing chapterId');
      }

      markChapterUnread(req.userId, chapterId);
      res.json({ success: true });
    } catch (error) {
      console.error('Mark unread error:', error);
      res.status(500).json({ error: 'Failed to mark chapter as unread' });
    }
  });

  app.delete(BASE_PATH + '/api/untrack/:mangaId', (req, res) => {
    try {
      const mangaId = getTrimmedString(req.params.mangaId);

      if (!mangaId) {
        return sendBadRequest(res, 'Missing manga ID');
      }

      untrackManga(req.userId, mangaId);
      res.json({ success: true });
    } catch (error) {
      console.error('Untrack manga error:', error);
      res.status(500).json({ error: 'Failed to remove manga' });
    }
  });

  app.post(BASE_PATH + '/api/refresh', requireOwner, async (req, res) => {
    try {
      console.log('Manual refresh triggered');
      const result = await checkForNewChapters();
      res.json({ success: true, result });
    } catch (error) {
      console.error('Manual refresh error:', error);
      res.status(500).json({ error: 'Failed to refresh chapters' });
    }
  });

  app.get(BASE_PATH + '/api/next-check', (req, res) => {
    try {
      const nextCheck = getNextCheckTime();
      res.json({ nextCheck });
    } catch (error) {
      console.error('Get next check error:', error);
      res.status(500).json({ error: 'Failed to get next check time' });
    }
  });

  return app;
}

function startServer(port = process.env.PORT || 3001) {
  const app = createApp();
  const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Base path: ${BASE_PATH || '(root)'}`);

    scheduleChapterCheck();
    console.log('Chapter check scheduler started - will run daily at 6:00 AM');
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  createApp,
  startServer
};
