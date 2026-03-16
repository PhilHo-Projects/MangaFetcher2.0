// app.js
const API_ROOT = 'api';

let timerInterval = null;

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

// Format date to MM/DD/YY
function formatDate(dateString) {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);
  return `${month}/${day}/${year}`;
}

// Search manga
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
    
    const resultsDiv = document.getElementById('search-results');
    
    if (!data.data || data.data.length === 0) {
      resultsDiv.innerHTML = '<div class="empty-state">No manga found</div>';
      return;
    }
    
    resultsDiv.innerHTML = data.data.map(manga => {
      const title = manga.attributes.title.en || Object.values(manga.attributes.title)[0] || 'Untitled';
      const encodedMangaId = encodeInlineArg(manga.id);
      const encodedTitle = encodeInlineArg(title);
      
      return `
        <div class="search-result-item">
          <span class="manga-title">${escapeHtml(title)}</span>
          <button class="btn-small" onclick="trackManga(decodeInlineArg('${encodedMangaId}'), decodeInlineArg('${encodedTitle}'))">
            + TRACK
          </button>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Search error:', error);
    alert('Failed to search manga. Check console for details.');
  }
}

// Track a new manga
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
    
    // Clear search results and reload tracked manga
    document.getElementById('search-results').innerHTML = '';
    document.getElementById('search-input').value = '';
    
    await loadTrackedManga();
    alert(`Added "${title}" to your library!`);
  } catch (error) {
    console.error('Track manga error:', error);
    alert('Failed to track manga. Check console for details.');
  }
}

// Load all tracked manga
async function loadTrackedManga() {
  try {
    const response = await fetch(apiUrl('manga'));
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const manga = await response.json();
    const listDiv = document.getElementById('manga-list');
    
    if (!manga || manga.length === 0) {
      listDiv.innerHTML = '<div class="empty-state">No tracked manga yet. Search and track some manga to get started!</div>';
      return;
    }
    
    listDiv.innerHTML = manga.map(m => {
      const encodedMangaId = encodeInlineArg(m.manga_id);
      const encodedTitle = encodeInlineArg(m.manga_title);
      return `
        <div class="manga-card" data-manga-id="${escapeHtml(m.manga_id)}">
          <div class="manga-header">
            <h3 class="manga-title">${escapeHtml(m.manga_title)}</h3>
            <div class="manga-header-actions">
              <span class="unread-badge" data-manga-id="${escapeHtml(m.manga_id)}">${m.unreadCount} NEW</span>
              <button class="btn-remove" onclick="removeManga(decodeInlineArg('${encodedMangaId}'), decodeInlineArg('${encodedTitle}'))" title="Remove from library">
                ✕
              </button>
            </div>
          </div>
          <div class="chapter-list" data-manga-id="${escapeHtml(m.manga_id)}">
            ${m.chapters && m.chapters.length > 0 
              ? m.chapters.map(ch => {
                  const releaseDate = formatDate(ch.attributes.publishAt || ch.attributes.createdAt);
                  const encodedChapterId = encodeInlineArg(ch.id);
                  const encodedChapterNumber = encodeInlineArg(ch.attributes.chapter || '0');
                  return `
                  <div class="chapter-item" data-chapter-id="${escapeHtml(ch.id)}">
                    <a href="https://mangadex.org/chapter/${encodeURIComponent(ch.id)}" target="_blank" rel="noopener noreferrer" class="chapter-link">
                      Chapter ${escapeHtml(ch.attributes.chapter || 'N/A')}
                    </a>
                    <span class="chapter-date">${escapeHtml(releaseDate)}</span>
                    <div class="chapter-actions">
                      <button class="btn-small" 
                              onclick="markRead(decodeInlineArg('${encodedMangaId}'), decodeInlineArg('${encodedChapterId}'), decodeInlineArg('${encodedChapterNumber}'))">
                        ✓ READ
                      </button>
                    </div>
                  </div>
                `;
                }).join('')
              : '<div class="empty-state">All caught up!</div>'
            }
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Load tracked manga error:', error);
    const listDiv = document.getElementById('manga-list');
    listDiv.innerHTML = '<div class="empty-state">Failed to load manga. Is the server running?</div>';
  }
}

