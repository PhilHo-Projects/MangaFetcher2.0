import type { MeResponse, PublicUser } from '../shared/contracts.js';

const ICONS = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12.5 5.5 5.5L20 6.5"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h.01M12 12h.01M19 12h.01"/></svg>',
  out: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h11v11M19 5 5 19"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 9 7 7 7-7"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M4 12h16"/></svg>',
} as const;

type SearchResult = {
  id: string;
  title: string;
  type?: string;
  latestChapter?: number | null;
  imageUrl?: string;
};

type Chapter = {
  id: string;
  attributes: { chapter: string; createdAt: string | null; publishAt: string | null };
};

type Manga = {
  id?: number;
  manga_id: string;
  manga_title: string;
  cover_url?: string;
  source_url: string;
  lastReadChapter?: number | null;
  latestChapter?: number | null;
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
let library: Manga[] = [];
let libraryLoaded = false;
let editing: Manga | null = null;
let passwordRequired = false;
let timer: number | null = null;
let toastTimer: number | null = null;

const shortDate = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 || word.endsWith('series') ? '' : 's'}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'reading site';
  }
}

function formatDate(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : shortDate.format(date);
}

function setMessage(id: string, message: string, success = false): void {
  const target = element<HTMLElement>(id);
  target.textContent = message;
  target.hidden = message === '';
  target.classList.toggle('success', success);
}

function dialog(id: string): HTMLDialogElement {
  return element<HTMLDialogElement>(id);
}

function show(id: string): void {
  const target = dialog(id);
  if (target.open) return;
  if (typeof target.showModal === 'function') target.showModal();
  else target.setAttribute('open', '');
}

function hide(id: string): void {
  const target = dialog(id);
  if (typeof target.close === 'function') target.close();
  else target.removeAttribute('open');
}

function announce(message: string): void {
  element<HTMLElement>('toast-text').textContent = message;
  element<HTMLElement>('toast').hidden = false;
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    element<HTMLElement>('toast').hidden = true;
  }, 4500);
}

/** Runs a UI action and reports a failure in the toast instead of dropping it. */
function run(action: Promise<unknown>): void {
  action.catch((error: unknown) => {
    announce(error instanceof Error && error.message ? error.message : 'Something went wrong');
  });
}

function renderAuth(): void {
  const control = element<HTMLElement>('auth-control');
  element<HTMLElement>('demo-banner').hidden = user !== null;
  element<HTMLElement>('refresh-btn').hidden = user?.role !== 'owner';
  element<HTMLElement>('track-open').hidden = user === null;
  if (!user) {
    control.innerHTML = '<button type="button" class="btn btn-small" data-action="signin">Sign in</button>';
    return;
  }
  control.innerHTML = `
    <details class="menu account">
      <summary><span class="auth-user">${escapeHtml(user.username)}</span>${ICONS.down}</summary>
      <div class="menu-box">
        ${user.role === 'owner' ? '<a href="/admin">Accounts</a>' : ''}
        <button type="button" data-action="password">Change password</button>
        <button type="button" data-action="logout">Sign out</button>
      </div>
    </details>`;
}

function coverBox(tag: 'a' | 'div', className: string, manga: Manga, name: string): string {
  const style = name ? ` style="view-transition-name: ${name}"` : '';
  const link = tag === 'a'
    ? ` href="${escapeHtml(manga.source_url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(manga.manga_title)} on ${escapeHtml(hostOf(manga.source_url))}"`
    : '';
  return manga.cover_url
    ? `<${tag} class="${className}"${link}${style}><img src="${escapeHtml(manga.cover_url)}" alt="" loading="lazy" referrerpolicy="no-referrer"></${tag}>`
    : `<${tag} class="${className} cover-blank"${link}${style}><span aria-hidden="true">${escapeHtml(manga.manga_title.trim().charAt(0).toUpperCase())}</span></${tag}>`;
}

function titleMenu(manga: Manga): string {
  if (!user) return '';
  return `
    <details class="menu">
      <summary class="icon-btn" aria-label="Options for ${escapeHtml(manga.manga_title)}">${ICONS.more}</summary>
      <div class="menu-box">
        <button type="button" data-action="source">${manga.source_url ? 'Edit reading site' : 'Set reading site'}</button>
        <button type="button" data-action="remove" data-remove>Remove from library</button>
      </div>
    </details>`;
}

