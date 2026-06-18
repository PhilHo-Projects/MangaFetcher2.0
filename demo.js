const {
  getUserByUsername,
  getTrackedManga,
  resetUserLibrary,
  trackManga,
  replaceUnreadBacklog
} = require('./db');
const { getSeriesDetails } = require('./mangaupdates');
const { DEMO_TITLES, PREVIEW_COUNT } = require('./demo-snapshot');

function getDemoUser() {
  const demoUsername = String(process.env.DEMO_USERNAME || 'demo').trim() || 'demo';
  return getUserByUsername(demoUsername) || null;
}

function buildChapterRange(start, end) {
  const chapters = [];
  for (let chapter = start; chapter <= end; chapter += 1) {
    chapters.push(chapter);
  }
  return chapters;
}

async function resetDemoAccount() {
  const demoUser = getDemoUser();
  if (!demoUser) {
    console.error('Demo user not found; skipping demo reset');
    return { success: false, seeded: 0 };
  }

  resetUserLibrary(demoUser.id);

  let seeded = 0;
  const detectedAt = new Date().toISOString();

  for (const entry of DEMO_TITLES) {
    try {
      const details = await getSeriesDetails(entry.providerSeriesId);
      const latest = details.latestChapter;
      if (latest === null) {
        continue;
      }

      const lastRead = Math.max(latest - PREVIEW_COUNT, 0);

      trackManga(demoUser.id, entry.providerSeriesId, entry.title, {
        coverUrl: entry.coverUrl || details.imageUrl || '',
        sourceUrl: entry.sourceUrl || '',
        provider: 'mangaupdates',
        providerSeriesId: entry.providerSeriesId,
        latestChapterNumber: latest,
        lastReadChapterNumber: lastRead,
        migrationStatus: 'resolved'
      });

      replaceUnreadBacklog(
        demoUser.id,
        entry.providerSeriesId,
        buildChapterRange(lastRead + 1, latest),
        detectedAt
      );

      seeded += 1;
    } catch (error) {
      console.error(`Demo reset failed for ${entry.title}:`, error.message);
    }
  }

  console.log(`Demo account reset; seeded ${seeded}/${DEMO_TITLES.length} titles`);
  return { success: true, seeded };
}

async function ensureDemoSeeded() {
  const demoUser = getDemoUser();
  if (!demoUser) {
    return;
  }
  if (getTrackedManga(demoUser.id).length === 0) {
    await resetDemoAccount();
  }
}

module.exports = { resetDemoAccount, ensureDemoSeeded };
