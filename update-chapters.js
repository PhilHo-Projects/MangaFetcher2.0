// update-chapters.js
const { getLatestChapters } = require('./mangadex');
const { db } = require('./db');
const fs = require('fs');
const path = require('path');

// Create logs directory
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Logger function
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}\n`;
  
  console.log(logMessage.trim());
  
  // Append to log file
  const logFile = path.join(logsDir, `update-${new Date().toISOString().split('T')[0]}.log`);
  fs.appendFileSync(logFile, logMessage);
}

// Create or update chapter cache table
function initChapterCache() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS chapter_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        manga_id TEXT NOT NULL,
        chapter_id TEXT NOT NULL,
        chapter_number TEXT,
        title TEXT,
        published_at DATETIME,
        cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(chapter_id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_chapter_cache_manga 
        ON chapter_cache(manga_id, published_at DESC);
    `);
    log('Chapter cache table initialized');
  } catch (error) {
    log(`Error initializing chapter cache: ${error.message}`, 'ERROR');
    throw error;
  }
}

// Cache chapters in database
function cacheChapters(mangaId, chapters) {
  try {
    if (!chapters || chapters.length === 0) return;
    
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO chapter_cache 
      (manga_id, chapter_id, chapter_number, title, published_at, cached_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);
    
    const transaction = db.transaction((chapterList) => {
      for (const ch of chapterList) {
        stmt.run(
          mangaId,
          ch.id,
          ch.attributes.chapter || 'N/A',
          ch.attributes.title || '',
          ch.attributes.publishAt || new Date().toISOString()
        );
      }
    });
    
    transaction(chapters);
    log(`Cached ${chapters.length} chapters for manga ${mangaId}`);
  } catch (error) {
    log(`Error caching chapters: ${error.message}`, 'ERROR');
    // Don't throw - caching failure shouldn't stop the update
  }
}

// Get cached chapters count
function getCachedChapterCount(mangaId) {
  try {
    const result = db.prepare(
      'SELECT COUNT(*) as count FROM chapter_cache WHERE manga_id = ?'
    ).get(mangaId);
    return result.count;
  } catch (error) {
    log(`Error getting cached chapter count: ${error.message}`, 'ERROR');
    return 0;
  }
}

// Clean old cache entries (older than 7 days)
function cleanOldCache() {
  try {
    const result = db.prepare(`
      DELETE FROM chapter_cache 
      WHERE cached_at < datetime('now', '-7 days')
    `).run();
    
    if (result.changes > 0) {
      log(`Cleaned ${result.changes} old cache entries`);
    }
  } catch (error) {
    log(`Error cleaning cache: ${error.message}`, 'ERROR');
  }
}

// Main update function
async function checkForNewChapters() {
  const startTime = Date.now();
  log('=== Starting chapter update check ===');
  
  try {
    // Initialize cache table
    initChapterCache();
    
    // Get all tracked manga
    const allTracked = db.prepare('SELECT DISTINCT manga_id FROM tracked_manga').all();
    
    if (allTracked.length === 0) {
      log('No tracked manga found', 'WARN');
      return;
    }
    
    log(`Found ${allTracked.length} unique manga to check`);
    
    let successCount = 0;
    let failCount = 0;
    let totalNewChapters = 0;
    
    // Process each manga
    for (const { manga_id } of allTracked) {
      try {
        log(`Checking manga: ${manga_id}`);
        
        const oldCount = getCachedChapterCount(manga_id);
        const chaptersData = await getLatestChapters(manga_id);
        
        if (!chaptersData || !chaptersData.data) {
          log(`No data returned for manga ${manga_id}`, 'WARN');
          failCount++;
          continue;
        }
        
        const chapters = chaptersData.data;
        const newCount = chapters.length;
        const newChapters = Math.max(0, newCount - oldCount);
        
        log(`Manga ${manga_id}: ${chapters.length} chapters found, ${newChapters} new`);
        
        // Cache the chapters
        cacheChapters(manga_id, chapters);
        
        totalNewChapters += newChapters;
        successCount++;
        
        // Rate limiting - MangaDex allows 5 requests per second
        await new Promise(resolve => setTimeout(resolve, 250));
        
      } catch (error) {
        log(`Error checking manga ${manga_id}: ${error.message}`, 'ERROR');
        failCount++;
        
        // Back off on errors
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Clean old cache
    cleanOldCache();
    
    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    log('=== Update complete ===');
    log(`Duration: ${duration}s`);
    log(`Success: ${successCount}, Failed: ${failCount}`);
    log(`Total new chapters detected: ${totalNewChapters}`);
    
    // Exit cleanly
    process.exit(0);
    
  } catch (error) {
    log(`Fatal error during update: ${error.message}`, 'ERROR');
    log(error.stack, 'ERROR');
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  log(`Uncaught exception: ${error.message}`, 'ERROR');
  log(error.stack, 'ERROR');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  log(`Unhandled rejection: ${reason}`, 'ERROR');
  process.exit(1);
});

// Run the update
checkForNewChapters();
