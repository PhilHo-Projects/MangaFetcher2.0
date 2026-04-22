const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_SOURCE_URLS,
  DEFAULT_SOURCE_URLS_BY_TITLE,
  resolveDefaultSourceUrl,
  normalizeSourceUrl
} = require('./source-links');

const dataDir = process.env.MANGA_TRACKER_DATA_DIR
  ? path.resolve(process.env.MANGA_TRACKER_DATA_DIR)
  : path.join(__dirname, 'data');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log('Created data directory');
}

const dbPath = process.env.MANGA_TRACKER_DB_PATH
  ? path.resolve(process.env.MANGA_TRACKER_DB_PATH)
  : path.join(dataDir, 'manga-tracker.db');

let db;

function normalizeChapterNumber(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeTrackOptions(coverUrlOrOptions = '', sourceUrl = '') {
  const defaults = {
    coverUrl: '',
    sourceUrl: '',
    provider: null,
    providerSeriesId: null,
    latestChapterNumber: null,
    lastReadChapterNumber: null,
    migrationStatus: null
  };

  if (coverUrlOrOptions && typeof coverUrlOrOptions === 'object' && !Array.isArray(coverUrlOrOptions)) {
    return {
      ...defaults,
      ...coverUrlOrOptions
    };
  }

  return {
    ...defaults,
    coverUrl: typeof coverUrlOrOptions === 'string' ? coverUrlOrOptions : '',
    sourceUrl: typeof sourceUrl === 'string' ? sourceUrl : ''
  };
}

function getResolvedSourceUrl({ mangaId, providerSeriesId, title, sourceUrl }) {
  const normalized = normalizeSourceUrl(sourceUrl);
  return normalized || resolveDefaultSourceUrl({ mangaId, providerSeriesId, title });
}

function ensureColumn(tableName, columnName, definition) {
  const columns = new Set(
    db.prepare(`PRAGMA table_info(${tableName})`).all().map(column => column.name)
  );

  if (!columns.has(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

try {
  db = new Database(dbPath);
  console.log(`Database connected: ${dbPath}`);

  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('journal_mode = WAL');
  db.pragma('wal_autocheckpoint = 1000');
  db.pragma('journal_size_limit = 67108864');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tracked_manga (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      manga_id TEXT NOT NULL,
      manga_title TEXT NOT NULL,
      cover_url TEXT,
      source_url TEXT,
      provider TEXT,
      provider_series_id TEXT,
      latest_chapter_number INTEGER,
      last_read_chapter_number INTEGER,
      migration_status TEXT,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, manga_id)
    );

    CREATE TABLE IF NOT EXISTS read_chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      manga_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      chapter_number TEXT,
      read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, chapter_id)
    );

    CREATE TABLE IF NOT EXISTS chapter_cache (
      manga_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      chapter_number TEXT,
      title TEXT,
      published_at DATETIME,
      created_at DATETIME,
      position INTEGER NOT NULL DEFAULT 0,
      cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (manga_id, chapter_id)
    );

    CREATE TABLE IF NOT EXISTS manga_cache_state (
      manga_id TEXT PRIMARY KEY,
      last_checked_at DATETIME,
      last_success_at DATETIME,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS unread_backlog (
      manga_id TEXT NOT NULL,
      chapter_number INTEGER NOT NULL,
      detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (manga_id, chapter_number)
    );
  `);

  ensureColumn('tracked_manga', 'source_url', 'TEXT');
  ensureColumn('tracked_manga', 'provider', 'TEXT');
  ensureColumn('tracked_manga', 'provider_series_id', 'TEXT');
  ensureColumn('tracked_manga', 'latest_chapter_number', 'INTEGER');
  ensureColumn('tracked_manga', 'last_read_chapter_number', 'INTEGER');
  ensureColumn('tracked_manga', 'migration_status', 'TEXT');
  ensureColumn('chapter_cache', 'created_at', 'DATETIME');
  ensureColumn('chapter_cache', 'position', 'INTEGER DEFAULT 0');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tracked_manga_user
      ON tracked_manga(user_id);

    CREATE INDEX IF NOT EXISTS idx_tracked_manga_provider
      ON tracked_manga(provider, provider_series_id, migration_status);

    CREATE INDEX IF NOT EXISTS idx_read_chapters_user_manga
      ON read_chapters(user_id, manga_id);

    CREATE INDEX IF NOT EXISTS idx_chapter_cache_manga_position
      ON chapter_cache(manga_id, position);

    CREATE INDEX IF NOT EXISTS idx_manga_cache_state_success
      ON manga_cache_state(last_success_at);

    CREATE INDEX IF NOT EXISTS idx_unread_backlog_manga
      ON unread_backlog(manga_id, chapter_number DESC);
  `);

  console.log('Database tables initialized');

  const defaultUser = db.prepare('SELECT * FROM users WHERE id = 1').get();
  if (!defaultUser) {
    db.prepare('INSERT INTO users (id, username) VALUES (1, ?)').run('default_user');
    console.log('Created default user (ID: 1)');
  }

  seedDefaultSourceUrls();
} catch (error) {
  console.error('Failed to initialize database:', error);
  process.exit(1);
}

function addUser(username) {
  const value = String(username ?? '').trim();
  if (!value) {
    throw new Error('Username cannot be empty');
  }

  try {
    const result = db.prepare('INSERT INTO users (username) VALUES (?)').run(value);
    console.log(`User created: ${value} (ID: ${result.lastInsertRowid})`);
    return result;
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new Error(`Username "${value}" already exists`);
    }

    console.error('Error adding user:', error);
    throw error;
  }
}

