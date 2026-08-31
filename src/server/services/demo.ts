import type { LibraryRepository } from '../database/library-repository.js';
import type { MangaProvider } from '../app.js';

const demoTitles = [
  { id: '55099564912', title: 'One Piece' },
  { id: '60441951323', title: 'Kagurabachi' },
] as const;

export async function ensureDemoSeeded(
  repository: LibraryRepository,
  provider: MangaProvider,
): Promise<void> {
  const demo = repository.demoUser();
  if (repository.tracked(demo.id).length > 0) return;
  for (const entry of demoTitles) {
    try {
      const details = await provider.details(entry.id);
      if (details.latestChapter === null) continue;
      const lastRead = Math.max(details.latestChapter - 3, 0);
      repository.track(demo.id, {
        mangaId: entry.id,
        title: entry.title,
        coverUrl: details.imageUrl,
        sourceUrl: '',
        latestChapterNumber: details.latestChapter,
        lastReadChapterNumber: lastRead,
      });
      repository.replaceBacklog(
        demo.id,
        entry.id,
        Array.from({ length: details.latestChapter - lastRead }, (_, index) => lastRead + index + 1),
      );
    } catch {
      // One provider failure must not erase or block the public demo.
    }
  }
}
