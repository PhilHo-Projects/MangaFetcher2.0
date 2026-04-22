const API_ROOT = 'api';
const DEFAULT_THEME_COLOR = '#FDBA74';
const CLEAR_BUTTON_COLOR = '#BBF7D0';
const HEADER_PALETTE_OPTIONS = Object.freeze([
  '#E9D8A6',
  '#FDE68A',
  '#D9F99D',
  '#BBF7D0',
  '#A7F3D0',
  '#BFDBFE',
  '#C7D2FE',
  '#DDD6FE',
  '#F5D0FE',
  '#F9A8D4',
  '#FDBA74',
  '#FCA5A5'
]);

let timerInterval = null;
let sourceModalState = {
  mangaId: '',
  sourceUrl: ''
};

const HEADER_ICONS = Object.freeze({
  source: `
    <svg viewBox="0 0 20 20" aria-hidden="true" class="header-chip-icon">
      <path
        d="M13.25 3.25L16.75 6.75L7.25 16.25L3.5 16.5L3.75 12.75L13.25 3.25Z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="square"
        stroke-linejoin="miter"
      ></path>
      <path
        d="M11.75 4.75L15.25 8.25"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="square"
      ></path>
    </svg>
  `,
  clear: `
    <svg viewBox="0 0 20 20" aria-hidden="true" class="header-chip-icon header-chip-icon-clear">
      <path
        d="M5 5L15 15M15 5L5 15"
        fill="none"
        stroke="currentColor"
        stroke-width="2.8"
        stroke-linecap="square"
      ></path>
    </svg>
  `,
  new: `
    <svg viewBox="0 0 20 20" aria-hidden="true" class="header-chip-icon">
      <path
        d="M10 2.5V5.25M10 14.75V17.5M17.5 10H14.75M5.25 10H2.5M15.3 4.7L13.35 6.65M6.65 13.35L4.7 15.3M15.3 15.3L13.35 13.35M6.65 6.65L4.7 4.7"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="square"
      ></path>
      <rect x="8.25" y="8.25" width="3.5" height="3.5" fill="currentColor"></rect>
    </svg>
  `,
  remove: `
    <svg viewBox="0 0 20 20" aria-hidden="true" class="header-chip-icon header-chip-icon-remove">
      <path
        d="M4.5 6.5H15.5M7 6.5V5.25C7 4.56 7.56 4 8.25 4H11.75C12.44 4 13 4.56 13 5.25V6.5M6.5 6.5L7.25 15H12.75L13.5 6.5M8.5 9V13.5M11.5 9V13.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="square"
        stroke-linejoin="miter"
      ></path>
    </svg>
  `
});