function getUser(userId) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function updateTrackedMangaRecord(userId, mangaId, options = {}) {
  const resolvedSourceUrl = getResolvedSourceUrl({
    mangaId,
    providerSeriesId: options.providerSeriesId,
    title: options.title,
    sourceUrl: options.sourceUrl
  });

  return db.prepare(`
    UPDATE tracked_manga
    SET
      manga_title = COALESCE(?, manga_title),
      cover_url = CASE
        WHEN ? IS NOT NULL AND ? != '' THEN ?
        ELSE cover_url
      END,
      source_url = CASE
        WHEN source_url IS NULL OR TRIM(source_url) = '' THEN ?
        ELSE source_url
      END,
      provider = COALESCE(?, provider),
      provider_series_id = COALESCE(?, provider_series_id),
      latest_chapter_number = COALESCE(?, latest_chapter_number),
      last_read_chapter_number = COALESCE(?, last_read_chapter_number),
      migration_status = COALESCE(?, migration_status)
    WHERE user_id = ? AND manga_id = ?
  `).run(
    options.title || null,
    options.coverUrl || null,
    options.coverUrl || null,
    options.coverUrl || null,
    resolvedSourceUrl || null,
    options.provider || null,
    options.providerSeriesId || null,
    normalizeChapterNumber(options.latestChapterNumber),
    normalizeChapterNumber(options.lastReadChapterNumber),
    options.migrationStatus || null,
    userId,
    mangaId
  );
}

