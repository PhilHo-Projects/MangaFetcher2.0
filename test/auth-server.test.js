const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

function installMangaupdatesStub() {
  const modulePath = path.join(__dirname, '..', 'mangaupdates.js');
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: {
      searchSeries: async () => [],
      getSeriesDetails: async seriesId => ({
        id: String(seriesId),
        title: 'Stub',
        url: '',
        type: 'Manga',
        status: '',
        latestChapter: 10,
        imageUrl: ''
      })
    }
  };
}

function cleanupModules() {
  delete process.env.MANGA_TRACKER_DATA_DIR;
  ['../db', '../auth', '../server', '../chapter-service', '../scheduler', '../demo', '../mangaupdates', '../provider-migration']
    .forEach(name => {
      try {
        delete require.cache[require.resolve(name)];
      } catch {}
    });
}

async function startServer() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-auth-server-test-'));
  process.env.MANGA_TRACKER_DATA_DIR = tempDir;
  installMangaupdatesStub();
  const serverModule = require('../server');
  const app = serverModule.createApp();
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const { port } = server.address();
  return { server, tempDir, baseUrl: `http://127.0.0.1:${port}` };
}

test('login rejects bad credentials and accepts phil/0000', async () => {
  const { server, tempDir, baseUrl } = await startServer();
  try {
    let response = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'phil', password: 'wrong' })
    });
    assert.equal(response.status, 401);

    response = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'phil', password: '0000' })
    });
    assert.equal(response.status, 200);
    const setCookie = response.headers.get('set-cookie');
    assert.match(setCookie || '', /mt_session=/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    require('../db').closeDatabase();
    cleanupModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('GET /api/me reflects demo vs owner, and refresh is owner-only', async () => {
  const { server, tempDir, baseUrl } = await startServer();
  try {
    let response = await fetch(`${baseUrl}/api/me`);
    let payload = await response.json();
    assert.equal(payload.authenticated, false);
    assert.equal(payload.isDemo, true);

    response = await fetch(`${baseUrl}/api/refresh`, { method: 'POST' });
    assert.equal(response.status, 403);

    response = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'phil', password: '0000' })
    });
    const cookie = (response.headers.get('set-cookie') || '').split(';')[0];

    response = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } });
    payload = await response.json();
    assert.equal(payload.authenticated, true);
    assert.equal(payload.isDemo, false);
    assert.equal(payload.username, 'phil');

    response = await fetch(`${baseUrl}/api/refresh`, { method: 'POST', headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
    require('../db').closeDatabase();
    cleanupModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
