// app.js
const API_URL = 'http://localhost:3000'; // Change to your AWS IP when deploying
const USER_ID = 1; // For now, hardcode. Add auth later.

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
    const response = await fetch(`${API_URL}/api/user/${USER_ID}/track`, {
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
    const response = await fetch(`${API_URL}/api/user/${USER_ID}/manga`);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const manga = await response.json();
    const listDiv = document.getElementById('manga-list');
    
    if (!manga || manga.length === 0) {
      listDiv.innerHTML = '<div class="empty-state">No tracked manga yet. Search and track some manga to get started!</div>';
      return;
    }
    
    listDiv.innerHTML = manga.map(m => `
      <div class="manga-card">
        <div class="manga-header">
          <h3 class="manga-title">${m.manga_title}</h3>
          <span class="unread-badge">${m.unreadCount} NEW</span>
        </div>
        <div class="chapter-list">
          ${m.unreadChapters && m.unreadChapters.length > 0 
            ? m.unreadChapters.map(ch => `
                <div class="chapter-item">
                  <span class="chapter-number">Ch. ${ch.attributes.chapter || 'N/A'}</span>
                  <button class="btn-small" onclick="markRead('${m.manga_id}', '${ch.id}', '${ch.attributes.chapter || '0'}')">
                    ✓ READ
                  </button>
                </div>
              `).join('')
            : '<div class="empty-state">All caught up!</div>'
          }
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Load tracked manga error:', error);
    const listDiv = document.getElementById('manga-list');
    listDiv.innerHTML = '<div class="empty-state">Failed to load manga. Is the server running?</div>';
  }
}

// Mark chapter as read
async function markRead(mangaId, chapterId, chapterNumber) {
  try {
    const response = await fetch(`${API_URL}/api/user/${USER_ID}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mangaId, chapterId, chapterNumber })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    await loadTrackedManga();
  } catch (error) {
    console.error('Mark read error:', error);
    alert('Failed to mark chapter as read. Check console for details.');
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
});