function trackManga(userId, mangaId, title, coverUrlOrOptions = '', sourceUrl = '') {
  if (!userId || !mangaId || !title) {
    throw new Error('Missing required parameters: userId, mangaId, title');
  }

  const options = normalizeTrackOptions(coverUrlOrOptions, sourceUrl);
  const providerSeriesId = options.providerSeriesId ? String(options.providerSeriesId) : null;
  const provider = options.provider || (providerSeriesId ? 'mangaupdates' : null);
  const migrationStatus = options.migrationStatus || (providerSeriesId ? 'resolved' : null);
  const coverUrl = String(options.coverUrl ?? '').trim();
  const resolvedSourceUrl = getResolvedSourceUrl({
    mangaId,
    providerSeriesId,
    title,
    sourceUrl: options.sourceUrl
  });
  const latestChapterNumber = normalizeChapterNumber(options.latestChapterNumber);
  const lastReadChapterNumber = normalizeChapterNumber(options.lastReadChapterNumber);

  try {
    if (providerSeriesId) {
      const unresolvedRow = db.prepare(`
        SELECT manga_id
        FROM tracked_manga
        WHERE user_id = ?
          AND migration_status = 'unresolved'
          AND lower(manga_title) = lower(?)
        LIMIT 1
      `).get(userId, title);

      if (unresolvedRow && unresolvedRow.manga_id !== mangaId) {
        const result = updateTrackedMangaRecord(userId, unresolvedRow.manga_id, {
          title,
          coverUrl,
          sourceUrl: resolvedSourceUrl,
          provider,
          providerSeriesId,
          latestChapterNumber,
          lastReadChapterNumber,
          migrationStatus: 'resolved'
        });

        if (result.changes > 0) {
          console.log(`Relinked unresolved manga "${title}" to provider series ${providerSeriesId}`);
          return result;
        }
      }
    }

    const result = db.prepare(`
      INSERT OR IGNORE INTO tracked_manga (
        user_id,
        manga_id,
        manga_title,
        cover_url,
        source_url,
        provider,
        provider_series_id,
        latest_chapter_number,
        last_read_chapter_number,
        migration_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      mangaId,
      title,
      coverUrl,
      resolvedSourceUrl || '',
      provider,
      providerSeriesId,
      latestChapterNumber,
      lastReadChapterNumber,
      migrationStatus
    );

    if (result.changes === 0 && providerSeriesId) {
      updateTrackedMangaRecord(userId, mangaId, {
        title,
        coverUrl,
        sourceUrl: resolvedSourceUrl,
        provider,
        providerSeriesId,
        latestChapterNumber,
        lastReadChapterNumber,
        migrationStatus
      });
    }

    if (result.changes > 0) {
      console.log(`Tracked manga: ${title} for user ${userId}`);
    }

    return result;
  } catch (error) {
    console.error('Error tracking manga:', error);
    throw error;
  }
}

function untrackManga(userId, mangaId) {
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM read_chapters WHERE user_id = ? AND manga_id = ?').run(userId, mangaId);
    db.prepare('DELETE FROM tracked_manga WHERE user_id = ? AND manga_id = ?').run(userId, mangaId);
    db.prepare('DELETE FROM chapter_cache WHERE manga_id = ?').run(mangaId);
    db.prepare('DELETE FROM manga_cache_state WHERE manga_id = ?').run(mangaId);
    db.prepare('DELETE FROM unread_backlog WHERE manga_id = ?').run(mangaId);
  });

  try {
    transaction();
    console.log(`Untracked manga ${mangaId} for user ${userId}`);
    return { success: true };
  } catch (error) {
    console.error('Error untracking manga:', error);
    throw error;
  }
}

function getTrackedManga(userId) {
  return db.prepare('SELECT * FROM tracked_manga WHERE user_id = ? ORDER BY added_at DESC').all(userId);
}

function getTrackedMangaById(userId, mangaId) {
  return db.prepare('SELECT * FROM tracked_manga WHERE user_id = ? AND manga_id = ? LIMIT 1').get(userId, mangaId);
}

function getTrackedMangaForSync(userId = 1) {
  return db.prepare(`
    SELECT *
    FROM tracked_manga
    WHERE user_id = ?
      AND provider = 'mangaupdates'
      AND provider_series_id IS NOT NULL
      AND migration_status = 'resolved'
    ORDER BY added_at DESC
  `).all(userId);
}

function getTrackedMangaNeedingMigration(userId = 1) {
  return db.prepare(`
    SELECT *
    FROM tracked_manga
    WHERE user_id = ?
      AND (
        provider_series_id IS NULL
        OR migration_status IS NULL
        OR migration_status = 'unresolved'
      )
    ORDER BY added_at DESC
  `).all(userId);
}

function updateTrackedMangaProviderData(userId, mangaId, data = {}) {
  try {
    return updateTrackedMangaRecord(userId, mangaId, {
      title: data.title,
      coverUrl: data.coverUrl,
      sourceUrl: data.sourceUrl,
      provider: data.provider,
      providerSeriesId: data.providerSeriesId,
      latestChapterNumber: data.latestChapterNumber,
      lastReadChapterNumber: data.lastReadChapterNumber,
      migrationStatus: data.migrationStatus
    });
  } catch (error) {
    console.error('Error updating tracked manga provider data:', error);
    throw error;
  }
}

function updateTrackedMangaLatestChapter(userId, mangaId, latestChapterNumber) {
  try {
    return db.prepare(`
      UPDATE tracked_manga
      SET latest_chapter_number = ?
      WHERE user_id = ? AND manga_id = ?
    `).run(normalizeChapterNumber(latestChapterNumber), userId, mangaId);
  } catch (error) {
    console.error('Error updating latest chapter number:', error);
    throw error;
  }
}

function updateMangaSourceUrl(userId, mangaId, sourceUrl) {
  try {
    return db.prepare(`
      UPDATE tracked_manga
      SET source_url = ?
      WHERE user_id = ? AND manga_id = ?
    `).run(normalizeSourceUrl(sourceUrl), userId, mangaId);
  } catch (error) {
    console.error('Error updating manga source URL:', error);
    throw error;
  }
}

function seedDefaultSourceUrls() {
  try {
    const idStmt = db.prepare(`
      UPDATE tracked_manga
      SET source_url = ?
      WHERE manga_id = ?
        AND (source_url IS NULL OR TRIM(source_url) = '')
    `);
    const titleStmt = db.prepare(`
      UPDATE tracked_manga
      SET source_url = ?
      WHERE lower(manga_title) = lower(?)
        AND (source_url IS NULL OR TRIM(source_url) = '')
    `);

    const transaction = db.transaction(() => {
      let seededCount = 0;

      for (const [mangaId, sourceUrl] of Object.entries(DEFAULT_SOURCE_URLS)) {
        seededCount += idStmt.run(sourceUrl, mangaId).changes;
      }

      for (const [title, sourceUrl] of Object.entries(DEFAULT_SOURCE_URLS_BY_TITLE)) {
        seededCount += titleStmt.run(sourceUrl, title).changes;
      }

      return seededCount;
    });

    const seededCount = transaction();
    if (seededCount > 0) {
      console.log(`Seeded ${seededCount} default manga source URL(s)`);
    }

    return seededCount;
  } catch (error) {
    console.error('Error seeding default manga source URLs:', error);
    throw error;
  }
}

function getAllTrackedMangaIds() {
  return db.prepare('SELECT DISTINCT manga_id FROM tracked_manga ORDER BY manga_id').all().map(row => row.manga_id);
}

function isTracking(userId, mangaId) {
  return db.prepare('SELECT 1 FROM tracked_manga WHERE user_id = ? AND manga_id = ? LIMIT 1').get(userId, mangaId) !== undefined;
}

function getCachedChapters(mangaId, limit = 20) {
  return db.prepare(`
    SELECT chapter_id, chapter_number, title, published_at, created_at
    FROM chapter_cache
    WHERE manga_id = ?
    ORDER BY position ASC
    LIMIT ?
  `).all(mangaId, limit).map(row => ({
    id: row.chapter_id,
    attributes: {
      chapter: row.chapter_number,
      title: row.title,
      publishAt: row.published_at,
      createdAt: row.created_at
    }
  }));
}

function saveCachedChapters(mangaId, chapters) {
  const transaction = db.transaction((chapterList) => {
    db.prepare('DELETE FROM chapter_cache WHERE manga_id = ?').run(mangaId);

    const insertStmt = db.prepare(`
      INSERT INTO chapter_cache (
        manga_id, chapter_id, chapter_number, title, published_at, created_at, position, cached_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    chapterList.slice(0, 20).forEach((chapter, index) => {
      insertStmt.run(
        mangaId,
        chapter.id,
        chapter.attributes.chapter || null,
        chapter.attributes.title || null,
        chapter.attributes.publishAt || null,
        chapter.attributes.createdAt || null,
        index
      );
    });

    db.prepare(`
      INSERT INTO manga_cache_state (manga_id, last_checked_at, last_success_at, last_error)
      VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)
      ON CONFLICT(manga_id) DO UPDATE SET
        last_checked_at = excluded.last_checked_at,
        last_success_at = excluded.last_success_at,
        last_error = NULL
    `).run(mangaId);
  });

  try {
    transaction(chapters);
    console.log(`Cached ${Math.min(chapters.length, 20)} chapters for manga ${mangaId}`);
  } catch (error) {
    console.error('Error saving cached chapters:', error);
    throw error;
  }
}

function getMangaCacheState(mangaId) {
  return db.prepare('SELECT * FROM manga_cache_state WHERE manga_id = ?').get(mangaId);
}

function recordMangaCacheError(mangaId, errorMessage) {
  db.prepare(`
    INSERT INTO manga_cache_state (manga_id, last_checked_at, last_error)
    VALUES (?, CURRENT_TIMESTAMP, ?)
    ON CONFLICT(manga_id) DO UPDATE SET
      last_checked_at = excluded.last_checked_at,
      last_error = excluded.last_error
  `).run(mangaId, errorMessage);
}

function markChapterRead(userId, mangaId, chapterId, chapterNumber) {
  try {
    if (!userId || !mangaId || !chapterId) {
      throw new Error('Missing required parameters: userId, mangaId, chapterId');
    }

    const result = db.prepare(`
      INSERT OR REPLACE INTO read_chapters (user_id, manga_id, chapter_id, chapter_number)
      VALUES (?, ?, ?, ?)
    `).run(userId, mangaId, chapterId, chapterNumber || 'unknown');

    console.log(`Marked chapter ${chapterNumber} as read for user ${userId}`);
    return result;
  } catch (error) {
    console.error('Error marking chapter read:', error);
    throw error;
  }
}

function markChapterUnread(userId, chapterId) {
  try {
    const result = db.prepare('DELETE FROM read_chapters WHERE user_id = ? AND chapter_id = ?').run(userId, chapterId);
    console.log(`Marked chapter ${chapterId} as unread for user ${userId}`);
    return result;
  } catch (error) {
    console.error('Error marking chapter unread:', error);
    throw error;
  }
}

function getReadChapters(userId, mangaId) {
  return db.prepare(`
    SELECT chapter_id, chapter_number, read_at
    FROM read_chapters
    WHERE user_id = ? AND manga_id = ?
    ORDER BY read_at DESC
  `).all(userId, mangaId);
}

function getAllReadChapters(userId) {
  return db.prepare('SELECT manga_id, chapter_id, chapter_number FROM read_chapters WHERE user_id = ?').all(userId);
}

function getMaxReadChapterNumber(userId, mangaId) {
  const rows = getReadChapters(userId, mangaId);
  let maxChapter = null;

  for (const row of rows) {
    const chapterNumber = normalizeChapterNumber(row.chapter_number);
    if (chapterNumber !== null && (maxChapter === null || chapterNumber > maxChapter)) {
      maxChapter = chapterNumber;
    }
  }

  return maxChapter;
}

function getLegacyUnreadCount(userId, mangaId) {
  const visibleChapters = getCachedChapters(mangaId, 20).filter(chapter => {
    const chapterNumber = Number.parseFloat(chapter.attributes.chapter);
    return Number.isNaN(chapterNumber) || chapterNumber > 3;
  });
  const readSet = new Set(getReadChapters(userId, mangaId).map(chapter => chapter.chapter_id));
  return visibleChapters.filter(chapter => !readSet.has(chapter.id)).length;
}

function markMultipleChaptersRead(userId, mangaId, chapters) {
  const transaction = db.transaction((chapterList) => {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO read_chapters (user_id, manga_id, chapter_id, chapter_number)
      VALUES (?, ?, ?, ?)
    `);

    for (const chapter of chapterList) {
      stmt.run(userId, mangaId, chapter.chapterId, chapter.chapterNumber);
    }
  });

  try {
    transaction(chapters);
    console.log(`Marked ${chapters.length} chapters as read for user ${userId}`);
    return { success: true, count: chapters.length };
  } catch (error) {
    console.error('Error marking multiple chapters read:', error);
    throw error;
  }
}

function replaceUnreadBacklog(mangaId, chapterNumbers, detectedAt = new Date().toISOString()) {
  const normalizedNumbers = [...new Set(
    chapterNumbers
      .map(normalizeChapterNumber)
      .filter(chapterNumber => chapterNumber !== null)
  )];

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM unread_backlog WHERE manga_id = ?').run(mangaId);
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO unread_backlog (manga_id, chapter_number, detected_at)
      VALUES (?, ?, ?)
    `);

    for (const chapterNumber of normalizedNumbers) {
      insertStmt.run(mangaId, chapterNumber, detectedAt);
    }
  });

  transaction();
}

