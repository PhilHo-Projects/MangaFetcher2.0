// scheduler.js - Internal chapter checking scheduler
const { getLatestChapters } = require('./mangadex');
const { db } = require('./db');

let nextCheckTime = null;
let schedulerInterval = null;

// Calculate next 6 AM
function getNext6AM() {
  const now = new Date();
  const next = new Date(now);
  
  // Set to 6 AM today
  next.setHours(6, 0, 0, 0);
  
  // If 6 AM has passed today, set to 6 AM tomorrow
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  
  return next;
}

// Get the next scheduled check time
function getNextCheckTime() {
  return nextCheckTime;
}

// Check for new chapters (simplified version without caching for now)
async function checkForNewChapters() {
  const startTime = Date.now();
  console.log('=== Starting chapter update check ===');
  
  try {
    // Get all tracked manga
    const allTracked = db.prepare('SELECT DISTINCT manga_id FROM tracked_manga').all();
    
    if (allTracked.length === 0) {
      console.log('No tracked manga found');
      return { success: true, message: 'No tracked manga to check' };
    }
    
    console.log(`Checking ${allTracked.length} manga for new chapters`);
    
    let successCount = 0;
    let failCount = 0;
    
    // Process each manga
    for (const { manga_id } of allTracked) {
      try {
        console.log(`Checking manga: ${manga_id}`);
        
        const chaptersData = await getLatestChapters(manga_id);
        
        if (!chaptersData || !chaptersData.data) {
          console.log(`No data returned for manga ${manga_id}`);
          failCount++;
          continue;
        }
        
        console.log(`Manga ${manga_id}: ${chaptersData.data.length} chapters found`);
        successCount++;
        
        // Rate limiting - MangaDex allows 5 requests per second
        await new Promise(resolve => setTimeout(resolve, 250));
        
      } catch (error) {
        console.error(`Error checking manga ${manga_id}:`, error.message);
        failCount++;
        
        // Back off on errors
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('=== Update complete ===');
    console.log(`Duration: ${duration}s`);
    console.log(`Success: ${successCount}, Failed: ${failCount}`);
    
    return {
      success: true,
      duration,
      successCount,
      failCount,
      totalChecked: allTracked.length
    };
    
  } catch (error) {
    console.error('Fatal error during update:', error.message);
    throw error;
  }
}

// Schedule the chapter check to run daily at 6 AM
function scheduleChapterCheck() {
  // Clear any existing scheduler
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
  }
  
  // Calculate next check time
  nextCheckTime = getNext6AM();
  console.log(`Next chapter check scheduled for: ${nextCheckTime.toLocaleString()}`);
  
  // Check every minute if it's time to run
  schedulerInterval = setInterval(async () => {
    const now = new Date();
    
    // If we've passed the scheduled time
    if (now >= nextCheckTime) {
      console.log('Running scheduled chapter check...');
      
      try {
        await checkForNewChapters();
      } catch (error) {
        console.error('Scheduled check failed:', error);
      }
      
      // Schedule next check for tomorrow at 6 AM
      nextCheckTime = getNext6AM();
      console.log(`Next chapter check scheduled for: ${nextCheckTime.toLocaleString()}`);
    }
  }, 60000); // Check every minute
}

module.exports = {
  scheduleChapterCheck,
  checkForNewChapters,
  getNextCheckTime
};
