const { refreshAllTrackedManga } = require('./chapter-service');
const { resetDemoAccount } = require('./demo');

function readBoundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

const CHECK_HOUR = readBoundedInt(process.env.CHAPTER_CHECK_HOUR, 6, 0, 23);
const CHECK_MINUTE = readBoundedInt(process.env.CHAPTER_CHECK_MINUTE, 0, 0, 59);

let nextCheckTime = null;
let schedulerTimeout = null;

function getNextScheduledTime() {
  const now = new Date();
  const next = new Date(now);

  next.setHours(CHECK_HOUR, CHECK_MINUTE, 0, 0);

  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

function getNextCheckTime() {
  return nextCheckTime;
}

async function checkForNewChapters() {
  const startTime = Date.now();
  console.log('=== Starting chapter update check ===');

  try {
    const result = await refreshAllTrackedManga();
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('=== Update complete ===');
    console.log(`Duration: ${duration}s`);
    console.log(
      `Success: ${result.successCount}, Failed: ${result.failCount}, Cache fallback: ${result.usedCacheFallback}`
    );

    return {
      ...result,
      duration
    };
  } catch (error) {
    console.error('Fatal error during update:', error.message);
    throw error;
  }
}

async function runDailyMaintenance() {
  await checkForNewChapters();
  try {
    await resetDemoAccount();
  } catch (error) {
    console.error('Demo reset failed during scheduled maintenance:', error.message);
  }
}

function clearScheduler() {
  if (schedulerTimeout) {
    clearTimeout(schedulerTimeout);
    schedulerTimeout = null;
  }
}

function scheduleNextRun() {
  clearScheduler();
  nextCheckTime = getNextScheduledTime();

  const delay = Math.max(nextCheckTime.getTime() - Date.now(), 1000);
  console.log(`Next chapter check scheduled for: ${nextCheckTime.toLocaleString()}`);

  schedulerTimeout = setTimeout(async () => {
    console.log('Running scheduled chapter check...');

    try {
      await runDailyMaintenance();
    } catch (error) {
      console.error('Scheduled check failed:', error);
    } finally {
      scheduleNextRun();
    }
  }, delay);
}

function scheduleChapterCheck() {
  scheduleNextRun();
}

module.exports = {
  scheduleChapterCheck,
  checkForNewChapters,
  getNextCheckTime,
  runDailyMaintenance
};