function renderPanel(manga: Manga, lead: boolean, key: string): string {
  const title = escapeHtml(manga.manga_title);
  const shown = [...manga.chapters].sort(
    (a, b) => Number(a.attributes.chapter) - Number(b.attributes.chapter),
  );
  const earlier = Math.max(manga.unreadCount - shown.length, 0);
  const rows = shown
    .map((chapter, index) => {
      const number = escapeHtml(chapter.attributes.chapter);
      const date = formatDate(chapter.attributes.createdAt ?? chapter.attributes.publishAt);
      const label = `<span class="ch-num">Ch. ${number}</span>`;
      if (!user) {
        return `<li><div class="chapter">${label}<time>${escapeHtml(date)}</time></div></li>`;
      }
      const count = earlier + index + 1;
      return `
        <li>
          <button type="button" class="chapter" data-action="read" data-chapter-number="${number}"
            aria-label="Mark ${title} read through chapter ${number}">
            <span class="box">${ICONS.check}</span>
            ${label}
            <span class="ch-side"><time>${escapeHtml(date)}</time><span class="ch-hint" aria-hidden="true">${count === 1 ? 'Mark read' : `Mark ${count} read`}</span></span>
          </button>
        </li>`;
    })
    .join('');
  const earlierRow = earlier > 0 ? `<li class="chapter-note">${plural(earlier, 'earlier chapter')}</li>` : '';
  const lastRead = manga.lastReadChapter !== null && manga.lastReadChapter !== undefined
    ? `<span>Last read Ch. ${escapeHtml(manga.lastReadChapter)}</span>`
    : '<span>Nothing read yet</span>';
  const site = manga.source_url
    ? `<a class="link" href="${escapeHtml(manga.source_url)}" target="_blank" rel="noopener noreferrer">Read on ${escapeHtml(hostOf(manga.source_url))} ${ICONS.out}</a>`
    : user
      ? '<button type="button" class="link" data-action="source">Set reading site</button>'
      : '';
  return `
    <article class="panel manga-card${lead ? ' lead' : ''}" data-manga-id="${escapeHtml(manga.manga_id)}" style="view-transition-name: panel-${key}">
      <div class="panel-card">
        ${coverBox(manga.source_url ? 'a' : 'div', 'panel-cover', manga, `cover-${key}`)}
        <span class="sticker">${manga.unreadCount} new</span>
        <div class="panel-main">
          <header class="panel-head">
            <h2>${title}</h2>
            ${titleMenu(manga)}
          </header>
          <ol class="chapters">${earlierRow}${rows}</ol>
          <footer class="panel-foot">${lastRead}${site}</footer>
        </div>
      </div>
    </article>`;
}

function renderBook(manga: Manga, key: string): string {
  const latest = manga.latestChapter ?? manga.lastReadChapter;
  return `
    <li class="book manga-card" data-manga-id="${escapeHtml(manga.manga_id)}" style="view-transition-name: book-${key}">
      ${coverBox(manga.source_url ? 'a' : 'div', 'book-cover', manga, `cover-${key}`)}
      <div class="book-meta">
        <div>
          <strong>${escapeHtml(manga.manga_title)}</strong>
          ${latest !== null && latest !== undefined ? `<span>Ch. ${escapeHtml(latest)}</span>` : ''}
        </div>
        ${titleMenu(manga)}
      </div>
    </li>`;
}

