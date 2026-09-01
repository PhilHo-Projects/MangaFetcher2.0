import '@fontsource/archivo-black/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-700.css';

import type { MeResponse, PublicUser } from '../shared/contracts.js';

const ACTION_ICONS = {
  source: `
    <svg viewBox="0 0 20 20" aria-hidden="true" class="header-chip-icon">
      <path d="M13.25 3.25L16.75 6.75L7.25 16.25L3.5 16.5L3.75 12.75L13.25 3.25Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter"></path>
      <path d="M11.75 4.75L15.25 8.25" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square"></path>
    </svg>`,
  clear: `
    <svg viewBox="0 0 20 20" aria-hidden="true" class="header-chip-icon header-chip-icon-clear">
      <path d="M5 5L15 15M15 5L5 15" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="square"></path>
    </svg>`,
  remove: `
    <svg viewBox="0 0 20 20" aria-hidden="true" class="header-chip-icon header-chip-icon-remove">
      <path d="M4.5 6.5H15.5M7 6.5V5.25C7 4.56 7.56 4 8.25 4H11.75C12.44 4 13 4.56 13 5.25V6.5M6.5 6.5L7.25 15H12.75L13.5 6.5M8.5 9V13.5M11.5 9V13.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"></path>
    </svg>`,
} as const;

type SearchResult = {
  id: string;
  title: string;
  type?: string;
  latestChapter?: number | null;
};

type Chapter = {
  id: string;
  attributes: { chapter: string; createdAt: string | null; publishAt: string | null };
};

type Manga = {
  manga_id: string;
  manga_title: string;
  source_url: string;
  migration_status: string | null;
  chapters: Chapter[];
  unreadCount: number;
};

type AdminUser = {
  id: string;
  username: string;
  email: string;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  role: 'admin' | 'user';
  mustChangePassword: boolean;
  applicationUserId: number | null;
  trackedCount: number;
};

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing UI element #${id}`);
  return found as T;
}

function escapeHtml(value: unknown): string {
  const text = value === null || value === undefined
    ? ''
    : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : '[unsupported value]';
  return text.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character] ?? character;
  });
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const payload = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { code?: string; message?: string };
    code?: string;
    message?: string;
  };
  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload.error?.code ?? payload.code ?? 'REQUEST_FAILED',
      payload.error?.message ?? payload.message ?? 'Request failed',
    );
  }
  return payload.data as T;
}

let user: PublicUser | null = null;
let timer: number | null = null;

function setMessage(id: string, message: string, success = false): void {
  const target = element<HTMLElement>(id);
  target.textContent = message;
  target.hidden = message === '';
  target.classList.toggle('success-message', success);
}

function modal(id: string, visible: boolean): void {
  element<HTMLElement>(id).style.display = visible ? 'flex' : 'none';
}

function renderAuth(): void {
  const control = element<HTMLElement>('auth-control');
  element<HTMLElement>('demo-banner').hidden = user !== null;
  element<HTMLElement>('refresh-btn').hidden = user?.role !== 'owner';
  element<HTMLElement>('search-button').closest('section')?.toggleAttribute('hidden', user === null);
  if (!user) {
    control.innerHTML = '<button class="btn btn-primary btn-auth" data-action="signin">SIGN IN</button>';
    return;
  }
  control.innerHTML = `
    <span class="auth-user">${escapeHtml(user.username)}</span>
    ${user.role === 'owner' ? '<a class="btn btn-secondary btn-auth" href="/admin">ADMIN</a>' : ''}
    <button class="btn btn-secondary btn-auth" data-action="password">PASSWORD</button>
    <button class="btn btn-secondary btn-auth" data-action="logout">SIGN OUT</button>
  `;
}

function formatDate(value: string | null): string {
  if (!value) return '??/??/??';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '??/??/??' : date.toLocaleDateString('en-CA');
}

