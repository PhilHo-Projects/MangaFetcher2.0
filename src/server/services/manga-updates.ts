import axios, { type AxiosInstance } from 'axios';

import type { MangaDetails, MangaProvider } from '../app.js';

type SearchRecord = {
  record?: {
    series_id?: string | number;
    title?: string;
    url?: string;
    type?: string;
    year?: string | number;
    latest_chapter?: string | number;
    image?: { url?: { thumb?: string; original?: string } };
  };
};

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function chapterNumber(value: unknown): number | null {
  const normalized = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export class MangaUpdatesProvider implements MangaProvider {
  private readonly client: AxiosInstance;

  constructor(timeout = positiveInteger(process.env.MANGAUPDATES_TIMEOUT_MS, 10_000)) {
    this.client = axios.create({
      baseURL: 'https://api.mangaupdates.com/v1',
      timeout,
      headers: { 'User-Agent': 'manga-tracker/2.0' },
    });
  }

  async search(query: string): Promise<unknown[]> {
    const response = await this.client.post<{ results?: SearchRecord[] }>('/series/search', { search: query });
    return (response.data.results ?? [])
      .map(({ record = {} }) => ({
        id: String(record.series_id ?? ''),
        title: record.title ?? 'Untitled',
        url: record.url ?? '',
        type: record.type ?? '',
        year: record.year ?? '',
        latestChapter: chapterNumber(record.latest_chapter),
        imageUrl: record.image?.url?.thumb ?? record.image?.url?.original ?? '',
      }))
      .filter((result) => result.id !== '');
  }

  async details(seriesId: string): Promise<MangaDetails> {
    const response = await this.client.get<Record<string, unknown>>(`/series/${encodeURIComponent(seriesId)}`);
    const record = response.data;
    const image = record.image as { url?: { thumb?: string; original?: string } } | undefined;
    return {
      id:
        typeof record.series_id === 'string' || typeof record.series_id === 'number'
          ? String(record.series_id)
          : seriesId,
      title: typeof record.title === 'string' ? record.title : 'Untitled',
      url: typeof record.url === 'string' ? record.url : '',
      type: typeof record.type === 'string' ? record.type : '',
      status: typeof record.status === 'string' ? record.status : '',
      latestChapter: chapterNumber(record.latest_chapter),
      imageUrl: image?.url?.thumb ?? image?.url?.original ?? '',
    };
  }
}