// Mark chapter as read with smooth animation
async function markRead(mangaId, chapterId, chapterNumber) {
  try {
    // Find the chapter element
    const chapterElement = document.querySelector(`.chapter-item[data-chapter-id="${chapterId}"]`);
    if (!chapterElement) {
      console.error('Chapter element not found');
      return;
    }
    
    // Add removing class to trigger animation
    chapterElement.classList.add('removing');
    
    // Make the API call
    const response = await fetch(apiUrl('read'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mangaId, chapterId, chapterNumber })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    // Wait for animation to complete before removing element
    setTimeout(() => {
      // Remove the chapter element from DOM
      chapterElement.remove();
      
      // Update the unread badge count
      const badge = document.querySelector(`.unread-badge[data-manga-id="${mangaId}"]`);
      if (badge) {
        const currentCount = parseInt(badge.textContent);
        const newCount = Math.max(0, currentCount - 1);
        badge.textContent = `${newCount} NEW`;
      }
      
      // Check if there are any chapters left in this manga
      const chapterList = document.querySelector(`.chapter-list[data-manga-id="${mangaId}"]`);
      if (chapterList) {
        const remainingChapters = chapterList.querySelectorAll('.chapter-item:not(.removing)');
        if (remainingChapters.length === 0) {
          // Show "All caught up!" message
          chapterList.innerHTML = '<div class="empty-state">All caught up!</div>';
        }
      }
    }, 400); // Match animation duration
    
  } catch (error) {
    console.error('Mark read error:', error);
    alert('Failed to mark chapter as read. Check console for details.');
    
    // Remove the animation class if there was an error
    const chapterElement = document.querySelector(`.chapter-item[data-chapter-id="${chapterId}"]`);
    if (chapterElement) {
      chapterElement.classList.remove('removing');
    }
  }
}

// Custom confirmation modal
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
  
  const handleOutsideClick = (e) => {
    if (e.target === modal) {
      handleCancel();
    }
  };
  
  confirmBtn.addEventListener('click', handleConfirm);
  cancelBtn.addEventListener('click', handleCancel);
  modal.addEventListener('click', handleOutsideClick);
}

// Remove manga from library
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

// Manual refresh function
async function manualRefresh() {
  const refreshBtn = document.getElementById('refresh-btn');
  const timerDisplay = document.getElementById('timer-display');
  
  try {
    // Disable button and show loading state
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
    
    // Reload the manga list to show any new chapters
    await loadTrackedManga();
    
    // Show success message
    alert(`Refresh complete! Checked ${result.result.totalChecked} manga in ${result.result.duration}s`);
    
    // Restart the timer
    startCountdownTimer();
    
  } catch (error) {
    console.error('Manual refresh error:', error);
    alert('Failed to refresh chapters. Check console for details.');
    timerDisplay.textContent = 'ERROR';
  } finally {
    // Re-enable button
    refreshBtn.disabled = false;
    refreshBtn.classList.remove('refreshing');
  }
}

// Update countdown timer
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
  
  // Calculate hours, minutes, seconds
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);
  
  // Format with leading zeros
  const formatted = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  timerDisplay.textContent = formatted;
}

// Start the countdown timer
async function startCountdownTimer() {
  // Clear any existing interval
  if (timerInterval) {
    clearInterval(timerInterval);
  }
  
  try {
    // Get next check time from server
    const response = await fetch(apiUrl('next-check'));
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    const nextCheckTime = data.nextCheck;
    
    // Update timer immediately
    updateTimer(nextCheckTime);
    
    // Update every second
    timerInterval = setInterval(() => {
      updateTimer(nextCheckTime);
      
      // If timer reaches zero, reload manga list and restart timer
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

// Allow enter key to search
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('search-input');
  
  if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        searchManga();
      }
    });
  }
  
  // Load tracked manga on page load
  loadTrackedManga();
  
  // Start countdown timer
  startCountdownTimer();
});