function addUnreadBacklogEntries(mangaId, chapterNumbers, detectedAt = new Date().toISOString()) {
  const normalizedNumbers = [...new Set(
    chapterNumbers
      .map(normalizeChapterNumber)
      .filter(chapterNumber => chapterNumber !== null)
  )];

  const transaction = db.transaction(() => {
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO unread_backlog (manga_id, chapter_number, detected_at)
      VALUES (?, ?, ?)
    `);

    for (const chapterNumber of normalizedNumbers) {
      insertStmt.run(mangaId, chapterNumber, detectedAt);
    }
  });

  transaction();
}

function getUnreadBacklog(mangaId, limit = 100) {
  return db.prepare(`
    SELECT chapter_number, detected_at
    FROM unread_backlog
    WHERE manga_id = ?
    ORDER BY chapter_number DESC
    LIMIT ?
  `).all(mangaId, limit).map(row => ({
    id: `${mangaId}:${row.chapter_number}`,
    chapterNumber: row.chapter_number,
    detectedAt: row.detected_at
  }));
}

function getUnreadBacklogCount(mangaId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS backlog_count
    FROM unread_backlog
    WHERE manga_id = ?
  `).get(mangaId);

  return row ? row.backlog_count : 0;
}

function getHighestUnreadBacklogChapter(mangaId) {
  const row = db.prepare('SELECT MAX(chapter_number) AS chapter_number FROM unread_backlog WHERE manga_id = ?').get(mangaId);
  return normalizeChapterNumber(row && row.chapter_number);
}

function clearUnreadBacklogThroughChapter(mangaId, chapterNumber) {
  return db.prepare('DELETE FROM unread_backlog WHERE manga_id = ? AND chapter_number <= ?').run(
    mangaId,
    normalizeChapterNumber(chapterNumber)
  );
}

function advanceProgressToChapter(userId, mangaId, chapterNumber) {
  const normalizedChapterNumber = normalizeChapterNumber(chapterNumber);
  if (normalizedChapterNumber === null) {
    throw new Error('chapterNumber must be a positive integer');
  }

  const tracked = getTrackedMangaById(userId, mangaId);
  if (!tracked) {
    throw new Error(`Tracked manga "${mangaId}" not found`);
  }

  const nextChapterNumber = tracked.last_read_chapter_number === null
    ? normalizedChapterNumber
    : Math.max(tracked.last_read_chapter_number, normalizedChapterNumber);

  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE tracked_manga
      SET last_read_chapter_number = ?
      WHERE user_id = ? AND manga_id = ?
    `).run(nextChapterNumber, userId, mangaId);

    db.prepare('DELETE FROM unread_backlog WHERE manga_id = ? AND chapter_number <= ?').run(
      mangaId,
      nextChapterNumber
    );
  });

  transaction();
  return nextChapterNumber;
}

function getUserStats(userId) {
  return {
    trackedManga: db.prepare('SELECT COUNT(*) AS count FROM tracked_manga WHERE user_id = ?').get(userId).count,
    chaptersRead: db.prepare('SELECT COUNT(*) AS count FROM read_chapters WHERE user_id = ?').get(userId).count
  };
}

function vacuum() {
  db.exec('VACUUM');
  console.log('Database vacuumed successfully');
}

function closeDatabase() {
  if (db) {
    db.close();
    console.log('Database connection closed');
  }
}

process.on('SIGINT', () => {
  closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeDatabase();
  process.exit(0);
});

module.exports = {
  db,
  addUser,
  getUser,
  getUserByUsername,
  trackManga,
  untrackManga,
  getTrackedManga,
  getTrackedMangaById,
  getTrackedMangaForSync,
  getTrackedMangaNeedingMigration,
  updateTrackedMangaProviderData,
  updateTrackedMangaLatestChapter,
  updateMangaSourceUrl,
  seedDefaultSourceUrls,
  getAllTrackedMangaIds,
  isTracking,
  getCachedChapters,
  saveCachedChapters,
  getMangaCacheState,
  recordMangaCacheError,
  markChapterRead,
  markChapterUnread,
  getReadChapters,
  getAllReadChapters,
  getMaxReadChapterNumber,
  getLegacyUnreadCount,
  markMultipleChaptersRead,
  replaceUnreadBacklog,
  addUnreadBacklogEntries,
  getUnreadBacklog,
  getUnreadBacklogCount,
  getHighestUnreadBacklogChapter,
  clearUnreadBacklogThroughChapter,
  advanceProgressToChapter,
  getUserStats,
  vacuum,
  closeDatabase
};
