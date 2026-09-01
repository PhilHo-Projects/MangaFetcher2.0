/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  document.body.innerHTML = '';
});

describe('library action controls', () => {
  it('renders compact accessible icons instead of overflowing action text', async () => {
    let releaseSession!: () => void;
    const delayedSession = new Promise<void>((resolve) => {
      releaseSession = resolve;
    });
    document.body.innerHTML = `
      <section><input id="search-input"><button id="search-button"></button></section>
      <button id="refresh-btn"></button>
      <div id="auth-control"></div>
      <div id="demo-banner"></div>
      <div id="search-results"></div>
      <div id="manga-list"></div>
      <span id="timer-display"></span>
      <button id="login-submit"></button><button id="login-cancel"></button>
      <button id="request-open"></button><button id="request-cancel"></button><button id="request-submit"></button>
      <button id="password-cancel"></button><button id="password-submit"></button>
    `;

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/me') await delayedSession;
      const data = path === '/api/me'
        ? { user: { id: 'owner', username: 'phil', role: 'owner', approvalStatus: 'approved', mustChangePassword: false } }
        : path === '/api/manga'
          ? [{
              manga_id: 'test-manga',
              manga_title: 'Test Manga',
              source_url: '',
              migration_status: null,
              unreadCount: 1,
              chapters: [{
                id: 'chapter-1',
                attributes: { chapter: '1', createdAt: '2026-08-31T00:00:00.000Z', publishAt: null },
              }],
            }]
          : { nextCheck: null };
      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));

    await import('../src/client/main.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await Promise.resolve();
    await Promise.resolve();
    releaseSession();

    await vi.waitFor(() => expect(document.querySelector('.auth-user')).not.toBeNull());

    for (const selector of ['.btn-source', '.btn-remove', '.btn-clear']) {
      const button = document.querySelector<HTMLButtonElement>(selector);
      expect(button, `${selector} should render after the authenticated session loads`).not.toBeNull();
      expect(button!.querySelector('svg')).not.toBeNull();
      expect(button!.textContent.trim()).toBe('');
      expect(button!.getAttribute('aria-label')).toBeTruthy();
    }
  });
});