function apiUrl(path) {
  return `${API_ROOT}/${path.replace(/^\/+/, '')}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => {
    if (char === '&') return '&amp;';
    if (char === '<') return '&lt;';
    if (char === '>') return '&gt;';
    if (char === '"') return '&quot;';
    return '&#39;';
  });
}

function encodeInlineArg(value) {
  return encodeURIComponent(String(value ?? ''));
}

function decodeInlineArg(value) {
  return decodeURIComponent(value);
}

function formatDate(dateString) {
  if (!dateString) return '??/??/??';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return '??/??/??';
  }

  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);
  return `${month}/${day}/${year}`;
}

function formatChapterNumber(value) {
  const normalized = String(value ?? '').trim();
  return normalized || '?';
}

function renderMangaTitleMarkup(title, sourceUrl) {
  const safeTitle = escapeHtml(title);
  const safeUrl = escapeHtml(sourceUrl);

  if (!sourceUrl) {
    return `<span class="manga-title">${safeTitle}</span>`;
  }

  return `
    <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="manga-title manga-title-link">
      ${safeTitle}
    </a>
  `;
}

function getSourceButtonTitle(sourceUrl) {
  return sourceUrl ? 'Edit reading site' : 'Set reading site';
}

function renderSourceButtonContent() {
  return HEADER_ICONS.source;
}

function renderRemoveButtonContent() {
  return HEADER_ICONS.remove;
}

function renderMigrationNotice() {
  return `
    <div class="migration-notice">
      THIS TITLE COULDN'T BE AUTO-MAPPED TO MANGAUPDATES.
      SEARCH IT AGAIN AND TRACK IT TO RELINK.
    </div>
  `;
}

function renderChapterRows(manga) {
  if (manga.migration_status === 'unresolved') {
    return renderMigrationNotice();
  }

  if (!Array.isArray(manga.chapters) || manga.chapters.length === 0) {
    return '<div class="empty-state">All caught up!</div>';
  }

  return manga.chapters.map(chapter => {
    const chapterNumber = formatChapterNumber(chapter.attributes.chapter);
    const chapterId = chapter.id;
    const releaseDate = formatDate(chapter.attributes.createdAt || chapter.attributes.publishAt);
    const encodedMangaId = encodeInlineArg(manga.manga_id);
    const encodedChapterId = encodeInlineArg(chapterId);
    const encodedChapterNumber = encodeInlineArg(chapterNumber);

    return `
      <div
        class="chapter-item"
        data-chapter-id="${escapeHtml(chapterId)}"
        data-chapter-number="${escapeHtml(chapterNumber)}"
      >
        <span class="chapter-label">Chapter ${escapeHtml(chapterNumber)}</span>
        <span class="chapter-date">${escapeHtml(releaseDate)}</span>
        <div class="chapter-actions">
          <button
            class="btn-small btn-clear"
            onclick="markRead(decodeInlineArg('${encodedMangaId}'), decodeInlineArg('${encodedChapterId}'), decodeInlineArg('${encodedChapterNumber}'))"
            title="Clear chapters through this one"
            aria-label="Clear chapters through this one"
          >
            ${HEADER_ICONS.clear}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function setSourceModalBusy(isBusy) {
  const cancelBtn = document.getElementById('source-modal-cancel');
  const clearBtn = document.getElementById('source-modal-clear');
  const saveBtn = document.getElementById('source-modal-save');

  if (!cancelBtn || !clearBtn || !saveBtn) {
    return;
  }

  cancelBtn.disabled = isBusy;
  clearBtn.disabled = isBusy;
  saveBtn.disabled = isBusy;
  saveBtn.textContent = isBusy ? 'SAVING...' : 'SAVE';
}

function setSourceModalError(message = '') {
  const errorElement = document.getElementById('source-modal-error');
  if (!errorElement) {
    return;
  }

  errorElement.textContent = message;
  errorElement.hidden = !message;
}

function hideSourceModal() {
  const modal = document.getElementById('source-modal');
  if (modal) {
    modal.style.display = 'none';
  }

  setSourceModalBusy(false);
  setSourceModalError('');
  sourceModalState = { mangaId: '', sourceUrl: '' };
}

function showSourceModal(mangaId, title, sourceUrl) {
  const modal = document.getElementById('source-modal');
  const message = document.getElementById('source-modal-message');
  const input = document.getElementById('source-url-input');
  const clearBtn = document.getElementById('source-modal-clear');

  if (!modal || !message || !input || !clearBtn) {
    return;
  }

  sourceModalState = {
    mangaId,
    sourceUrl: sourceUrl || ''
  };

  message.textContent = `Set where "${title}" opens when you click the title.`;
  input.value = sourceUrl || '';
  clearBtn.hidden = !sourceUrl;
  setSourceModalBusy(false);
  setSourceModalError('');

  modal.style.display = 'flex';
  input.focus();
  input.select();
}

function openSourceModalByManga(mangaId) {
  const card = document.querySelector(`.manga-card[data-manga-id="${mangaId}"]`);
  if (!card) {
    return;
  }

  showSourceModal(mangaId, card.dataset.mangaTitle || '', card.dataset.sourceUrl || '');
}

function updateMangaSourceDisplay(mangaId, sourceUrl) {
  const card = document.querySelector(`.manga-card[data-manga-id="${mangaId}"]`);
  if (!card) {
    return;
  }

  const titleBlock = card.querySelector('[data-role="manga-title"]');
  const sourceButton = card.querySelector('[data-role="source-button"]');
  const normalizedSourceUrl = sourceUrl || '';

  card.dataset.sourceUrl = normalizedSourceUrl;

  if (titleBlock) {
    titleBlock.innerHTML = renderMangaTitleMarkup(card.dataset.mangaTitle || '', normalizedSourceUrl);
  }

  if (sourceButton) {
    sourceButton.innerHTML = renderSourceButtonContent();
    sourceButton.title = getSourceButtonTitle(normalizedSourceUrl);
    sourceButton.setAttribute('aria-label', getSourceButtonTitle(normalizedSourceUrl));
  }
}

async function submitSourceUrlUpdate(sourceUrlOverride) {
  if (!sourceModalState.mangaId) {
    return;
  }

  const input = document.getElementById('source-url-input');
  const sourceUrl = typeof sourceUrlOverride === 'string'
    ? sourceUrlOverride
    : (input ? input.value.trim() : '');

  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) {
    setSourceModalError('URL must start with http:// or https://');
    return;
  }

  setSourceModalBusy(true);
  setSourceModalError('');

  try {
    const response = await fetch(apiUrl(`manga/${encodeURIComponent(sourceModalState.mangaId)}/source`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceUrl })
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || `HTTP error! status: ${response.status}`);
    }

    updateMangaSourceDisplay(sourceModalState.mangaId, payload.sourceUrl || '');
    hideSourceModal();
  } catch (error) {
    console.error('Update source URL error:', error);
    setSourceModalError(error.message || 'Failed to save source URL');
    setSourceModalBusy(false);
  }
}

