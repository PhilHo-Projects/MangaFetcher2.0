const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

async function loginAsOwner(baseUrl) {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'phil', password: '0000' })
  });
  return (response.headers.get('set-cookie') || '').split(';')[0];
}

function installMangaupdatesStub() {
  const modulePath = path.join(__dirname, '..', 'mangaupdates.js');
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: {
      searchSeries: async query => {
        if (query === 'Nano Machine') {
          return [
            {
              id: '114563652',
              title: 'Nano Machine',
              url: 'https://www.mangaupdates.com/series/01w7hvo/nano-machine',
              type: 'Manhwa',
              year: '2020',
              latestChapter: 308,
              imageUrl: 'https://cdn.mangaupdates.com/image/thumb/i491625.jpg'
            }
          ];
        }

        return [
          {
            id: '10076623491',
            title: query === 'Eleceed' ? 'Eleceed' : query,
            url: 'https://www.mangaupdates.com/series/4mnd0g3/eleceed',
            type: 'Manhwa',
            year: '2018',
            latestChapter: 398,
            imageUrl: 'https://cdn.mangaupdates.com/image/thumb/i503036.jpg'
          }
        ];
      },
      getSeriesDetails: async seriesId => {
        if (String(seriesId) === '114563652') {
          return {
            id: '114563652',
            title: 'Nano Machine',
            url: 'https://www.mangaupdates.com/series/01w7hvo/nano-machine',
            type: 'Manhwa',
            latestChapter: 308,
            imageUrl: 'https://cdn.mangaupdates.com/image/thumb/i491625.jpg',
            status: '308 Chapters (Ongoing)'
          };
        }

        return {
          id: String(seriesId),
          title: 'Eleceed',
          url: 'https://www.mangaupdates.com/series/4mnd0g3/eleceed',
          type: 'Manhwa',
          latestChapter: 398,
          imageUrl: 'https://cdn.mangaupdates.com/image/thumb/i503036.jpg',
          status: '396 Chapters (Ongoing)'
        };
      }
    }
  };
}

function cleanupModules() {
  delete process.env.MANGA_TRACKER_DATA_DIR;
  [
    '../db',
    '../auth',
    '../server',
    '../chapter-service',
    '../scheduler',
    '../mangaupdates',
    '../provider-migration',
    '../demo'
  ].forEach(moduleName => {
    try {
      delete require.cache[require.resolve(moduleName)];
    } catch (error) {
      // Ignore missing modules during the red phase.
    }
  });
}

test('search route returns normalized MangaUpdates results and read route advances progress', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-server-progress-test-'));
  process.env.MANGA_TRACKER_DATA_DIR = tempDir;
  installMangaupdatesStub();

  const dbModule = require('../db');
  const serverModule = require('../server');

  dbModule.trackManga(1, 'legacy-eleceed', 'Eleceed', {
    provider: 'mangaupdates',
    providerSeriesId: '10076623491',
    latestChapterNumber: 398,
    lastReadChapterNumber: 395,
    migrationStatus: 'resolved'
  });
  dbModule.replaceUnreadBacklog(1, 'legacy-eleceed', [396, 397, 398], '2026-04-21T12:00:00.000Z');

  const app = serverModule.createApp();
  const server = http.createServer(app);

  try {
    await new Promise(resolve => server.listen(0, resolve));
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    const cookie = await loginAsOwner(baseUrl);

    let response = await fetch(`${baseUrl}/api/search?title=Eleceed`);
    assert.equal(response.status, 200);
    let payload = await response.json();
    assert.deepEqual(payload, {
      results: [
        {
          id: '10076623491',
          title: 'Eleceed',
          type: 'Manhwa',
          year: '2018',
          latestChapter: 398,
          url: 'https://www.mangaupdates.com/series/4mnd0g3/eleceed',
          imageUrl: 'https://cdn.mangaupdates.com/image/thumb/i503036.jpg'
        }
      ]
    });

    response = await fetch(`${baseUrl}/api/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ mangaId: 'legacy-eleceed', chapterNumber: '397' })
    });
    assert.equal(response.status, 200);

    const tracked = dbModule.getTrackedManga(1).find(row => row.manga_id === 'legacy-eleceed');
    assert.equal(tracked.last_read_chapter_number, 397);
    assert.deepEqual(
      dbModule.getUnreadBacklog(1, 'legacy-eleceed').map(entry => entry.chapterNumber),
      [398]
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
    dbModule.closeDatabase();
    cleanupModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('tracked manga route reports the full unread backlog count while only rendering the latest chapter slice', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-server-progress-count-test-'));
  process.env.MANGA_TRACKER_DATA_DIR = tempDir;
  installMangaupdatesStub();

  const dbModule = require('../db');
  const serverModule = require('../server');

  dbModule.trackManga(1, 'legacy-kagurabachi', 'Kagurabachi', {
    provider: 'mangaupdates',
    providerSeriesId: '60441951323',
    latestChapterNumber: 120,
    lastReadChapterNumber: 0,
    migrationStatus: 'resolved'
  });
  dbModule.replaceUnreadBacklog(
    1,
    'legacy-kagurabachi',
    Array.from({ length: 120 }, (_, index) => index + 1),
    '2026-04-21T12:00:00.000Z'
  );

  const app = serverModule.createApp();
  const server = http.createServer(app);

  try {
    await new Promise(resolve => server.listen(0, resolve));
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    const cookie = await loginAsOwner(baseUrl);

    const response = await fetch(`${baseUrl}/api/manga`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.length, 1);
    assert.equal(payload[0].unreadCount, 120);
    assert.equal(payload[0].chapters.length, 10);
    assert.equal(payload[0].chapters[0].attributes.chapter, '120');
    assert.equal(payload[0].chapters.at(-1).attributes.chapter, '111');
  } finally {
    await new Promise(resolve => server.close(resolve));
    dbModule.closeDatabase();
    cleanupModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('track route seeds the latest three chapters as initial unread backlog for new series', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-track-preview-test-'));
  process.env.MANGA_TRACKER_DATA_DIR = tempDir;
  installMangaupdatesStub();

  const dbModule = require('../db');
  const serverModule = require('../server');
  const app = serverModule.createApp();
  const server = http.createServer(app);

  try {
    await new Promise(resolve => server.listen(0, resolve));
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    const cookie = await loginAsOwner(baseUrl);

    const response = await fetch(`${baseUrl}/api/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ mangaId: '114563652', title: 'Nano Machine', coverUrl: '' })
    });
    assert.equal(response.status, 200);

    const tracked = dbModule.getTrackedManga(1).find(row => row.manga_id === '114563652');
    assert.ok(tracked);
    assert.equal(tracked.latest_chapter_number, 308);
    assert.equal(tracked.last_read_chapter_number, 305);

    const backlog = dbModule.getUnreadBacklog(1, '114563652');
    assert.deepEqual(
      backlog.map(entry => entry.chapterNumber),
      [308, 307, 306]
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
    dbModule.closeDatabase();
    cleanupModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
