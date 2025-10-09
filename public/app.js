// app.js
const API_URL = 'http://localhost:3000';

let timerInterval = null;

// Search manga
async function searchManga() {
  try {
    const query = document.getElementById('search-input').value.trim();
    
    if (!query) {
      alert('Please enter a manga title');
      return;
    }

    const response = await fetch(`${API_URL}/api/search?title=${encodeURIComponent(query)}`);
    
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
      const title = manga.attributes.title.en || Object.values(manga.attributes.title)[0];
      const safeTitle = title.replace(/'/g, "\\'");
      
      return `
        <div class="search-result-item">
          <span class="manga-title">${title}</span>
          <button class="btn-small" onclick="trackManga('${manga.id}', '${safeTitle}')">
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
    const response = await fetch(`${API_URL}/api/track`, {
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
    const response = await fetch(`${API_URL}/api/manga`);
    
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
      const safeTitle = m.manga_title.replace(/'/g, "\\'");
      return `
        <div class="manga-card">
          <div class="manga-header">
            <h3 class="manga-title">${m.manga_title}</h3>
            <div class="manga-header-actions">
              <span class="unread-badge">${m.unreadCount} NEW</span>
              <button class="btn-remove" onclick="removeManga('${m.manga_id}', '${safeTitle}')" title="Remove from library">
                ✕
              </button>
            </div>
          </div>
          <div class="chapter-list">
            ${m.chapters && m.chapters.length > 0 
              ? m.chapters.map(ch => `
                  <div class="chapter-item ${ch.isRead ? 'chapter-read' : ''}">
                    <a href="https://mangadex.org/chapter/${ch.id}" target="_blank" rel="noopener noreferrer" class="chapter-link">
                      Chapter ${ch.attributes.chapter || 'N/A'}
                    </a>
                    <div class="chapter-actions">
                      <button class="btn-small ${ch.isRead ? 'btn-read-status' : ''}" 
                              onclick="markRead('${m.manga_id}', '${ch.id}', '${ch.attributes.chapter || '0'}', ${ch.isRead})">
                        ✓ READ
                      </button>
                      ${ch.isRead 
                        ? `<button class="btn-small btn-unmark" onclick="unmarkChapter('${ch.id}')" title="Remove from list">
                             ✕
                           </button>`
                        : ''
                      }
                    </div>
                  </div>
                `).join('')
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

// Mark chapter as read (or toggle if already read)
async function markRead(mangaId, chapterId, chapterNumber, isCurrentlyRead = false) {
  try {
    if (isCurrentlyRead) {
      // If already read, unmark it
      const response = await fetch(`${API_URL}/api/unread`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapterId })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } else {
      // Mark as read
      const response = await fetch(`${API_URL}/api/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mangaId, chapterId, chapterNumber })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    }
    
    await loadTrackedManga();
  } catch (error) {
    console.error('Mark read/unread error:', error);
    alert('Failed to update chapter status. Check console for details.');
  }
}

// Unmark chapter (remove from read list)
async function unmarkChapter(chapterId) {
  try {
    const response = await fetch(`${API_URL}/api/unread`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapterId })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    await loadTrackedManga();
  } catch (error) {
    console.error('Unmark chapter error:', error);
    alert('Failed to unmark chapter. Check console for details.');
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
      const response = await fetch(`${API_URL}/api/untrack/${mangaId}`, {
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
    
    const response = await fetch(`${API_URL}/api/refresh`, {
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
    const response = await fetch(`${API_URL}/api/next-check`);
    
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