function render(): void {
  const query = element<HTMLInputElement>('filter').value.trim().toLowerCase();
  const total = library.length;
  const withUnread = library.filter((manga) => manga.unreadCount > 0);
  const chapters = withUnread.reduce((sum, manga) => sum + manga.unreadCount, 0);

  element<HTMLElement>('headline').textContent = !libraryLoaded
    ? 'Loading library'
    : chapters
      ? `${plural(chapters, 'chapter')} to read`
      : total
        ? 'All caught up'
        : 'No manga tracked';
  element<HTMLElement>('subline').textContent = !libraryLoaded
    ? ''
    : !total
      ? 'Track a series to see its new chapters here.'
      : chapters
        ? `${withUnread.length} of ${plural(total, 'tracked series')} ${withUnread.length === 1 ? 'has' : 'have'} new chapters.`
        : `${plural(total, 'tracked series')}, nothing new since the last check.`;

  const keyed = library.map((manga, index) => ({ manga, key: String(manga.id ?? `i${index}`) }));
  const visible = keyed.filter(({ manga }) => manga.manga_title.toLowerCase().includes(query));
  const reading = visible
    .filter(({ manga }) => manga.unreadCount > 0)
    .sort((a, b) => b.manga.unreadCount - a.manga.unreadCount || a.manga.manga_title.localeCompare(b.manga.manga_title));
  const caughtUp = visible
    .filter(({ manga }) => manga.unreadCount === 0)
    .sort((a, b) => a.manga.manga_title.localeCompare(b.manga.manga_title));

  const queue = element<HTMLElement>('manga-list');
  if (reading.length) {
    queue.innerHTML = reading
      .map(({ manga, key }, index) => renderPanel(manga, index === 0 && manga.unreadCount >= 3 && reading.length > 1, key))
      .join('');
  } else if (libraryLoaded && !total) {
    queue.innerHTML = user
      ? `<div class="empty"><p>Your library is empty.</p><button type="button" class="btn btn-ink" data-action="open-track">${ICONS.plus} Track manga</button></div>`
      : '<div class="empty"><p>The demo library is empty.</p></div>';
  } else if (query && !caughtUp.length) {
    queue.innerHTML = `<div class="empty"><p>No titles match “${escapeHtml(query)}”.</p><button type="button" class="btn" data-action="clear-filter">Clear filter</button></div>`;
  } else {
    queue.innerHTML = '';
  }
  queue.hidden = queue.innerHTML === '';

  element<HTMLElement>('shelf-section').hidden = caughtUp.length === 0;
  element<HTMLElement>('shelf-count').textContent = String(caughtUp.length);
  element<HTMLElement>('shelf').innerHTML = caughtUp.map(({ manga, key }) => renderBook(manga, key)).join('');
}

/** Re-renders inside a view transition so a finished series visibly moves to the shelf. */
function paint(): void {
  const transitions = document as Document & { startViewTransition?: (update: () => void) => unknown };
  const reduced = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (typeof transitions.startViewTransition === 'function' && !reduced) {
    transitions.startViewTransition(render);
  } else {
    render();
  }
}

async function loadLibrary(): Promise<void> {
  library = await api<Manga[]>('/api/manga');
  const first = !libraryLoaded;
  libraryLoaded = true;
  if (first) render();
  else paint();
}

function mangaFor(target: HTMLElement): Manga | null {
  const id = target.closest<HTMLElement>('[data-manga-id]')?.dataset.mangaId;
  return library.find((manga) => manga.manga_id === id) ?? null;
}

function focusPanel(mangaId: string): void {
  const selector = `[data-manga-id="${CSS.escape(mangaId)}"]`;
  document.querySelector<HTMLElement>(`${selector} .chapter, ${selector} summary`)?.focus();
}

async function markRead(manga: Manga, target: HTMLElement): Promise<void> {
  const chapterNumber = target.dataset.chapterNumber ?? '';
  const card = target.closest<HTMLElement>('.panel');
  card?.setAttribute('aria-busy', 'true');
  try {
    await api('/api/read', {
      method: 'POST',
      body: JSON.stringify({ mangaId: manga.manga_id, chapterNumber }),
    });
    await loadLibrary();
    focusPanel(manga.manga_id);
    announce(`${manga.manga_title} marked read through Ch. ${chapterNumber}`);
  } finally {
    card?.removeAttribute('aria-busy');
  }
}

function openSource(manga: Manga): void {
  editing = manga;
  element<HTMLElement>('source-modal-message').textContent = `Website URL for ${manga.manga_title}`;
  element<HTMLInputElement>('source-url-input').value = manga.source_url;
  element<HTMLElement>('source-modal-clear').hidden = manga.source_url === '';
  setMessage('source-modal-error', '');
  show('source-modal');
}

async function saveSource(clear: boolean): Promise<void> {
  if (!editing) return;
  const value = clear ? '' : element<HTMLInputElement>('source-url-input').value.trim();
  let sourceUrl = '';
  if (value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Unsupported protocol');
      sourceUrl = url.href;
    } catch {
      setMessage('source-modal-error', 'Enter a URL that starts with https:// or http://');
      return;
    }
  }
  const { manga_id: mangaId, manga_title: title } = editing;
  try {
    await api(`/api/manga/${encodeURIComponent(mangaId)}/source`, {
      method: 'PATCH',
      body: JSON.stringify({ sourceUrl }),
    });
  } catch (error) {
    setMessage('source-modal-error', (error as Error).message);
    return;
  }
  hide('source-modal');
  await loadLibrary();
  announce(sourceUrl ? `Reading site saved for ${title}` : `Reading site cleared for ${title}`);
}

