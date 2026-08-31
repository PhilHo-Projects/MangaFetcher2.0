import { createApp } from './app.js';
import { buildAuth } from './auth.js';
import { loadConfig } from './config.js';
import { openDatabase } from './database/connection.js';
import { LibraryRepository } from './database/library-repository.js';
import { ChapterRefreshService } from './services/chapter-refresh.js';
import { ensureDemoSeeded } from './services/demo.js';
import { MangaUpdatesProvider } from './services/manga-updates.js';
import { DailyScheduler } from './services/scheduler.js';

const config = loadConfig();
const database = openDatabase(config.databasePath);
const repository = new LibraryRepository(database);
const auth = buildAuth({ database, config });
const provider = new MangaUpdatesProvider();
const refreshService = new ChapterRefreshService(repository, provider);
const scheduler = new DailyScheduler(() => refreshService.refresh());
const app = createApp({
  auth,
  config,
  repository,
  provider,
  refresh: () => refreshService.refresh(),
  nextCheck: () => scheduler.nextCheck(),
  log: (message) => console.info(message),
});

const server = app.listen(config.port, () => {
  console.info(`Manga Tracker listening on ${config.port}`);
  scheduler.start();
  void ensureDemoSeeded(repository, provider);
});

function shutdown(): void {
  scheduler.stop();
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
