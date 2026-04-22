const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

function loadFreshModules(tempDir) {
  delete require.cache[require.resolve('../db')];
  delete require.cache[require.resolve('../server')];
  process.env.MANGA_TRACKER_DATA_DIR = tempDir;

  return {
    dbModule: require('../db'),
    serverModule: require('../server')
  };
}

function cleanupModules() {
  delete process.env.MANGA_TRACKER_DATA_DIR;
  delete require.cache[require.resolve('../db')];
  delete require.cache[require.resolve('../server')];
}

test('PATCH /api/manga/:id/source validates and saves source URLs', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-tracker-server-test-'));
  const { dbModule, serverModule } = loadFreshModules(tempDir);

  dbModule.trackManga(1, 'test-source-manga', 'Test Source Manga');

  assert.equal(typeof serverModule.createApp, 'function');

  const app = serverModule.createApp();
  const server = http.createServer(app);

  try {
    await new Promise(resolve => server.listen(0, resolve));
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    let response = await fetch(`${baseUrl}/api/manga/test-source-manga/source`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceUrl: 'ftp://example.com/invalid' })
    });
    assert.equal(response.status, 400);

    response = await fetch(`${baseUrl}/api/manga/test-source-manga/source`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceUrl: 'https://example.com/read-here' })
    });
    assert.equal(response.status, 200);
    let tracked = dbModule.getTrackedManga(1).find(row => row.manga_id === 'test-source-manga');
    assert.equal(tracked.source_url, 'https://example.com/read-here');

    response = await fetch(`${baseUrl}/api/manga/test-source-manga/source`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceUrl: '' })
    });
    assert.equal(response.status, 200);
    tracked = dbModule.getTrackedManga(1).find(row => row.manga_id === 'test-source-manga');
    assert.equal(tracked.source_url, '');
  } finally {
    await new Promise(resolve => server.close(resolve));
    dbModule.closeDatabase();
    cleanupModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
