// db.js
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Create data directory if it doesn't exist
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log('Created data directory');
}

// Initialize database
const dbPath = path.join(dataDir, 'manga-tracker.db');
let db;

try {
  db = new Database(dbPath);
  console.log(`Database connected: ${dbPath}`);
  
  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');
  
  // Create tables
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

    CREATE INDEX IF NOT EXISTS idx_tracked_manga_user 
      ON tracked_manga(user_id);
    
    CREATE INDEX IF NOT EXISTS idx_read_chapters_user_manga 
      ON read_chapters(user_id, manga_id);
  `);
  
  console.log('Database tables initialized');
} catch (error) {
  console.error('Failed to initialize database:', error);
  process.exit(1);
}

// User functions
function addUser(username) {
  try {
    if (!username || username.trim().length === 0) {
      throw new Error('Username cannot be empty');
    }
    
    const stmt = db.prepare('INSERT INTO users (username) VALUES (?)');
    const result = stmt.run(username.trim());
    console.log(`User created: ${username} (ID: ${result.lastInsertRowid})`);
    return result;
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new Error(`Username "${username}" already exists`);
    }
    console.error('Error adding user:', error);
    throw error;
  }
}

function getUser(userId) {
  try {
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
    return stmt.get(userId);
  } catch (error) {
    console.error('Error getting user:', error);
    throw error;
  }
}

function getUserByUsername(username) {
  try {
    const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
    return stmt.get(username);
  } catch (error) {
    console.error('Error getting user by username:', error);
    throw error;
  }
}

// Manga tracking functions
function trackManga(userId, mangaId, title, coverUrl = '') {
  try {
    if (!userId || !mangaId || !title) {
      throw new Error('Missing required parameters: userId, mangaId, title');
    }
    
    const stmt = db.prepare(
      'INSERT OR IGNORE INTO tracked_manga (user_id, manga_id, manga_title, cover_url) VALUES (?, ?, ?, ?)'
    );
    const result = stmt.run(userId, mangaId, title, coverUrl);
    
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
  try {
    const deleteChapters = db.prepare(
      'DELETE FROM read_chapters WHERE user_id = ? AND manga_id = ?'
    );
    const deleteManga = db.prepare(
      'DELETE FROM tracked_manga WHERE user_id = ? AND manga_id = ?'
    );
    
    // Use transaction for atomicity
    const transaction = db.transaction(() => {
      deleteChapters.run(userId, mangaId);
      deleteManga.run(userId, mangaId);
    });
    
    transaction();
    console.log(`Untracked manga ${mangaId} for user ${userId}`);
    return { success: true };
  } catch (error) {
    console.error('Error untracking manga:', error);
    throw error;
  }
}

function getTrackedManga(userId) {
  try {
    const stmt = db.prepare('SELECT * FROM tracked_manga WHERE user_id = ? ORDER BY added_at DESC');
    return stmt.all(userId);
  } catch (error) {
    console.error('Error getting tracked manga:', error);
    throw error;
  }
}

function isTracking(userId, mangaId) {
  try {
    const stmt = db.prepare(
      'SELECT 1 FROM tracked_manga WHERE user_id = ? AND manga_id = ? LIMIT 1'
    );
    return stmt.get(userId, mangaId) !== undefined;
  } catch (error) {
    console.error('Error checking if tracking:', error);
    throw error;
  }
}

// Chapter reading functions
function markChapterRead(userId, mangaId, chapterId, chapterNumber) {
  try {
    if (!userId || !mangaId || !chapterId) {
      throw new Error('Missing required parameters: userId, mangaId, chapterId');
    }
    
    const stmt = db.prepare(
      'INSERT OR REPLACE INTO read_chapters (user_id, manga_id, chapter_id, chapter_number) VALUES (?, ?, ?, ?)'
    );
    const result = stmt.run(userId, mangaId, chapterId, chapterNumber || 'unknown');
    console.log(`Marked chapter ${chapterNumber} as read for user ${userId}`);
    return result;
  } catch (error) {
    console.error('Error marking chapter read:', error);
    throw error;
  }
}

function markChapterUnread(userId, chapterId) {
  try {
    const stmt = db.prepare(
      'DELETE FROM read_chapters WHERE user_id = ? AND chapter_id = ?'
    );
    const result = stmt.run(userId, chapterId);
    console.log(`Marked chapter ${chapterId} as unread for user ${userId}`);
    return result;
  } catch (error) {
    console.error('Error marking chapter unread:', error);
    throw error;
  }
}

function getReadChapters(userId, mangaId) {
  try {
    const stmt = db.prepare(
      'SELECT chapter_id, chapter_number, read_at FROM read_chapters WHERE user_id = ? AND manga_id = ? ORDER BY read_at DESC'
    );
    return stmt.all(userId, mangaId);
  } catch (error) {
    console.error('Error getting read chapters:', error);
    throw error;
  }
}

function getAllReadChapters(userId) {
  try {
    const stmt = db.prepare(
      'SELECT manga_id, chapter_id, chapter_number FROM read_chapters WHERE user_id = ?'
    );
    return stmt.all(userId);
  } catch (error) {
    console.error('Error getting all read chapters:', error);
    throw error;
  }
}

// Bulk operations for performance
function markMultipleChaptersRead(userId, mangaId, chapters) {
  try {
    const stmt = db.prepare(
      'INSERT OR REPLACE INTO read_chapters (user_id, manga_id, chapter_id, chapter_number) VALUES (?, ?, ?, ?)'
    );
    
    const transaction = db.transaction((chapterList) => {
      for (const chapter of chapterList) {
        stmt.run(userId, mangaId, chapter.chapterId, chapter.chapterNumber);
      }
    });
    
    transaction(chapters);
    console.log(`Marked ${chapters.length} chapters as read for user ${userId}`);
    return { success: true, count: chapters.length };
  } catch (error) {
    console.error('Error marking multiple chapters read:', error);
    throw error;
  }
}

// Statistics functions
function getUserStats(userId) {
  try {
    const trackedCount = db.prepare(
      'SELECT COUNT(*) as count FROM tracked_manga WHERE user_id = ?'
    ).get(userId).count;
    
    const readCount = db.prepare(
      'SELECT COUNT(*) as count FROM read_chapters WHERE user_id = ?'
    ).get(userId).count;
    
    return {
      trackedManga: trackedCount,
      chaptersRead: readCount
    };
  } catch (error) {
    console.error('Error getting user stats:', error);
    throw error;
  }
}

// Database maintenance
function vacuum() {
  try {
    db.exec('VACUUM');
    console.log('Database vacuumed successfully');
  } catch (error) {
    console.error('Error vacuuming database:', error);
    throw error;
  }
}

function closeDatabase() {
  try {
    if (db) {
      db.close();
      console.log('Database connection closed');
    }
  } catch (error) {
    console.error('Error closing database:', error);
    throw error;
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeDatabase();
  process.exit(0);
});

// Export all functions
module.exports = {
  db,
  // User functions
  addUser,
  getUser,
  getUserByUsername,
  // Manga tracking
  trackManga,
  untrackManga,
  getTrackedManga,
  isTracking,
  // Chapter reading
  markChapterRead,
  markChapterUnread,
  getReadChapters,
  getAllReadChapters,
  markMultipleChaptersRead,
  // Stats & maintenance
  getUserStats,
  vacuum,
  closeDatabase
};