function renderManga(manga: Manga): string {
  const sourceLabel = manga.source_url ? 'Edit reading site' : 'Set reading site';
  const mutationControls = user
    ? `<button class="btn-source" data-action="source" title="${sourceLabel}" aria-label="${sourceLabel}">${ACTION_ICONS.source}</button>
       <button class="btn-remove" data-action="remove" title="Remove from library" aria-label="Remove from library">${ACTION_ICONS.remove}</button>`
    : '';
  const title = manga.source_url
    ? `<a href="${escapeHtml(manga.source_url)}" target="_blank" rel="noopener noreferrer" class="manga-title manga-title-link">${escapeHtml(manga.manga_title)}</a>`
    : `<span class="manga-title">${escapeHtml(manga.manga_title)}</span>`;
  const chapters = manga.chapters.length === 0
    ? '<div class="empty-state">All caught up!</div>'
    : manga.chapters
        .map(
          (chapter) => `
            <div class="chapter-item" data-chapter-number="${escapeHtml(chapter.attributes.chapter)}">
              <span class="chapter-label">Chapter ${escapeHtml(chapter.attributes.chapter)}</span>
              <span class="chapter-date">${escapeHtml(formatDate(chapter.attributes.createdAt ?? chapter.attributes.publishAt))}</span>
              ${
                user
                  ? `<button class="btn-small btn-clear" data-action="read" title="Clear chapters through this one" aria-label="Clear chapters through this one">${ACTION_ICONS.clear}</button>`
                  : ''
              }
            </div>`,
        )
        .join('');
  return `
    <article class="manga-card" data-manga-id="${escapeHtml(manga.manga_id)}" data-title="${escapeHtml(manga.manga_title)}" data-source-url="${escapeHtml(manga.source_url)}">
      <div class="manga-header">
        <div class="manga-title-block">${title}</div>
        <div class="manga-header-actions">${mutationControls}</div>
      </div>
      <div class="chapter-list">${chapters}</div>
    </article>`;
}

async function loadLibrary(): Promise<void> {
  const manga = await api<Manga[]>('/api/manga');
  element<HTMLElement>('manga-list').innerHTML = manga.length
    ? manga.map(renderManga).join('')
    : '<div class="empty-state">No tracked manga yet.</div>';
}

async function search(): Promise<void> {
  const input = element<HTMLInputElement>('search-input');
  const results = await api<{ results: SearchResult[] }>(`/api/search?title=${encodeURIComponent(input.value.trim())}`);
  element<HTMLElement>('search-results').innerHTML = results.results.length
    ? results.results
        .map(
          (item) => `
            <button class="search-result-item search-result-item-clickable" data-action="track"
              data-id="${escapeHtml(item.id)}" data-title="${escapeHtml(item.title)}">
              <span class="search-result-title">${escapeHtml(item.title)}</span>
              <span class="search-result-meta">${escapeHtml(item.type ?? 'Series')}${item.latestChapter ? ` • Latest ${item.latestChapter}` : ''}</span>
            </button>`,
        )
        .join('')
    : '<div class="empty-state">No manga found</div>';
}

async function track(target: HTMLElement): Promise<void> {
  const id = target.dataset.id ?? '';
  const title = target.dataset.title ?? '';
  await api<{ success: boolean }>('/api/track', {
    method: 'POST',
    body: JSON.stringify({ mangaId: id, title, coverUrl: '' }),
  });
  element<HTMLInputElement>('search-input').value = '';
  element<HTMLElement>('search-results').innerHTML = '';
  await loadLibrary();
}