function initializeSourceModal() {
  const modal = document.getElementById('source-modal');
  const cancelBtn = document.getElementById('source-modal-cancel');
  const clearBtn = document.getElementById('source-modal-clear');
  const saveBtn = document.getElementById('source-modal-save');
  const input = document.getElementById('source-url-input');

  if (!modal || !cancelBtn || !clearBtn || !saveBtn || !input) {
    return;
  }

  cancelBtn.addEventListener('click', hideSourceModal);
  clearBtn.addEventListener('click', () => submitSourceUrlUpdate(''));
  saveBtn.addEventListener('click', () => submitSourceUrlUpdate());
  modal.addEventListener('click', event => {
    if (event.target === modal) {
      hideSourceModal();
    }
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      hideSourceModal();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      submitSourceUrlUpdate();
    }
  });
}

function applyHeaderPalette(color) {
  document.documentElement.style.setProperty('--card-header-bg', color);
  document.documentElement.style.setProperty('--theme-ui-bg', color);
  document.documentElement.style.setProperty('--clear-action-bg', CLEAR_BUTTON_COLOR);

  const swatches = document.querySelectorAll('.palette-swatch');
  swatches.forEach(swatch => {
    const isActive = swatch.dataset.color === color;
    swatch.classList.toggle('palette-swatch-active', isActive);
  });
}

function initializeHeaderPalette() {
  const paletteRoot = document.getElementById('header-palette');
  if (!paletteRoot) {
    return;
  }

  paletteRoot.innerHTML = HEADER_PALETTE_OPTIONS.map(color => `
    <button
      class="palette-swatch"
      type="button"
      data-color="${escapeHtml(color)}"
      title="Use ${escapeHtml(color)} for card headers"
      style="--swatch-color: ${escapeHtml(color)}"
    ></button>
  `).join('');

  paletteRoot.addEventListener('click', event => {
    const target = event.target.closest('.palette-swatch');
    if (!target) {
      return;
    }

    applyHeaderPalette(target.dataset.color);
  });

  applyHeaderPalette(DEFAULT_THEME_COLOR);
}

