/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  document.body.innerHTML = '';
});

type SessionUser = { id: string; username: string; role: string; approvalStatus: string; mustChangePassword: boolean };

const library = [
  {
    id: 1,
    manga_id: 'unread-manga',
    manga_title: 'Unread Manga',
    cover_url: '',
    source_url: '',
    lastReadChapter: 10,
    latestChapter: 12,
    unreadCount: 2,
    chapters: [
      { id: 'c12', attributes: { chapter: '12', createdAt: '2026-08-31T00:00:00.000Z', publishAt: null } },
      { id: 'c11', attributes: { chapter: '11', createdAt: '2026-08-24T00:00:00.000Z', publishAt: null } },
    ],
  },
  {
    id: 2,
    manga_id: 'read-manga',
    manga_title: 'Read Manga',
    cover_url: 'https://covers.example/read.jpg',
    source_url: 'https://reader.example/read',
    lastReadChapter: 40,
    latestChapter: 40,
    unreadCount: 0,
    chapters: [],
  },
];

async function mount(user: SessionUser | null): Promise<void> {
  const page = readFileSync('index.html', 'utf8');
  document.head.innerHTML = `<style>${readFileSync('public/styles.css', 'utf8')}</style>`;
  document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(page)![1]!.replace(/<script[\s\S]*?<\/script>/g, '');

  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const data = path === '/api/me' ? { user, isDemo: user === null } : path === '/api/manga' ? library : { nextCheck: null };
    return Promise.resolve(new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
  }));

  await import('../src/client/main.js');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await vi.waitFor(() => expect(document.querySelector('.panel')).not.toBeNull());
}

describe('library page', () => {
  it('gives a signed-in reader labelled controls on every unread chapter', async () => {
    await mount({ id: 'owner', username: 'phil', role: 'owner', approvalStatus: 'approved', mustChangePassword: false });

    expect(document.getElementById('headline')!.textContent).toBe('2 chapters to read');
    expect(document.querySelector('.auth-user')!.textContent).toBe('phil');
    expect(document.getElementById('demo-banner')!.hidden).toBe(true);
    expect(document.getElementById('track-open')!.hidden).toBe(false);
    expect(document.getElementById('refresh-btn')!.hidden).toBe(false);

    const rows = [...document.querySelectorAll<HTMLButtonElement>('.panel button.chapter')];
    expect(rows.map((row) => row.dataset.chapterNumber)).toEqual(['11', '12']);
    for (const row of rows) {
      expect(row.getAttribute('aria-label')).toMatch(/^Mark Unread Manga read through chapter 1[12]$/);
      expect(row.querySelector('svg')).not.toBeNull();
    }

    const options = document.querySelector<HTMLElement>('.panel .menu summary')!;
    expect(options.getAttribute('aria-label')).toBe('Options for Unread Manga');
    expect(options.textContent.trim()).toBe('');

    const shelf = document.getElementById('shelf')!;
    expect(shelf.querySelectorAll('.book')).toHaveLength(1);
    expect(shelf.querySelector('.book-cover')!.getAttribute('href')).toBe('https://reader.example/read');
  });

  it('swaps a cover that fails to load for the title initial', async () => {
    await mount({ id: 'owner', username: 'phil', role: 'owner', approvalStatus: 'approved', mustChangePassword: false });

    const cover = document.querySelector<HTMLElement>('#shelf .book-cover')!;
    cover.querySelector('img')!.dispatchEvent(new Event('error'));

    expect(cover.querySelector('img')).toBeNull();
    expect(cover.classList.contains('cover-blank')).toBe(true);
    expect(cover.textContent.trim()).toBe('R');
  });

  it('shows the public demo without any controls that change the library', async () => {
    await mount(null);

    expect(document.getElementById('demo-banner')!.hidden).toBe(false);
    expect(document.getElementById('track-open')!.hidden).toBe(true);
    expect(document.getElementById('refresh-btn')!.hidden).toBe(true);
    expect(document.querySelector('[data-action="signin"]')).not.toBeNull();
    expect(document.querySelectorAll('.panel .chapter')).toHaveLength(2);
    expect(document.querySelector('button.chapter')).toBeNull();
    expect(document.querySelector('#manga-list .menu, #shelf .menu')).toBeNull();
  });
});