function openRemove(manga: Manga): void {
  editing = manga;
  element<HTMLElement>('modal-message').textContent = `Remove ${manga.manga_title}?`;
  show('confirm-modal');
}

async function removeManga(): Promise<void> {
  if (!editing) return;
  const { manga_id: mangaId, manga_title: title } = editing;
  hide('confirm-modal');
  await api('/api/untrack/' + encodeURIComponent(mangaId), { method: 'DELETE' });
  await loadLibrary();
  announce(`${title} removed from your library`);
}

function libraryAction(target: HTMLElement): void {
  const action = target.dataset.action;
  if (action === 'open-track') {
    openTrack();
    return;
  }
  if (action === 'clear-filter') {
    const filter = element<HTMLInputElement>('filter');
    filter.value = '';
    render();
    filter.focus();
    return;
  }
  const manga = mangaFor(target);
  if (!manga) return;
  if (action === 'read') run(markRead(manga, target));
  else if (action === 'source') openSource(manga);
  else if (action === 'remove') openRemove(manga);
}

function openTrack(): void {
  element<HTMLInputElement>('search-input').value = '';
  const results = element<HTMLElement>('search-results');
  results.innerHTML = '';
  results.hidden = true;
  show('track-dialog');
}

async function search(): Promise<void> {
  const query = element<HTMLInputElement>('search-input').value.trim();
  const results = element<HTMLElement>('search-results');
  results.hidden = false;
  if (query.length < 2) {
    results.innerHTML = '<p class="catalog-note">Enter at least 2 characters.</p>';
    return;
  }
  const button = element<HTMLButtonElement>('search-button');
  button.disabled = true;
  results.innerHTML = '<p class="catalog-note">Searching…</p>';
  try {
    const found = await api<{ results: SearchResult[] }>(`/api/search?title=${encodeURIComponent(query)}`);
    const tracked = new Set(library.map((manga) => manga.manga_id));
    results.innerHTML = found.results.length
      ? found.results
          .map((item) => {
            const meta = [item.type ?? 'Series', item.latestChapter ? `latest Ch. ${item.latestChapter}` : '']
              .filter(Boolean)
              .join(', ');
            const cover = item.imageUrl
              ? `<img src="${escapeHtml(item.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
              : `<div class="cover-blank"><span aria-hidden="true">${escapeHtml(item.title.trim().charAt(0).toUpperCase())}</span></div>`;
            return `
              <div class="catalog-row search-result-item">
                ${cover}
                <div class="catalog-copy">
                  <strong class="search-result-title">${escapeHtml(item.title)}</strong>
                  <span class="search-result-meta">${escapeHtml(meta)}</span>
                </div>
                ${
                  tracked.has(item.id)
                    ? `<span class="tracked">${ICONS.check} Tracked</span>`
                    : `<button type="button" class="btn" data-action="track" data-id="${escapeHtml(item.id)}" data-title="${escapeHtml(item.title)}" aria-label="Track ${escapeHtml(item.title)}">Track</button>`
                }
              </div>`;
          })
          .join('')
      : `<p class="catalog-note">No titles match “${escapeHtml(query)}”.</p>`;
  } catch (error) {
    results.innerHTML = `<p class="catalog-note">${escapeHtml((error as Error).message)}</p>`;
  } finally {
    button.disabled = false;
  }
}

async function track(target: HTMLButtonElement): Promise<void> {
  const mangaId = target.dataset.id ?? '';
  const title = target.dataset.title ?? '';
  target.disabled = true;
  try {
    // No coverUrl: the server fills it in from the provider's series details.
    await api<{ success: boolean }>('/api/track', {
      method: 'POST',
      body: JSON.stringify({ mangaId, title }),
    });
  } catch (error) {
    target.disabled = false;
    throw error;
  }
  hide('track-dialog');
  element<HTMLInputElement>('filter').value = '';
  await loadLibrary();
  focusPanel(mangaId);
  announce(`${title} added to your library`);
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
  } catch (error) {
    const apiError = error as ApiError;
    const message = apiError.code === 'ACCOUNT_PENDING'
      ? 'Your account is waiting for owner approval.'
      : apiError.code === 'ACCOUNT_REJECTED'
        ? 'This account was rejected. Contact the owner for re-approval.'
        : 'Invalid username or password.';
    setMessage('login-error', message);
    return;
  }
  hide('login-modal');
  element<HTMLInputElement>('login-password').value = '';
  await loadSession();
  await loadLibrary();
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
    setMessage('request-message', 'Request sent. The owner must approve it before you can sign in.', true);
  } catch (error) {
    setMessage('request-message', (error as Error).message);
  }
}

function openPasswordDialog(required: boolean): void {
  passwordRequired = required;
  element<HTMLElement>('password-required-message').hidden = !required;
  element<HTMLButtonElement>('password-cancel').hidden = required;
  element<HTMLInputElement>('current-password').value = '';
  element<HTMLInputElement>('new-password').value = '';
  setMessage('password-error', '');
  show('password-modal');
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
  } catch (error) {
    setMessage('password-error', (error as Error).message);
    return;
  }
  passwordRequired = false;
  hide('password-modal');
  await loadSession();
  announce('Password changed');
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
  button.textContent = 'Checking…';
  try {
    await api('/api/refresh', { method: 'POST' });
    await loadLibrary();
    announce('Checked every series for new chapters');
  } finally {
    button.disabled = false;
    button.textContent = 'Check now';
  }
}

async function startTimer(): Promise<void> {
  const { nextCheck } = await api<{ nextCheck: string | null }>('/api/next-check');
  const display = element<HTMLElement>('timer-display');
  const wrapper = document.getElementById('next-check');
  if (timer !== null) window.clearInterval(timer);
  if (!nextCheck) return;
  const update = (): void => {
    const minutes = Math.ceil(Math.max(new Date(nextCheck).getTime() - Date.now(), 0) / 60_000);
    display.textContent = minutes < 1
      ? 'any moment'
      : minutes < 60
        ? `in ${minutes} min`
        : `in ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
  };
  update();
  if (wrapper) wrapper.hidden = false;
  timer = window.setInterval(update, 30_000);
}

async function renderAdmin(): Promise<void> {
  if (!user) await loadSession();
  if (user?.role !== 'owner') {
    window.location.assign('/');
    return;
  }
  const users = (await api<{ users: AdminUser[] }>('/api/admin/users?status=all')).users;
  document.body.innerHTML = `
    <header class="masthead">
      <div class="wrap masthead-row">
        <a class="brand" href="/">Manga Tracker</a>
        <a class="btn btn-small" href="/">Back to library</a>
      </div>
    </header>
    <main class="wrap admin-page">
      <div class="intro"><h1>Accounts</h1></div>
      <p id="admin-secret" class="notice" hidden></p>
      <div class="admin-list">
        ${users
          .map(
            (account) => `
              <article class="admin-user" data-user-id="${escapeHtml(account.id)}">
                <div class="admin-card">
                  <div class="admin-head">
                    <h2>${escapeHtml(account.username ?? '(no username)')}</h2>
                    <span class="tag status-${escapeHtml(account.approvalStatus)}">${account.role === 'admin' ? 'Owner' : escapeHtml(account.approvalStatus)}</span>
                  </div>
                  <div class="admin-body">
                    <p>${escapeHtml(account.email)}</p>
                    <p>${plural(account.trackedCount, 'tracked series')}</p>
                    ${
                      account.role === 'admin'
                        ? ''
                        : `<div class="admin-actions">
                            <button type="button" class="btn btn-ink" data-admin-action="approve">Approve</button>
                            <button type="button" class="btn" data-admin-action="reject">Reject</button>
                            <button type="button" class="btn" data-admin-action="revoke-sessions">Sign out everywhere</button>
                            <button type="button" class="btn" data-admin-action="reset-password">Reset password</button>
                          </div>`
                    }
                  </div>
                </div>
              </article>`,
          )
          .join('')}
      </div>
    </main>`;
}

async function adminAction(userId: string, action: string): Promise<void> {
  const data = await api<{ temporaryPassword?: string }>(
    `/api/admin/users/${encodeURIComponent(userId)}/${action}`,
    { method: 'POST' },
  );
  await renderAdmin();
  if (data.temporaryPassword) {
    const secret = element<HTMLElement>('admin-secret');
    secret.textContent = `Temporary password, shown once: ${data.temporaryPassword}`;
    secret.hidden = false;
  }
}

function bindAdmin(): void {
  document.body.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-admin-action]');
    const card = target?.closest<HTMLElement>('[data-user-id]');
    if (!target || !card) return;
    void adminAction(card.dataset.userId ?? '', target.dataset.adminAction ?? '').catch((error: unknown) => {
      const secret = element<HTMLElement>('admin-secret');
      secret.textContent = error instanceof Error ? error.message : 'Request failed';
      secret.hidden = false;
    });
  });
}