async function libraryAction(target: HTMLElement): Promise<void> {
  const card = target.closest<HTMLElement>('.manga-card');
  if (!card) return;
  const mangaId = card.dataset.mangaId ?? '';
  if (target.dataset.action === 'remove') {
    if (!window.confirm(`Remove "${card.dataset.title ?? ''}" from your library?`)) return;
    await api('/api/untrack/' + encodeURIComponent(mangaId), { method: 'DELETE' });
  } else if (target.dataset.action === 'source') {
    const current = card.dataset.sourceUrl ?? '';
    const sourceUrl = window.prompt('Reading site URL (leave blank to clear)', current);
    if (sourceUrl === null) return;
    await api(`/api/manga/${encodeURIComponent(mangaId)}/source`, {
      method: 'PATCH',
      body: JSON.stringify({ sourceUrl: sourceUrl.trim() }),
    });
  } else if (target.dataset.action === 'read') {
    const row = target.closest<HTMLElement>('.chapter-item');
    await api('/api/read', {
      method: 'POST',
      body: JSON.stringify({ mangaId, chapterNumber: row?.dataset.chapterNumber ?? '' }),
    });
  } else return;
  await loadLibrary();
}

async function loadSession(): Promise<void> {
  const response = await api<MeResponse['data']>('/api/me');
  user = response.user;
  if (document.getElementById('auth-control')) renderAuth();
  if (user?.mustChangePassword) {
    if (document.getElementById('password-modal')) openPasswordDialog(true);
    else window.location.assign('/');
  }
}

async function signIn(): Promise<void> {
  const username = element<HTMLInputElement>('login-username').value.trim();
  const password = element<HTMLInputElement>('login-password').value;
  try {
    await api('/api/auth/sign-in/username', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    modal('login-modal', false);
    await loadSession();
    await loadLibrary();
  } catch (error) {
    const apiError = error as ApiError;
    const message = apiError.code === 'ACCOUNT_PENDING'
      ? 'Your account is waiting for owner approval.'
      : apiError.code === 'ACCOUNT_REJECTED'
        ? 'This account was rejected. Contact the owner for re-approval.'
        : 'Invalid username or password.';
    setMessage('login-error', message);
  }
}

async function requestAccount(): Promise<void> {
  const username = element<HTMLInputElement>('request-username').value.trim();
  const email = element<HTMLInputElement>('request-email').value.trim();
  const password = element<HTMLInputElement>('request-password').value;
  try {
    await api('/api/auth/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({ username, name: username, email, password }),
    });
    setMessage('request-message', 'Request submitted. The owner must approve it before sign-in.', true);
  } catch (error) {
    setMessage('request-message', (error as Error).message);
  }
}

function openPasswordDialog(required: boolean): void {
  element<HTMLElement>('password-required-message').hidden = !required;
  element<HTMLButtonElement>('password-cancel').hidden = required;
  element<HTMLInputElement>('current-password').value = '';
  element<HTMLInputElement>('new-password').value = '';
  setMessage('password-error', '');
  modal('password-modal', true);
}

async function changePassword(): Promise<void> {
  try {
    await api('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: element<HTMLInputElement>('current-password').value,
        newPassword: element<HTMLInputElement>('new-password').value,
      }),
    });
    modal('password-modal', false);
    await loadSession();
  } catch (error) {
    setMessage('password-error', (error as Error).message);
  }
}

async function signOut(): Promise<void> {
  await api('/api/auth/sign-out', { method: 'POST' });
  user = null;
  renderAuth();
  await loadLibrary();
}

async function refresh(): Promise<void> {
  const button = element<HTMLButtonElement>('refresh-btn');
  button.disabled = true;
  try {
    await api('/api/refresh', { method: 'POST' });
    await loadLibrary();
  } finally {
    button.disabled = false;
  }
}