async function searchManga() {
  try {
    const query = document.getElementById('search-input').value.trim();
    if (!query) {
      alert('Please enter a manga title');
      return;
    }

    const response = await fetch(apiUrl(`search?title=${encodeURIComponent(query)}`));
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const results = Array.isArray(data.results) ? data.results : [];
    const resultsDiv = document.getElementById('search-results');

    if (results.length === 0) {
      resultsDiv.innerHTML = '<div class="empty-state">No manga found</div>';
      return;
    }

    resultsDiv.innerHTML = results.map(manga => {
      const encodedMangaId = encodeInlineArg(manga.id);
      const encodedTitle = encodeInlineArg(manga.title);
      return `
        <div
          class="search-result-item search-result-item-clickable"
          role="button"
          tabindex="0"
          title="Track ${escapeHtml(manga.title)}"
          onclick="trackManga(decodeInlineArg('${encodedMangaId}'), decodeInlineArg('${encodedTitle}'))"
          onkeydown="if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); trackManga(decodeInlineArg('${encodedMangaId}'), decodeInlineArg('${encodedTitle}')); }"
        >
          <div class="search-result-copy">
            <span class="search-result-title">${escapeHtml(manga.title)}</span>
            <span class="search-result-meta">
              ${escapeHtml(manga.type || 'Series')}
              ${manga.latestChapter ? ` • Latest ${escapeHtml(manga.latestChapter)}` : ''}
            </span>
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Search error:', error);
    alert('Failed to search manga. Check console for details.');
  }
}

async function trackManga(mangaId, title) {
  try {
    const response = await fetch(apiUrl('track'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mangaId, title, coverUrl: '' })
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    document.getElementById('search-results').innerHTML = '';
    document.getElementById('search-input').value = '';

    await loadTrackedManga();
    alert(`Added "${title}" to your library!`);
  } catch (error) {
    console.error('Track manga error:', error);
    alert('Failed to track manga. Check console for details.');
  }
}

async function loadTrackedManga() {
  try {
    const response = await fetch(apiUrl('manga'));
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const mangaList = await response.json();
    const listDiv = document.getElementById('manga-list');

    if (!Array.isArray(mangaList) || mangaList.length === 0) {
      listDiv.innerHTML = '<div class="empty-state">No tracked manga yet. Search and track some manga to get started!</div>';
      return;
    }

    listDiv.innerHTML = mangaList.map(manga => {
      const encodedMangaId = encodeInlineArg(manga.manga_id);
      const encodedTitle = encodeInlineArg(manga.manga_title);
      return `
        <div
          class="manga-card ${manga.migration_status === 'unresolved' ? 'manga-card-warning' : ''}"
          data-manga-id="${escapeHtml(manga.manga_id)}"
          data-manga-title="${escapeHtml(manga.manga_title)}"
          data-source-url="${escapeHtml(manga.source_url || '')}"
        >
          <div class="manga-header">
            <div class="manga-title-block" data-role="manga-title">
              ${renderMangaTitleMarkup(manga.manga_title, manga.source_url || '')}
            </div>
            <div class="manga-header-actions">
              <button
                class="btn-source"
                data-role="source-button"
                onclick="openSourceModalByManga(decodeInlineArg('${encodedMangaId}'))"
                title="${getSourceButtonTitle(manga.source_url || '')}"
                aria-label="${getSourceButtonTitle(manga.source_url || '')}"
              >
                ${renderSourceButtonContent()}
              </button>
              <button
                class="btn-remove"
                onclick="removeManga(decodeInlineArg('${encodedMangaId}'), decodeInlineArg('${encodedTitle}'))"
                title="Remove from library"
                aria-label="Remove from library"
              >
                ${renderRemoveButtonContent()}
              </button>
            </div>
          </div>
          <div class="chapter-list" data-manga-id="${escapeHtml(manga.manga_id)}">
            ${renderChapterRows(manga)}
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Load tracked manga error:', error);
    document.getElementById('manga-list').innerHTML = '<div class="empty-state">Failed to load manga. Is the server running?</div>';
  }
}

async function markRead(mangaId, chapterId, chapterNumber) {
  const chapterList = document.querySelector(`.chapter-list[data-manga-id="${mangaId}"]`);
  const chapterElements = chapterList
    ? [...chapterList.querySelectorAll('.chapter-item')]
    : [];

  chapterElements.forEach(element => {
    const currentChapter = Number.parseInt(element.dataset.chapterNumber, 10);
    const targetChapter = Number.parseInt(chapterNumber, 10);
    if (Number.isFinite(currentChapter) && Number.isFinite(targetChapter) && currentChapter <= targetChapter) {
      element.classList.add('removing');
    }
  });

  try {
    const response = await fetch(apiUrl('read'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mangaId, chapterNumber })
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    await new Promise(resolve => setTimeout(resolve, 220));
    await loadTrackedManga();
  } catch (error) {
    console.error('Mark read error:', error);
    chapterElements.forEach(element => element.classList.remove('removing'));
    alert('Failed to mark chapter as read. Check console for details.');
  }
}

function showConfirmModal(message, onConfirm) {
  const modal = document.getElementById('confirm-modal');
  const modalMessage = document.getElementById('modal-message');
  const confirmBtn = document.getElementById('modal-confirm');
  const cancelBtn = document.getElementById('modal-cancel');

  modalMessage.textContent = message;
  modal.style.display = 'flex';

  const handleConfirm = async () => {
    cleanup();
    await onConfirm();
  };

  const handleCancel = () => {
    cleanup();
  };

  const cleanup = () => {
    modal.style.display = 'none';
    confirmBtn.removeEventListener('click', handleConfirm);
    cancelBtn.removeEventListener('click', handleCancel);
    modal.removeEventListener('click', handleOutsideClick);
  };

  const handleOutsideClick = event => {
    if (event.target === modal) {
      handleCancel();
    }
  };

  confirmBtn.addEventListener('click', handleConfirm);
  cancelBtn.addEventListener('click', handleCancel);
  modal.addEventListener('click', handleOutsideClick);
}

async function removeManga(mangaId, title) {
  showConfirmModal(`Remove "${title}" from your library?`, async () => {
    try {
      const response = await fetch(apiUrl(`untrack/${encodeURIComponent(mangaId)}`), {
        method: 'DELETE'
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      await loadTrackedManga();
    } catch (error) {
      console.error('Remove manga error:', error);
      alert('Failed to remove manga. Check console for details.');
    }
  });
}

async function manualRefresh() {
  const refreshBtn = document.getElementById('refresh-btn');
  const timerDisplay = document.getElementById('timer-display');

  try {
    refreshBtn.disabled = true;
    refreshBtn.classList.add('refreshing');
    timerDisplay.textContent = 'REFRESHING...';

    const response = await fetch(apiUrl('refresh'), {
      method: 'POST'
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    await loadTrackedManga();
    alert(`Refresh complete! Checked ${result.result.totalChecked} manga in ${result.result.duration}s`);
    startCountdownTimer();
  } catch (error) {
    console.error('Manual refresh error:', error);
    alert('Failed to refresh chapters. Check console for details.');
    timerDisplay.textContent = 'ERROR';
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.classList.remove('refreshing');
  }
}

function updateTimer(nextCheckTime) {
  const timerDisplay = document.getElementById('timer-display');
  if (!nextCheckTime) {
    timerDisplay.textContent = '--:--:--';
    return;
  }

  const now = new Date();
  const next = new Date(nextCheckTime);
  const diff = next - now;
  if (diff <= 0) {
    timerDisplay.textContent = 'CHECKING...';
    return;
  }

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);
  timerDisplay.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

async function startCountdownTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
  }

  try {
    const response = await fetch(apiUrl('next-check'));
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const nextCheckTime = data.nextCheck;
    updateTimer(nextCheckTime);

    timerInterval = setInterval(() => {
      updateTimer(nextCheckTime);

      const now = new Date();
      const next = new Date(nextCheckTime);
      if (now >= next) {
        loadTrackedManga();
        startCountdownTimer();
      }
    }, 1000);
  } catch (error) {
    console.error('Failed to start countdown timer:', error);
    document.getElementById('timer-display').textContent = 'ERROR';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('keypress', event => {
      if (event.key === 'Enter') {
        searchManga();
      }
    });
  }

  initializeSourceModal();
  initializeHeaderPalette();
  loadTrackedManga();
  startCountdownTimer();
});