function onSubmit(id: string, handler: () => Promise<void>): void {
  element<HTMLFormElement>(id).addEventListener('submit', (event) => {
    event.preventDefault();
    run(handler());
  });
}

function bindUi(): void {
  onSubmit('search-form', search);
  onSubmit('source-form', () => saveSource(false));
  onSubmit('confirm-form', removeManga);
  onSubmit('login-form', signIn);
  onSubmit('request-form', requestAccount);
  onSubmit('password-form', changePassword);

  element<HTMLButtonElement>('refresh-btn').addEventListener('click', () => run(refresh()));
  element<HTMLButtonElement>('track-open').addEventListener('click', openTrack);
  element<HTMLButtonElement>('source-modal-clear').addEventListener('click', () => run(saveSource(true)));
  element<HTMLInputElement>('filter').addEventListener('input', render);
  element<HTMLButtonElement>('request-open').addEventListener('click', () => {
    hide('login-modal');
    setMessage('request-message', '');
    show('request-modal');
  });
  element<HTMLElement>('search-results').addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action="track"]');
    if (target) run(track(target));
  });
  dialog('password-modal').addEventListener('cancel', (event) => {
    if (passwordRequired) event.preventDefault();
  });

  // A cover that fails to load shows the title's initial instead of a broken image.
  // Error events do not bubble, so this listens in the capture phase.
  document.addEventListener('error', (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || !img.parentElement) return;
    const title = img.closest('.manga-card, .search-result-item')
      ?.querySelector('h2, .book-meta strong, .search-result-title')?.textContent ?? '';
    const initial = document.createElement('span');
    initial.setAttribute('aria-hidden', 'true');
    initial.textContent = title.trim().charAt(0).toUpperCase();
    if (img.parentElement.matches('.panel-cover, .book-cover')) {
      img.parentElement.classList.add('cover-blank');
      img.replaceWith(initial);
    } else {
      const blank = document.createElement('div');
      blank.className = 'cover-blank';
      blank.append(initial);
      img.replaceWith(blank);
    }
  }, true);

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const openMenu = target.closest('.menu');
    document.querySelectorAll<HTMLDetailsElement>('.menu[open]').forEach((menu) => {
      if (menu !== openMenu) menu.open = false;
    });

    if (target instanceof HTMLDialogElement) {
      if (!(target.id === 'password-modal' && passwordRequired)) target.close();
      return;
    }
    const closer = target.closest<HTMLElement>('[data-close]');
    if (closer) {
      closer.closest('dialog')?.close();
      return;
    }
    const actor = target.closest<HTMLElement>('[data-action]');
    if (!actor) return;
    const action = actor.dataset.action;
    if (actor.closest('.menu-box')) actor.closest<HTMLDetailsElement>('.menu')!.open = false;
    if (action === 'signin') {
      setMessage('login-error', '');
      show('login-modal');
    } else if (action === 'password') openPasswordDialog(false);
    else if (action === 'logout') run(signOut());
    else if (action !== 'track') libraryAction(actor);
  });

  document.addEventListener('keydown', (event) => {
    const filter = element<HTMLInputElement>('filter');
    const openMenu = document.querySelector<HTMLDetailsElement>('.menu[open]');
    if (event.key === 'Escape' && openMenu) {
      openMenu.open = false;
      openMenu.querySelector('summary')?.focus();
      return;
    }
    if (event.key === 'Escape' && document.activeElement === filter && filter.value) {
      filter.value = '';
      render();
      return;
    }
    const typing = document.activeElement?.matches('input, textarea, select') ?? false;
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !typing && !document.querySelector('dialog[open]')) {
      event.preventDefault();
      filter.focus();
    }
  });
}

async function initializeLibrary(): Promise<void> {
  await loadSession();
  await Promise.all([loadLibrary(), startTimer()]);
}

document.addEventListener('DOMContentLoaded', () => {
  if (window.location.pathname === '/admin') {
    bindAdmin();
    void renderAdmin();
    return;
  }
  bindUi();
  run(initializeLibrary());
});