async function startTimer(): Promise<void> {
  const { nextCheck } = await api<{ nextCheck: string | null }>('/api/next-check');
  const display = element<HTMLElement>('timer-display');
  if (timer !== null) window.clearInterval(timer);
  const update = (): void => {
    if (!nextCheck) {
      display.textContent = '--:--:--';
      return;
    }
    const remaining = Math.max(new Date(nextCheck).getTime() - Date.now(), 0);
    const hours = Math.floor(remaining / 3_600_000);
    const minutes = Math.floor((remaining % 3_600_000) / 60_000);
    const seconds = Math.floor((remaining % 60_000) / 1_000);
    display.textContent = [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
  };
  update();
  timer = window.setInterval(update, 1_000);
}

async function renderAdmin(): Promise<void> {
  if (!user) await loadSession();
  if (user?.role !== 'owner') {
    window.location.assign('/');
    return;
  }
  const users = (await api<{ users: AdminUser[] }>('/api/admin/users?status=all')).users;
  document.body.innerHTML = `
    <main class="container admin-page">
      <header class="header"><h1 class="title">ACCOUNT ADMIN</h1><a class="btn btn-secondary" href="/">BACK TO MANGA</a></header>
      <p id="admin-secret" class="demo-banner" hidden></p>
      <div class="admin-list">
        ${users
          .map(
            (account) => `
              <article class="manga-card admin-user" data-user-id="${escapeHtml(account.id)}">
                <div class="manga-header"><strong>${escapeHtml(account.username ?? '(no username)')}</strong><span>${escapeHtml(account.approvalStatus)}</span></div>
                <p>${escapeHtml(account.email)} · ${account.trackedCount} tracked</p>
                ${
                  account.role === 'admin'
                    ? '<span>OWNER</span>'
                    : `<div class="modal-actions">
                        <button class="btn btn-primary" data-admin-action="approve">APPROVE</button>
                        <button class="btn btn-secondary" data-admin-action="reject">REJECT</button>
                        <button class="btn btn-secondary" data-admin-action="revoke-sessions">REVOKE SESSIONS</button>
                        <button class="btn btn-secondary" data-admin-action="reset-password">RESET PASSWORD</button>
                      </div>`
                }
              </article>`,
          )
          .join('')}
      </div>
    </main>`;
  document.body.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-admin-action]');
    if (!target) return;
    const card = target.closest<HTMLElement>('[data-user-id]');
    if (!card) return;
    void adminAction(card.dataset.userId ?? '', target.dataset.adminAction ?? '');
  });
}

async function adminAction(userId: string, action: string): Promise<void> {
  const data = await api<{ temporaryPassword?: string }>(
    `/api/admin/users/${encodeURIComponent(userId)}/${action}`,
    { method: 'POST' },
  );
  if (data.temporaryPassword) {
    const secret = element<HTMLElement>('admin-secret');
    secret.textContent = `Temporary password (shown once): ${data.temporaryPassword}`;
    secret.hidden = false;
    return;
  }
  await renderAdmin();
}

function bindUi(): void {
  element<HTMLButtonElement>('search-button').addEventListener('click', () => void search());
  element<HTMLInputElement>('search-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void search();
  });
  element<HTMLButtonElement>('refresh-btn').addEventListener('click', () => void refresh());
  element<HTMLButtonElement>('login-submit').addEventListener('click', () => void signIn());
  element<HTMLButtonElement>('login-cancel').addEventListener('click', () => modal('login-modal', false));
  element<HTMLButtonElement>('request-open').addEventListener('click', () => {
    modal('login-modal', false);
    modal('request-modal', true);
  });
  element<HTMLButtonElement>('request-cancel').addEventListener('click', () => modal('request-modal', false));
  element<HTMLButtonElement>('request-submit').addEventListener('click', () => void requestAccount());
  element<HTMLButtonElement>('password-cancel').addEventListener('click', () => modal('password-modal', false));
  element<HTMLButtonElement>('password-submit').addEventListener('click', () => void changePassword());
  element<HTMLElement>('auth-control').addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'signin') modal('login-modal', true);
    if (action === 'password') openPasswordDialog(false);
    if (action === 'logout') void signOut();
  });
  element<HTMLElement>('search-results').addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action="track"]');
    if (target) void track(target);
  });
  element<HTMLElement>('manga-list').addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (target) void libraryAction(target);
  });
}

async function initializeLibrary(): Promise<void> {
  await loadSession();
  await Promise.all([loadLibrary(), startTimer()]);
}

document.addEventListener('DOMContentLoaded', () => {
  if (window.location.pathname === '/admin') {
    void renderAdmin();
    return;
  }
  bindUi();
  void initializeLibrary();
});
