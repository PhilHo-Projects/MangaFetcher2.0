import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import type { MangaProvider } from '../src/server/app.js';
import { buildAuth } from '../src/server/auth.js';
import type { RuntimeConfig } from '../src/server/config.js';
import { LibraryRepository } from '../src/server/database/library-repository.js';
import { migrateDatabase } from '../src/server/database/migrations.js';
import { migrateOwnerIdentity } from '../src/server/database/owner-migration.js';
import { ChapterRefreshService } from '../src/server/services/chapter-refresh.js';

const config: RuntimeConfig = {
  environment: 'test',
  publicOrigin: 'https://manga.example.test',
  sessionSecret: '0123456789abcdef0123456789abcdef',
  port: 3001,
  databasePath: ':memory:',
  dataDirectory: '.',
  clientDirectory: '.',
  sessionMaxAgeSeconds: 30 * 24 * 60 * 60,
  ownerBootstrap: { username: 'phil', email: 'phil@example.test', password: 'correct-horse-battery' },
};

async function repositoryWith(coverUrl: string): Promise<LibraryRepository> {
  const database = new Database(':memory:');
  migrateDatabase(database, 1);
  database.exec(`INSERT INTO users(id, username, password_hash, role) VALUES (1, 'phil', 'legacy', 'owner')`);
  migrateDatabase(database, 2);
  await migrateOwnerIdentity({ auth: buildAuth({ database, config }), database, bootstrap: config.ownerBootstrap });
  migrateDatabase(database, 3);
  const repository = new LibraryRepository(database);
  repository.track(1, {
    mangaId: 'series-1',
    title: 'Series One',
    coverUrl,
    sourceUrl: '',
    latestChapterNumber: 10,
    lastReadChapterNumber: 10,
  });
  return repository;
}

function providerWithCover(imageUrl: string): MangaProvider {
  return {
    search: () => Promise.resolve([]),
    details: (id: string) => Promise.resolve({
      id,
      title: 'Series One',
      latestChapter: 10,
      imageUrl,
      url: '',
      type: '',
      status: '',
    }),
  };
}

describe('chapter check covers', () => {
  it('replaces a stored cover when the provider reports new art', async () => {
    const repository = await repositoryWith('https://cdn.example/thumb/old.jpg');
    await new ChapterRefreshService(repository, providerWithCover('https://cdn.example/new.jpg'), 0).refresh();
    expect(repository.trackedById(1, 'series-1')?.coverUrl).toBe('https://cdn.example/new.jpg');
  });

  it('keeps the stored cover when the provider has none', async () => {
    const repository = await repositoryWith('https://cdn.example/old.jpg');
    await new ChapterRefreshService(repository, providerWithCover(''), 0).refresh();
    expect(repository.trackedById(1, 'series-1')?.coverUrl).toBe('https://cdn.example/old.jpg');
  });
});
