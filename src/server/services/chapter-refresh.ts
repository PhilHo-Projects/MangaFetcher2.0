import type { LibraryRepository } from '../database/library-repository.js';
import type { MangaProvider } from '../app.js';

function chapterRange(start: number, end: number): number[] {
  return start > end ? [] : Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export class ChapterRefreshService {
  private running: Promise<Record<string, unknown>> | null = null;

  constructor(
    private readonly repository: LibraryRepository,
    private readonly provider: MangaProvider,
    private readonly delayMs = 250,
  ) {}

  refresh(): Promise<Record<string, unknown>> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(): Promise<Record<string, unknown>> {
    const rows = this.repository.trackedForSync();
    let successCount = 0;
    let failCount = 0;
    for (const row of rows) {
      try {
        const details = await this.provider.details(row.providerSeriesId ?? row.mangaId);
        if (details.latestChapter !== null) {
          const baseline = Math.max(
            row.latestChapterNumber ?? 0,
            row.lastReadChapterNumber ?? 0,
            this.repository.highestBacklog(row.userId, row.mangaId) ?? 0,
          );
          this.repository.updateLatest(
            row.userId,
            row.mangaId,
            Math.max(row.latestChapterNumber ?? 0, details.latestChapter),
          );
          this.repository.addBacklog(
            row.userId,
            row.mangaId,
            chapterRange(baseline + 1, details.latestChapter),
          );
        }
        successCount += 1;
      } catch {
        failCount += 1;
      }
      if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    return {
      success: failCount === 0,
      totalChecked: rows.length,
      successCount,
      failCount,
      usedCacheFallback: 0,
    };
  }
}
