/**
 * Focus Extension - Options Page Logic
 */

import * as todoist from '../lib/todoist.js';

// =============================================================================
// STATE
// =============================================================================

let settings = null;
let originalSettingsJson = null; // Store original settings for comparison
let hasUnsavedChanges = false;

// =============================================================================
// KEYWORD MATCHING HELPERS
// =============================================================================

/**
 * Score how well a keyword matches text
 * Higher score = better match
 * @param {string} text - Text to search in (lowercase)
 * @param {string} keyword - Keyword to match (lowercase)
 * @returns {number} - Score (0 = no match)
 */
function scoreKeywordMatch(text, keyword) {
  if (!text.includes(keyword)) {
    return 0;
  }
  
  // Base score is keyword length (longer = more specific = better)
  let score = keyword.length;
  
  // Check for word boundary match (much better than substring)
  const wordBoundaryRegex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  if (wordBoundaryRegex.test(text)) {
    score += 100; // Strong bonus for exact word match
  }
  
  return score;
}

/**
 * Find the best matching keyword from a list for event categorization
 * @param {string} text - Text to search in
 * @param {string[]} keywords - Keywords to match
 * @returns {{keyword: string, score: number}|null}
 */
function findBestKeywordMatchForEvent(text, keywords) {
  const lowerText = text.toLowerCase();
  let bestMatch = null;
  
  for (const keyword of keywords) {
    const lowerKeyword = keyword.toLowerCase();
    const score = scoreKeywordMatch(lowerText, lowerKeyword);
    
    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { keyword, score };
    }
  }
  
  return bestMatch;
}

// =============================================================================
// ICON HELPERS
// =============================================================================

// Profile icons are now loaded from lib/icons.js (PROFILE_ICON_OPTIONS)

// Map old text icon codes to new SVG icon IDs
const LEGACY_ICON_MAP = {
  'SM': 'messageCircle',  // Social Media
  'EN': 'playCircle',     // Entertainment
  'NW': 'newspaper',      // News
  'GM': 'gamepad',        // Gaming
  'SH': 'shoppingCart',   // Shopping
  'FR': 'users',          // Forums
  '*': 'target',          // Default
  'W': 'briefcase',       // Work
  'S': 'book',            // Study
  'R': 'sun',             // Relaxed
};

// Helper to get icon SVG from either new ID or legacy code
function getIconSvg(iconCode) {
  // If it's already a valid icon ID in Icons object, use it
  if (Icons[iconCode]) {
    return Icons[iconCode];
  }
  // If it's a legacy code, map it
  if (LEGACY_ICON_MAP[iconCode]) {
    return Icons[LEGACY_ICON_MAP[iconCode]];
  }
  // Default to folder icon
  return Icons.folder;
}

// =============================================================================
// INITIALIZATION
// =============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  // Load theme first to avoid flash
  await loadTheme();
  
  // Setup theme toggle
  setupThemeToggle();
  
  // Load settings
  settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  
  // Initialize UI
  await checkAuthStatus();
  populateSettings();
  setupEventListeners();
  setupScheduleListeners();
  setupNuclearModeListeners();
  setupUnsavedChangesWarning();
  setupBackupButtons();
  
  // Load and setup categories
  await loadCategories();
  setupCategoryListeners();
  
  // Load and setup keyword blocking
  await loadKeywords();
  setupKeywordListeners();
  
  // Load and setup URL whitelist
  await loadWhitelistUrls();
  setupWhitelistListeners();
  
  // Load and setup profiles
  await loadProfiles();
  setupProfileListeners();
  setupIconPicker();
  
  // Load and setup Google Calendar
  await loadCalendarStatus();
  setupCalendarListeners();
  
  // Check nuclear mode status
  await checkNuclearStatus();
  
  // Setup sidebar and search
  setupSidebar();
  setupSearch();
  initializeSearchIcons();
  
  // Store original settings snapshot AFTER DOM is fully populated,
  // so it matches the shape returned by gatherCurrentSettings()
  originalSettingsJson = JSON.stringify(gatherCurrentSettings());
});

// =============================================================================
// SIDEBAR & SEARCH
// =============================================================================

function setupSidebar() {
  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebarClose = document.getElementById('sidebar-close');
  const sidebarLinks = document.querySelectorAll('.sidebar-link');
  
  // Toggle sidebar on mobile
  sidebarToggle?.addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });
  
  sidebarClose?.addEventListener('click', () => {
    sidebar.classList.remove('open');
  });
  
  // Handle sidebar link clicks
  sidebarLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const sectionId = link.getAttribute('data-section');
      const section = document.getElementById(sectionId);
      
      if (section) {
        // Clear any search filter first
        clearSearchFilter();
        
        // Scroll to section
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        
        // Update active state
        sidebarLinks.forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        
        // Close sidebar on mobile
        sidebar.classList.remove('open');
        
        // Highlight section briefly
        section.classList.add('search-highlight');
        setTimeout(() => section.classList.remove('search-highlight'), 1500);
      }
    });
  });
  
  // Update active link on scroll
  const sections = document.querySelectorAll('.section[id]');
  const observerOptions = {
    rootMargin: '-20% 0px -70% 0px',
    threshold: 0
  };
  
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        sidebarLinks.forEach(link => {
          link.classList.toggle('active', link.getAttribute('data-section') === id);
        });
      }
    });
  }, observerOptions);
  
  sections.forEach(section => observer.observe(section));
}

function initializeSearchIcons() {
  // Set search icon
  const searchIcon = document.getElementById('search-icon');
  if (searchIcon && Icons.search) {
    searchIcon.innerHTML = Icons.search;
  }
  
  // Update keyboard shortcut based on OS
  const shortcutEl = document.querySelector('.search-shortcut');
  if (shortcutEl) {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    shortcutEl.textContent = isMac ? '⌘K' : 'Ctrl+K';
  }
}

function setupSearch() {
  const searchInput = document.getElementById('settings-search');
  const searchClear = document.getElementById('search-clear');
  const searchResults = document.getElementById('search-results');
  const noResultsEl = document.getElementById('search-no-results');
  const queryTextEl = document.getElementById('search-query-text');
  
  if (!searchInput) return;
  
  // Build searchable index
  const searchIndex = buildSearchIndex();
  
  let debounceTimer;
  let selectedIndex = -1;
  
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    selectedIndex = -1; // Reset selection on new input
    
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (query.length < 2) {
        hideSearchResults();
        clearSearchFilter();
        return;
      }
      
      const results = performSearch(query, searchIndex);
      displaySearchResults(results, query);
    }, 150);
    
    // Show/hide clear button
    searchClear.classList.toggle('hidden', !query);
  });
  
  searchInput.addEventListener('focus', () => {
    const query = searchInput.value.trim();
    if (query.length >= 2) {
      const results = performSearch(query, searchIndex);
      displaySearchResults(results, query);
    }
  });
  
  searchInput.addEventListener('keydown', (e) => {
    const items = searchResults.querySelectorAll('.search-result-item');
    const isResultsVisible = !searchResults.classList.contains('hidden');
    
    if (e.key === 'Escape') {
      searchInput.blur();
      hideSearchResults();
      selectedIndex = -1;
      return;
    }
    
    if (!isResultsVisible || items.length === 0) return;
    
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % items.length;
      updateSearchSelection(items, selectedIndex);
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      selectedIndex = selectedIndex <= 0 ? items.length - 1 : selectedIndex - 1;
      updateSearchSelection(items, selectedIndex);
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault();
      items[selectedIndex]?.click();
      selectedIndex = -1;
    }
  });
  
  searchClear?.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.classList.add('hidden');
    hideSearchResults();
    clearSearchFilter();
    searchInput.focus();
    selectedIndex = -1;
  });
  
  // Close results when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrapper')) {
      hideSearchResults();
      selectedIndex = -1;
    }
  });
  
  // Keyboard shortcut: Ctrl+K / Cmd+K to focus search
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      
      // Check if the search bar is visible in the viewport
      if (isElementInViewport(searchInput)) {
        searchInput.focus();
        searchInput.select();
      } else {
        // Show spotlight modal instead
        openSpotlightSearch();
      }
    }
  });
  
  // Setup spotlight search modal
  setupSpotlightSearch(searchIndex);
}

function updateSearchSelection(items, index) {
  items.forEach((item, i) => {
    item.classList.toggle('selected', i === index);
  });
  
  // Scroll selected item into view
  if (index >= 0 && items[index]) {
    items[index].scrollIntoView({ block: 'nearest' });
  }
}

function buildSearchIndex() {
  const index = [];
  const sections = document.querySelectorAll('.section[id]');
  
  sections.forEach(section => {
    const sectionId = section.id;
    const sectionTitle = section.querySelector('h2')?.textContent || '';
    const sectionDesc = section.querySelector('.section-desc')?.textContent || '';
    const keywords = section.dataset.searchKeywords || '';
    
    // Add section itself
    index.push({
      type: 'section',
      id: sectionId,
      title: sectionTitle,
      text: `${sectionTitle} ${sectionDesc} ${keywords}`.toLowerCase(),
      element: section
    });
    
    // Add individual settings within section
    section.querySelectorAll('.setting-label').forEach(label => {
      const settingRow = label.closest('.setting-row, .sub-setting');
      if (!settingRow) return;
      
      const desc = settingRow.querySelector('.setting-desc')?.textContent || '';
      
      index.push({
        type: 'setting',
        id: sectionId,
        sectionTitle: sectionTitle,
        title: label.textContent,
        text: `${label.textContent} ${desc}`.toLowerCase(),
        element: settingRow
      });
    });
    
    // Add unblock methods (method-title elements)
    section.querySelectorAll('.method-title').forEach(title => {
      const methodSetting = title.closest('.method-setting');
      if (!methodSetting) return;
      
      const desc = methodSetting.querySelector('.method-desc')?.textContent || '';
      const optionsText = methodSetting.querySelector('.method-options')?.textContent || '';
      
      index.push({
        type: 'setting',
        id: sectionId,
        sectionTitle: sectionTitle,
        title: title.textContent,
        text: `${title.textContent} ${desc} ${optionsText}`.toLowerCase(),
        element: methodSetting
      });
    });
    
    // Add option labels within method settings (customization options)
    section.querySelectorAll('.method-options .option-label').forEach(label => {
      const methodSetting = label.closest('.method-setting');
      const methodTitle = methodSetting?.querySelector('.method-title')?.textContent || sectionTitle;
      const labelText = label.textContent.replace(/:/g, '').trim().split('\n')[0];
      
      if (labelText && labelText.length > 3) {
        index.push({
          type: 'setting',
          id: sectionId,
          sectionTitle: methodTitle,
          title: labelText,
          text: labelText.toLowerCase(),
          element: label.closest('.method-options') || methodSetting
        });
      }
    });
  });
  
  return index;
}

function performSearch(query, index) {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/);
  
  const results = [];
  const seenSections = new Set();
  
  for (const item of index) {
    // Check if all query words match
    const matches = queryWords.every(word => item.text.includes(word));
    
    if (matches) {
      // Avoid duplicate sections
      if (item.type === 'section') {
        if (seenSections.has(item.id)) continue;
        seenSections.add(item.id);
      }
      
      results.push(item);
    }
  }
  
  // Sort: sections first, then settings
  results.sort((a, b) => {
    if (a.type === 'section' && b.type !== 'section') return -1;
    if (a.type !== 'section' && b.type === 'section') return 1;
    return 0;
  });
  
  return results.slice(0, 10); // Limit results
}

function displaySearchResults(results, query) {
  const searchResults = document.getElementById('search-results');
  const noResultsEl = document.getElementById('search-no-results');
  const queryTextEl = document.getElementById('search-query-text');
  const sections = document.querySelectorAll('.section[id]');
  
  if (results.length === 0) {
    searchResults.classList.add('hidden');
    noResultsEl.classList.remove('hidden');
    queryTextEl.textContent = query;
    
    // Hide all sections
    sections.forEach(s => s.classList.add('search-hidden'));
    return;
  }
  
  noResultsEl.classList.add('hidden');
  
  // Get matching section IDs
  const matchingSectionIds = new Set(results.map(r => r.id));
  
  // Show/hide sections based on search
  sections.forEach(section => {
    section.classList.toggle('search-hidden', !matchingSectionIds.has(section.id));
  });
  
  // Build results dropdown with tree-style hierarchy
  searchResults.innerHTML = results.map(result => {
    const highlightedTitle = highlightMatch(result.title, query);
    const isSection = result.type === 'section';
    
    return `
      <div class="search-result-item ${isSection ? 'is-section' : 'is-setting'}" data-section-id="${result.id}">
        <div class="search-result-content">
          ${!isSection ? `<span class="search-result-parent">${escapeHtml(result.sectionTitle)}</span>` : ''}
          <div class="search-result-title">${highlightedTitle}</div>
        </div>
      </div>
    `;
  }).join('');
  
  searchResults.classList.remove('hidden');
  
  // Handle result clicks
  searchResults.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', () => {
      const sectionId = item.dataset.sectionId;
      const section = document.getElementById(sectionId);
      
      if (section) {
        hideSearchResults();
        clearSearchFilter();
        
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        section.classList.add('search-highlight');
        setTimeout(() => section.classList.remove('search-highlight'), 1500);
        
        // Update sidebar active state
        document.querySelectorAll('.sidebar-link').forEach(link => {
          link.classList.toggle('active', link.getAttribute('data-section') === sectionId);
        });
      }
    });
  });
}

function highlightMatch(text, query) {
  const escaped = escapeHtml(text);
  const queryWords = query.toLowerCase().split(/\s+/);
  
  let result = escaped;
  queryWords.forEach(word => {
    const regex = new RegExp(`(${escapeRegex(word)})`, 'gi');
    result = result.replace(regex, '<mark>$1</mark>');
  });
  
  return result;
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hideSearchResults() {
  const searchResults = document.getElementById('search-results');
  const noResultsEl = document.getElementById('search-no-results');
  
  searchResults?.classList.add('hidden');
  noResultsEl?.classList.add('hidden');
}

function clearSearchFilter() {
  const sections = document.querySelectorAll('.section[id]');
  const searchInput = document.getElementById('settings-search');
  const searchClear = document.getElementById('search-clear');
  const noResultsEl = document.getElementById('search-no-results');
  
  // Show all sections
  sections.forEach(section => {
    section.classList.remove('search-hidden');
  });
  
  noResultsEl?.classList.add('hidden');
  
  // Handle blocklist/allowlist visibility based on mode
  const mode = document.querySelector('input[name="mode"]:checked')?.value || 'blocklist';
  updateModeDisplay(mode);
}

// =============================================================================
// SPOTLIGHT SEARCH
// =============================================================================

function isElementInViewport(el) {
  const rect = el.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}

let spotlightSearchIndex = null;

function openSpotlightSearch() {
  const modal = document.getElementById('spotlight-modal');
  const input = document.getElementById('spotlight-input');
  
  if (!modal || !input) return;
  
  modal.classList.remove('hidden');
  
  // Focus input after animation starts
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

function closeSpotlightSearch() {
  const modal = document.getElementById('spotlight-modal');
  const input = document.getElementById('spotlight-input');
  const results = document.getElementById('spotlight-results');
  const noResults = document.getElementById('spotlight-no-results');
  
  if (!modal) return;
  
  modal.classList.add('hidden');
  
  // Clear state
  if (input) input.value = '';
  if (results) results.innerHTML = '';
  if (noResults) noResults.classList.add('hidden');
}

function setupSpotlightSearch(searchIndex) {
  spotlightSearchIndex = searchIndex;
  
  const modal = document.getElementById('spotlight-modal');
  const backdrop = modal?.querySelector('.spotlight-backdrop');
  const input = document.getElementById('spotlight-input');
  const resultsContainer = document.getElementById('spotlight-results');
  const noResultsEl = document.getElementById('spotlight-no-results');
  const queryTextEl = document.getElementById('spotlight-query-text');
  const spotlightIcon = document.getElementById('spotlight-icon');
  
  if (!modal || !input) return;
  
  // Set search icon
  if (spotlightIcon && Icons.search) {
    spotlightIcon.innerHTML = Icons.search;
  }
  
  let selectedIndex = -1;
  let debounceTimer;
  
  // Close on backdrop click
  backdrop?.addEventListener('click', closeSpotlightSearch);
  
  // Handle input
  input.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    selectedIndex = -1;
    
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (query.length < 2) {
        resultsContainer.innerHTML = '';
        noResultsEl.classList.add('hidden');
        return;
      }
      
      const results = performSearch(query, spotlightSearchIndex);
      displaySpotlightResults(results, query);
    }, 100);
  });
  
  // Handle keyboard navigation
  input.addEventListener('keydown', (e) => {
    const items = resultsContainer.querySelectorAll('.spotlight-result-item');
    
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSpotlightSearch();
      return;
    }
    
    if (!items.length) return;
    
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % items.length;
      updateSpotlightSelection(items, selectedIndex);
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      selectedIndex = selectedIndex <= 0 ? items.length - 1 : selectedIndex - 1;
      updateSpotlightSelection(items, selectedIndex);
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault();
      items[selectedIndex]?.click();
    }
  });
  
  // Close on Escape key anywhere
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeSpotlightSearch();
    }
  });
}

function updateSpotlightSelection(items, index) {
  items.forEach((item, i) => {
    item.classList.toggle('selected', i === index);
  });
  
  if (index >= 0 && items[index]) {
    items[index].scrollIntoView({ block: 'nearest' });
  }
}

function displaySpotlightResults(results, query) {
  const resultsContainer = document.getElementById('spotlight-results');
  const noResultsEl = document.getElementById('spotlight-no-results');
  const queryTextEl = document.getElementById('spotlight-query-text');
  
  if (results.length === 0) {
    resultsContainer.innerHTML = '';
    noResultsEl.classList.remove('hidden');
    queryTextEl.textContent = query;
    return;
  }
  
  noResultsEl.classList.add('hidden');
  
  // Build results
  resultsContainer.innerHTML = results.map((result, index) => {
    const highlightedTitle = highlightMatch(result.title, query);
    const isSection = result.type === 'section';
    
    return `
      <div class="spotlight-result-item" data-section-id="${result.id}" data-index="${index}">
        <div class="spotlight-result-content">
          ${!isSection ? `<span class="spotlight-result-parent">${escapeHtml(result.sectionTitle)}</span>` : ''}
          <div class="spotlight-result-title">${highlightedTitle}</div>
        </div>
        <span class="spotlight-result-hint">↵</span>
      </div>
    `;
  }).join('');
  
  // Handle result clicks
  resultsContainer.querySelectorAll('.spotlight-result-item').forEach(item => {
    item.addEventListener('click', () => {
      const sectionId = item.dataset.sectionId;
      const section = document.getElementById(sectionId);
      
      if (section) {
        closeSpotlightSearch();
        clearSearchFilter();
        
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        section.classList.add('search-highlight');
        setTimeout(() => section.classList.remove('search-highlight'), 1500);
        
        // Update sidebar active state
        document.querySelectorAll('.sidebar-link').forEach(link => {
          link.classList.toggle('active', link.getAttribute('href') === `#${sectionId}`);
        });
      }
    });
  });
}

// =============================================================================
// THEME
// =============================================================================

async function loadTheme() {
  try {
    const result = await chrome.storage.local.get('theme');
    let theme = result.theme;
    
    // If no theme is saved, default to light
    if (!theme) {
      theme = 'light';
      await chrome.storage.local.set({ theme: 'light' });
    }
    
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    console.error('Failed to load theme:', e);
  }
}

function setupThemeToggle() {
  const toggle = document.getElementById('theme-toggle');
  toggle.addEventListener('click', async () => {
    const root = document.documentElement;
    const currentTheme = root.getAttribute('data-theme') || 'light';
    
    // Simple toggle between light and dark
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    root.setAttribute('data-theme', newTheme);
    
    // Save to chrome.storage
    try {
      await chrome.storage.local.set({ theme: newTheme });
    } catch (e) {
      console.error('Failed to save theme:', e);
    }
  });
}

// =============================================================================
// DATA BACKUP
// =============================================================================

function setupBackupButtons() {
  const exportBtn = document.getElementById('export-data-btn');
  const importBtn = document.getElementById('import-data-btn');
  const importInput = document.getElementById('import-file-input');
  
  // Set icons
  const exportIcon = document.getElementById('export-icon');
  const importIcon = document.getElementById('import-icon');
  if (exportIcon && Icons.download) {
    exportIcon.innerHTML = Icons.download || '';
  }
  if (importIcon && Icons.upload) {
    importIcon.innerHTML = Icons.upload || '';
  }
  
  // Export handler
  exportBtn?.addEventListener('click', async () => {
    try {
      exportBtn.disabled = true;
      exportBtn.textContent = 'Exporting...';
      
      const result = await chrome.runtime.sendMessage({ type: 'EXPORT_ALL_DATA' });
      
      if (result.success) {
        // Create and download the file
        const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `focus-settings-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showBackupStatus('Settings exported successfully!');
      } else {
        showBackupStatus('Export failed: ' + result.error, true);
      }
    } catch (e) {
      showBackupStatus('Export failed: ' + e.message, true);
    } finally {
      exportBtn.disabled = false;
      exportBtn.innerHTML = `<span class="btn-icon-inline" id="export-icon">${Icons.download || ''}</span> Export Settings`;
    }
  });
  
  // Import handler - trigger file input
  importBtn?.addEventListener('click', () => {
    importInput?.click();
  });
  
  // File selected handler
  importInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    try {
      importBtn.disabled = true;
      importBtn.textContent = 'Importing...';
      
      const text = await file.text();
      const data = JSON.parse(text);
      
      // Confirm before importing
      if (!confirm('This will replace your current settings with the imported data. Continue?')) {
        return;
      }
      
      const result = await chrome.runtime.sendMessage({ type: 'IMPORT_ALL_DATA', data });
      
      if (result.success) {
        showBackupStatus('Settings imported successfully! Reloading...');
        // Reload the page to show imported settings
        setTimeout(() => location.reload(), 1500);
      } else {
        showBackupStatus('Import failed: ' + result.error, true);
      }
    } catch (e) {
      showBackupStatus('Import failed: Invalid file format', true);
    } finally {
      importBtn.disabled = false;
      importBtn.innerHTML = `<span class="btn-icon-inline" id="import-icon">${Icons.upload || ''}</span> Import Settings`;
      importInput.value = ''; // Reset file input
    }
  });
}

function showBackupStatus(message, isError = false) {
  // Create or reuse status element
  let statusEl = document.querySelector('.backup-status');
  if (!statusEl) {
    statusEl = document.createElement('div');
    statusEl.className = 'backup-status';
    document.querySelector('.backup-actions')?.appendChild(statusEl);
  }
  
  statusEl.textContent = message;
  statusEl.className = `backup-status ${isError ? 'error' : 'success'}`;
  
  // Clear after 3 seconds
  setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className = 'backup-status';
  }, 3000);
}

// =============================================================================
// AUTH STATUS
// =============================================================================

async function checkAuthStatus() {
  const isAuthenticated = await todoist.isAuthenticated();
  
  if (isAuthenticated) {
    document.getElementById('not-connected').style.display = 'none';
    document.getElementById('connected').style.display = 'flex';
  } else {
    document.getElementById('not-connected').style.display = 'flex';
    document.getElementById('connected').style.display = 'none';
  }
}

// =============================================================================
// SETTINGS
// =============================================================================

function populateSettings() {
  // Blocking mode
  const modeRadio = document.querySelector(`input[name="mode"][value="${settings.mode}"]`);
  if (modeRadio) modeRadio.checked = true;
  
  // Show/hide site lists based on mode
  updateModeDisplay(settings.mode);
  
  // Populate blocked sites (respects search filter in input)
  renderBlockedSitesList();
  
  // Populate allowed sites
  renderSiteList('allowed-sites-list', settings.allowedSites, 'allowed');
  
  // Unblock methods
  const methods = settings.unblockMethods;
  
  // Update profile indicator for unblock methods section
  updateUnblockProfileIndicator();
  
  // Require mode
  document.getElementById('require-mode').value = settings.requireAllMethods ? 'all' : 'any';
  
  // Allow unlimited time
  document.getElementById('allow-unlimited').checked = settings.allowUnlimitedTime || false;
  
  // Inactivity timeout
  document.getElementById('inactivity-timeout').value = settings.inactivityTimeout ?? 5;
  
  // Daily limit
  const dailyLimit = settings.dailyLimit || { enabled: false, minutes: 30 };
  document.getElementById('daily-limit-enabled').checked = dailyLimit.enabled;
  document.getElementById('daily-limit-minutes').value = dailyLimit.minutes;
  updateDailyLimitOptions();
  loadDailyUsage();
  
  // Earned time
  const earnedTime = settings.earnedTime || { enabled: false, minutesPerTask: 5, maxBankMinutes: 60, requireTasksToUnlock: false };
  document.getElementById('earned-time-enabled').checked = earnedTime.enabled;
  document.getElementById('earned-time-per-task').value = earnedTime.minutesPerTask || 5;
  document.getElementById('earned-time-max-bank').value = earnedTime.maxBankMinutes || 60;
  document.getElementById('earned-time-required').checked = earnedTime.requireTasksToUnlock || false;
  updateEarnedTimeOptions();
  loadEarnedTimeBank();
  
  // Timer
  document.getElementById('timer-enabled').checked = methods.timer.enabled;
  document.getElementById('timer-minutes').value = methods.timer.minutes;
  updateMethodOptions('timer');
  
  // Complete todo
  document.getElementById('todo-enabled').checked = methods.completeTodo.enabled;
  
  // Type phrase
  document.getElementById('phrase-enabled').checked = methods.typePhrase.enabled;
  document.getElementById('phrase-text').value = methods.typePhrase.phrase;
  document.getElementById('phrase-use-random').checked = methods.typePhrase.useRandomString || false;
  document.getElementById('phrase-random-length').value = methods.typePhrase.randomLength || 30;
  updateMethodOptions('phrase');
  updatePhraseMode();
  
  // Math problem
  document.getElementById('math-enabled').checked = methods.mathProblem.enabled;
  
  // Password
  document.getElementById('password-enabled').checked = methods.password.enabled;
  document.getElementById('password-value').value = methods.password.value;
  updateMethodOptions('password');
  
  // Type Reason
  const typeReason = methods.typeReason || { enabled: false, minLength: 50 };
  document.getElementById('reason-enabled').checked = typeReason.enabled;
  document.getElementById('reason-min-length').value = typeReason.minLength || 50;
  updateMethodOptions('reason');
  
  // Load reason history
  loadReasonHistory();
  
  // Privacy settings - History Analysis
  const historyAnalysisToggle = document.getElementById('history-analysis-enabled');
  if (historyAnalysisToggle) {
    historyAnalysisToggle.checked = settings.historyAnalysisEnabled !== false; // Default to true
  }
  
  // Focus session presets
  populateFocusPresets();
  
  // Schedule
  populateSchedule();
}

function updateModeDisplay(mode) {
  const blocklistSection = document.getElementById('section-blocked-sites');
  const allowlistSection = document.getElementById('section-allowed-sites');
  const blockedSitesLink = document.querySelector('.sidebar-link[data-section="section-blocked-sites"]');
  const allowedSitesLink = document.querySelector('.sidebar-link[data-section="section-allowed-sites"]');
  
  if (mode === 'blocklist') {
    blocklistSection.style.display = 'block';
    allowlistSection.style.display = 'none';
    blockedSitesLink?.classList.remove('hidden');
    allowedSitesLink?.classList.add('hidden');
  } else {
    blocklistSection.style.display = 'none';
    allowlistSection.style.display = 'block';
    blockedSitesLink?.classList.add('hidden');
    allowedSitesLink?.classList.remove('hidden');
  }
}

async function updateUnblockProfileIndicator() {
  const indicator = document.getElementById('unblock-profile-indicator');
  if (!indicator) return;
  
  try {
    const profiles = await chrome.runtime.sendMessage({ type: 'GET_PROFILES' });
    const activeProfileId = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_PROFILE_ID' });
    
    if (!profiles || profiles.length === 0) {
      indicator.textContent = '';
      return;
    }
    
    const activeProfile = profiles.find(p => p.id === activeProfileId) || profiles[0];
    if (activeProfile) {
      const icon = getIcon(activeProfile.icon) || '';
      indicator.innerHTML = `Editing: ${icon} ${escapeHtml(activeProfile.name)}`;
      indicator.style.setProperty('--profile-color', activeProfile.color || '#6366f1');
    }
  } catch (e) {
    console.error('Failed to update profile indicator:', e);
    indicator.textContent = '';
  }
}

function updateMethodOptions(method) {
  const optionsEl = document.getElementById(`${method}-options`);
  if (!optionsEl) return;
  
  const checkbox = document.getElementById(`${method}-enabled`);
  if (checkbox && checkbox.checked) {
    optionsEl.classList.remove('hidden');
  } else {
    optionsEl.classList.add('hidden');
  }
}

function updateDailyLimitOptions() {
  const optionsEl = document.getElementById('daily-limit-options');
  const checkbox = document.getElementById('daily-limit-enabled');
  
  if (checkbox && checkbox.checked) {
    optionsEl.classList.remove('hidden');
  } else {
    optionsEl.classList.add('hidden');
  }
}

async function loadDailyUsage() {
  const result = await chrome.storage.local.get('dailyUsage');
  const usage = result.dailyUsage || { date: '', minutes: 0 };
  
  // Check if usage is from today
  const today = new Date().toDateString();
  const usedMinutes = usage.date === today ? Math.round(usage.minutes) : 0;
  const limitMinutes = settings.dailyLimit?.minutes || 30;
  
  document.getElementById('daily-usage-time').textContent = `${usedMinutes} min`;
  document.getElementById('daily-usage-limit').textContent = limitMinutes;
  
  // Update progress bar
  const percentage = Math.min((usedMinutes / limitMinutes) * 100, 100);
  const fillEl = document.getElementById('daily-usage-fill');
  if (fillEl) {
    fillEl.style.width = `${percentage}%`;
    fillEl.classList.remove('warning', 'danger');
    if (percentage >= 90) {
      fillEl.classList.add('danger');
    } else if (percentage >= 70) {
      fillEl.classList.add('warning');
    }
  }
}

function updateEarnedTimeOptions() {
  const optionsEl = document.getElementById('earned-time-options');
  const checkbox = document.getElementById('earned-time-enabled');
  
  if (checkbox && checkbox.checked) {
    optionsEl.classList.remove('hidden');
  } else {
    optionsEl.classList.add('hidden');
  }
}

async function loadEarnedTimeBank() {
  const result = await chrome.runtime.sendMessage({ type: 'GET_EARNED_TIME' });
  
  if (result) {
    document.getElementById('earned-time-bank').textContent = `${result.minutes} min`;
    document.getElementById('earned-time-tasks').textContent = `${result.tasksCompleted} tasks completed`;
    
    // Update stats if the details section exists
    const totalEarnedEl = document.getElementById('earned-time-total-earned');
    const totalUsedEl = document.getElementById('earned-time-total-used');
    const efficiencyEl = document.getElementById('earned-time-efficiency');
    
    if (totalEarnedEl) {
      totalEarnedEl.textContent = result.totalEarned || 0;
    }
    
    if (totalUsedEl) {
      totalUsedEl.textContent = result.totalUsed || 0;
    }
    
    if (efficiencyEl) {
      // Calculate efficiency (time used vs time earned)
      const totalEarned = result.totalEarned || 0;
      const totalUsed = result.totalUsed || 0;
      
      if (totalEarned > 0) {
        const efficiency = Math.round((totalUsed / totalEarned) * 100);
        efficiencyEl.textContent = `${efficiency}%`;
      } else {
        efficiencyEl.textContent = '-';
      }
    }
  }
}

async function resetEarnedTimeBank() {
  await chrome.runtime.sendMessage({ type: 'RESET_EARNED_TIME' });
  loadEarnedTimeBank();
}

function updatePhraseMode() {
  const useRandom = document.getElementById('phrase-use-random').checked;
  const customOptions = document.getElementById('phrase-custom-options');
  const randomOptions = document.getElementById('phrase-random-options');
  
  if (useRandom) {
    customOptions.classList.add('hidden');
    randomOptions.classList.remove('hidden');
  } else {
    customOptions.classList.remove('hidden');
    randomOptions.classList.add('hidden');
  }
}

function renderSiteList(listId, sites, type) {
  const list = document.getElementById(listId);
  list.innerHTML = '';
  
  if (sites.length === 0) {
    list.innerHTML = `<li class="empty-list">No sites added yet</li>`;
    return;
  }
  
  sites.forEach(site => {
    const li = document.createElement('li');
    li.className = 'site-item';
    li.innerHTML = `
      <span class="site-name">${escapeHtml(site)}</span>
      <button class="site-remove" data-site="${escapeHtml(site)}" data-type="${type}" title="Remove">&times;</button>
    `;
    list.appendChild(li);
  });
}

/** Returns the current blocked-sites search/filter query (trimmed). */
function getBlockedSitesFilter() {
  const input = document.getElementById('blocked-site-input');
  return input ? input.value.trim().toLowerCase() : '';
}

/** Renders the blocked sites list, filtered by the search input when present. */
function renderBlockedSitesList() {
  const query = getBlockedSitesFilter();
  const filtered = query
    ? settings.blockedSites.filter(site => site.toLowerCase().includes(query))
    : [...settings.blockedSites];
  renderSiteList('blocked-sites-list', filtered, 'blocked');
  if (filtered.length === 0 && query) {
    const listEl = document.getElementById('blocked-sites-list');
    const emptyLi = listEl.querySelector('.empty-list');
    if (emptyLi) {
      emptyLi.textContent = `No blocked sites match "${escapeHtml(query)}"`;
    }
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// =============================================================================
// EVENT LISTENERS
// =============================================================================

function setupEventListeners() {
  // Connect Todoist
  document.getElementById('connect-btn').addEventListener('click', async () => {
    try {
      await todoist.authenticate();
      await checkAuthStatus();
      showSaveStatus('Connected to Todoist!');
    } catch (error) {
      showSaveStatus('Connection failed: ' + error.message, true);
    }
  });
  
  // Disconnect Todoist
  document.getElementById('disconnect-btn').addEventListener('click', async () => {
    await todoist.logout();
    await checkAuthStatus();
    showSaveStatus('Disconnected from Todoist');
  });
  
  // Mode change
  document.querySelectorAll('input[name="mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      settings.mode = e.target.value;
      updateModeDisplay(settings.mode);
    });
  });
  
  // Add blocked site
  document.getElementById('add-blocked-btn').addEventListener('click', () => {
    const input = document.getElementById('blocked-site-input');
    const site = extractDomain(input.value.trim());
    
    if (site && !settings.blockedSites.includes(site)) {
      settings.blockedSites.push(site);
      renderBlockedSitesList();
      input.value = '';
      markAsChanged();
    }
  });
  
  // Blocked site input: filter list as user types (search), add on Enter
  const blockedSiteInput = document.getElementById('blocked-site-input');
  blockedSiteInput.addEventListener('input', () => renderBlockedSitesList());
  blockedSiteInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('add-blocked-btn').click();
    }
  });
  
  // Add allowed site
  document.getElementById('add-allowed-btn').addEventListener('click', () => {
    const input = document.getElementById('allowed-site-input');
    const site = extractDomain(input.value.trim());
    
    if (site && !settings.allowedSites.includes(site)) {
      settings.allowedSites.push(site);
      renderSiteList('allowed-sites-list', settings.allowedSites, 'allowed');
      input.value = '';
      markAsChanged();
    }
  });
  
  // Add allowed site on Enter
  document.getElementById('allowed-site-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('add-allowed-btn').click();
    }
  });
  
  // Remove site (delegated)
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('site-remove')) {
      const site = e.target.dataset.site;
      const type = e.target.dataset.type;
      
      if (type === 'blocked') {
        settings.blockedSites = settings.blockedSites.filter(s => s !== site);
        renderBlockedSitesList();
      } else {
        settings.allowedSites = settings.allowedSites.filter(s => s !== site);
        renderSiteList('allowed-sites-list', settings.allowedSites, 'allowed');
      }
      markAsChanged();
    }
  });
  
  // Method toggles
  ['timer', 'todo', 'phrase', 'math', 'password', 'reason'].forEach(method => {
    const checkbox = document.getElementById(`${method}-enabled`);
    if (checkbox) {
      checkbox.addEventListener('change', () => {
        updateMethodOptions(method);
      });
    }
  });
  
  // Phrase mode toggle (custom vs random)
  document.getElementById('phrase-use-random').addEventListener('change', updatePhraseMode);
  
  // Daily limit toggle
  document.getElementById('daily-limit-enabled').addEventListener('change', updateDailyLimitOptions);
  
  // Earned time toggle
  document.getElementById('earned-time-enabled').addEventListener('change', updateEarnedTimeOptions);
  
  // Reset earned time
  document.getElementById('reset-earned-time').addEventListener('click', resetEarnedTimeBank);
  
  // Update limit display when minutes change
  document.getElementById('daily-limit-minutes').addEventListener('change', (e) => {
    document.getElementById('daily-usage-limit').textContent = e.target.value;
    loadDailyUsage(); // Refresh the progress bar
  });
  
  // Show password toggle
  document.getElementById('show-password').addEventListener('change', (e) => {
    const passwordInput = document.getElementById('password-value');
    passwordInput.type = e.target.checked ? 'text' : 'password';
  });
  
  // Clear reason history
  document.getElementById('clear-reasons').addEventListener('click', clearReasonHistory);
  
  // Save button
  document.getElementById('save-btn').addEventListener('click', saveSettings);
}

// =============================================================================
// SAVE SETTINGS
// =============================================================================

async function saveSettings() {
  // Show saving state
  const saveBtn = document.getElementById('save-btn');
  saveBtn.classList.add('saving');
  
  // Gather all settings
  settings.mode = document.querySelector('input[name="mode"]:checked').value;
  settings.requireAllMethods = document.getElementById('require-mode').value === 'all';
  settings.allowUnlimitedTime = document.getElementById('allow-unlimited').checked;
  settings.inactivityTimeout = parseInt(document.getElementById('inactivity-timeout').value, 10) || 0;
  
  // Daily limit settings
  settings.dailyLimit = {
    enabled: document.getElementById('daily-limit-enabled').checked,
    minutes: parseInt(document.getElementById('daily-limit-minutes').value, 10) || 30
  };
  
  // Earned time settings
  settings.earnedTime = {
    enabled: document.getElementById('earned-time-enabled').checked,
    minutesPerTask: parseInt(document.getElementById('earned-time-per-task').value, 10) || 5,
    maxBankMinutes: parseInt(document.getElementById('earned-time-max-bank').value, 10) || 60,
    requireTasksToUnlock: document.getElementById('earned-time-required').checked
  };
  
  // Schedule settings
  const activeDays = [];
  document.querySelectorAll('.schedule-day:checked').forEach(checkbox => {
    activeDays.push(parseInt(checkbox.value, 10));
  });
  
  settings.schedule = {
    enabled: document.getElementById('schedule-enabled').checked,
    allowedTimes: settings.schedule?.allowedTimes || [],
    activeDays: activeDays
  };
  
  // Unblock methods
  settings.unblockMethods = {
    timer: {
      enabled: document.getElementById('timer-enabled').checked,
      minutes: parseInt(document.getElementById('timer-minutes').value, 10) || 5
    },
    completeTodo: {
      enabled: document.getElementById('todo-enabled').checked
    },
    typePhrase: {
      enabled: document.getElementById('phrase-enabled').checked,
      phrase: document.getElementById('phrase-text').value || 'I want to waste my time',
      useRandomString: document.getElementById('phrase-use-random').checked,
      randomLength: parseInt(document.getElementById('phrase-random-length').value, 10) || 30
    },
    typeReason: {
      enabled: document.getElementById('reason-enabled').checked,
      minLength: parseInt(document.getElementById('reason-min-length').value, 10) || 50
    },
    mathProblem: {
      enabled: document.getElementById('math-enabled').checked
    },
    password: {
      enabled: document.getElementById('password-enabled').checked,
      value: document.getElementById('password-value').value
    }
  };
  
  // Validate timer minutes
  if (settings.unblockMethods.timer.minutes < 1) {
    settings.unblockMethods.timer.minutes = 1;
  }
  if (settings.unblockMethods.timer.minutes > 60) {
    settings.unblockMethods.timer.minutes = 60;
  }
  
  // Privacy settings
  const historyAnalysisToggle = document.getElementById('history-analysis-enabled');
  if (historyAnalysisToggle) {
    settings.historyAnalysisEnabled = historyAnalysisToggle.checked;
  }
  
  // Focus session presets
  settings.focusPresets = gatherFocusPresets();
  
  // Save to storage via background
  try {
    await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      settings: settings
    });
    
    // Save calendar selections if they changed
    const currentCalendarIds = getSelectedCalendarIds();
    if (JSON.stringify(currentCalendarIds) !== JSON.stringify([...originalSelectedCalendars].sort())) {
      await chrome.runtime.sendMessage({
        type: 'UPDATE_CALENDAR_SETTINGS',
        settings: { selectedCalendars: currentCalendarIds }
      });
      originalSelectedCalendars = [...currentCalendarIds];
      await loadTodayEvents();
    }
    
    // Reset unsaved changes tracking
    hasUnsavedChanges = false;
    originalSettingsJson = JSON.stringify(gatherCurrentSettings());
    
    // Show success animation
    showSaveSuccess();
  } catch (error) {
    showSaveStatus('Failed to save: ' + error.message, true);
    resetSaveButton();
  }
}

function showSaveSuccess() {
  const saveBtn = document.getElementById('save-btn');
  
  // Trigger saved state with checkmark animation
  saveBtn.classList.remove('saving');
  saveBtn.classList.add('saved');
  
  // Hide save bar after animation completes (timings aligned with CSS: icon + checkmark ~0.5s)
  setTimeout(() => {
    hideSaveBar();
    // Reset button state after bar transition
    setTimeout(() => {
      saveBtn.classList.remove('saved');
    }, 200);
  }, 550);
}

function resetSaveButton() {
  const saveBtn = document.getElementById('save-btn');
  saveBtn.classList.remove('saving', 'saved');
}

function showSaveStatus(message, isError = false) {
  const statusEl = document.getElementById('save-status');
  if (!statusEl) return;
  
  statusEl.textContent = message;
  statusEl.className = isError ? 'save-status error' : 'save-status';
  
  // Clear after 3 seconds
  setTimeout(() => {
    statusEl.textContent = '';
  }, 3000);
}

// =============================================================================
// FOCUS SESSION PRESETS
// =============================================================================

const PRESET_FIELDS = {
  pomodoro: { work: 'preset-pomodoro-work', break: 'preset-pomodoro-break', longBreak: 'preset-pomodoro-long-break', sessions: 'preset-pomodoro-sessions' },
  short:    { work: 'preset-short-work',    break: 'preset-short-break',    longBreak: 'preset-short-long-break',    sessions: 'preset-short-sessions' },
  long:     { work: 'preset-long-work',     break: 'preset-long-break',     longBreak: 'preset-long-long-break',     sessions: 'preset-long-sessions' }
};

function populateFocusPresets() {
  const presets = settings.focusPresets || {};
  
  for (const [type, fields] of Object.entries(PRESET_FIELDS)) {
    const preset = presets[type];
    if (!preset) continue;
    
    const workEl = document.getElementById(fields.work);
    const breakEl = document.getElementById(fields.break);
    const longBreakEl = document.getElementById(fields.longBreak);
    const sessionsEl = document.getElementById(fields.sessions);
    
    if (workEl) workEl.value = preset.workMinutes;
    if (breakEl) breakEl.value = preset.breakMinutes;
    if (longBreakEl) longBreakEl.value = preset.longBreakMinutes;
    if (sessionsEl) sessionsEl.value = preset.sessionsBeforeLongBreak;
  }
  
  // Update the icon numbers on the cards to reflect custom work minutes
  updatePresetCardIcons();
  
  // Setup change listeners
  setupFocusPresetListeners();
}

function updatePresetCardIcons() {
  const cards = document.querySelectorAll('.preset-card');
  const types = ['pomodoro', 'short', 'long'];
  
  cards.forEach((card, i) => {
    const type = types[i];
    const fields = PRESET_FIELDS[type];
    if (fields) {
      const workEl = document.getElementById(fields.work);
      const icon = card.querySelector('.preset-card-icon');
      if (icon && workEl) icon.textContent = workEl.value;
    }
  });
}

function setupFocusPresetListeners() {
  for (const [type, fields] of Object.entries(PRESET_FIELDS)) {
    for (const fieldId of Object.values(fields)) {
      const el = document.getElementById(fieldId);
      if (!el) continue;
      
      el.addEventListener('change', () => {
        settings.focusPresets = gatherFocusPresets();
        updateSaveBarVisibility();
      });
      el.addEventListener('input', () => {
        updatePresetCardIcons();
      });
    }
  }
}

function gatherFocusPresets() {
  const presets = {};
  
  for (const [type, fields] of Object.entries(PRESET_FIELDS)) {
    presets[type] = {
      workMinutes:            parseInt(document.getElementById(fields.work).value) || 25,
      breakMinutes:           parseInt(document.getElementById(fields.break).value) || 5,
      longBreakMinutes:       parseInt(document.getElementById(fields.longBreak).value) || 15,
      sessionsBeforeLongBreak: parseInt(document.getElementById(fields.sessions).value) || 4
    };
  }
  
  return presets;
}

// =============================================================================
// SCHEDULE
// =============================================================================

function populateSchedule() {
  const schedule = settings.schedule || {
    enabled: false,
    allowedTimes: [
      { start: '07:00', end: '09:00' },
      { start: '12:00', end: '13:00' }
    ],
    activeDays: [1, 2, 3, 4, 5]
  };
  
  // Schedule enabled toggle
  document.getElementById('schedule-enabled').checked = schedule.enabled;
  updateScheduleOptions();
  
  // Active days
  document.querySelectorAll('.schedule-day').forEach(checkbox => {
    const day = parseInt(checkbox.value, 10);
    checkbox.checked = schedule.activeDays.includes(day);
  });
  
  // Time windows
  renderTimeWindows(schedule.allowedTimes);
}

function updateScheduleOptions() {
  const optionsEl = document.getElementById('schedule-options');
  const checkbox = document.getElementById('schedule-enabled');
  
  if (checkbox.checked) {
    optionsEl.classList.remove('hidden');
  } else {
    optionsEl.classList.add('hidden');
  }
}

function renderTimeWindows(timeWindows) {
  const list = document.getElementById('time-windows-list');
  list.innerHTML = '';
  
  if (timeWindows.length === 0) {
    list.innerHTML = `
      <div class="time-windows-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
        <span>No time windows added. Sites will be blocked all day.</span>
      </div>`;
    return;
  }
  
  timeWindows.forEach((window, index) => {
    const item = document.createElement('div');
    item.className = 'time-window';
    item.dataset.index = index;
    item.innerHTML = `
      <input type="time" class="time-start" value="${window.start}">
      <span class="time-window-separator">to</span>
      <input type="time" class="time-end" value="${window.end}">
      <button type="button" class="time-window-remove" title="Remove">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    `;
    list.appendChild(item);
  });
}

function addTimeWindow() {
  // Ensure schedule exists
  if (!settings.schedule) {
    settings.schedule = {
      enabled: false,
      allowedTimes: [],
      activeDays: [1, 2, 3, 4, 5]
    };
  }
  
  // Add a new time window with default values
  settings.schedule.allowedTimes.push({ start: '09:00', end: '17:00' });
  renderTimeWindows(settings.schedule.allowedTimes);
}

function removeTimeWindow(index) {
  if (settings.schedule && settings.schedule.allowedTimes) {
    settings.schedule.allowedTimes.splice(index, 1);
    renderTimeWindows(settings.schedule.allowedTimes);
  }
}

function updateTimeWindow(index, field, value) {
  if (settings.schedule && settings.schedule.allowedTimes && settings.schedule.allowedTimes[index]) {
    settings.schedule.allowedTimes[index][field] = value;
  }
}

function setupScheduleListeners() {
  // Schedule enabled toggle
  document.getElementById('schedule-enabled').addEventListener('change', updateScheduleOptions);
  
  // Add time window button
  document.getElementById('add-time-window').addEventListener('click', addTimeWindow);
  
  // Delegated event listeners for time windows
  document.getElementById('time-windows-list').addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.time-window-remove');
    if (removeBtn) {
      const item = removeBtn.closest('.time-window');
      if (item) {
        removeTimeWindow(parseInt(item.dataset.index, 10));
      }
    }
  });
  
  document.getElementById('time-windows-list').addEventListener('change', (e) => {
    const item = e.target.closest('.time-window');
    if (!item) return;
    
    const index = parseInt(item.dataset.index, 10);
    
    if (e.target.classList.contains('time-start')) {
      updateTimeWindow(index, 'start', e.target.value);
    } else if (e.target.classList.contains('time-end')) {
      updateTimeWindow(index, 'end', e.target.value);
    }
  });
}

// =============================================================================
// UNSAVED CHANGES WARNING
// =============================================================================

function setupUnsavedChangesWarning() {
  // Add beforeunload listener that checks for actual changes
  window.addEventListener('beforeunload', (e) => {
    // Only show warning if there are actual unsaved changes
    if (checkForChanges()) {
      e.preventDefault();
      // Modern browsers ignore custom messages, but we need to return something
      e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
      return e.returnValue;
    }
  });

  // Track changes on all form inputs (excluding "add item" inputs)
  const form = document.querySelector('.container');
  
  // Inputs that are used for adding items, not for settings
  const addItemInputIds = [
    'blocked-site-input',
    'allowed-site-input',
    'category-site-input',
    'profile-site-input',
    'settings-search'
  ];
  
  function shouldIgnoreInput(target) {
    // Ignore inputs used for adding items (not actual settings)
    if (addItemInputIds.includes(target.id)) {
      return true;
    }
    // Also ignore inputs inside search wrappers
    if (target.closest('.search-wrapper')) {
      return true;
    }
    return false;
  }
  
  form.addEventListener('input', (e) => {
    if (!shouldIgnoreInput(e.target)) {
      updateSaveBarVisibility();
    }
  });
  form.addEventListener('change', (e) => {
    if (!shouldIgnoreInput(e.target)) {
      updateSaveBarVisibility();
    }
  });
}

function updateSaveBarVisibility() {
  if (checkForChanges()) {
    hasUnsavedChanges = true;
    showSaveBar();
  } else {
    hasUnsavedChanges = false;
    hideSaveBar();
  }
}

function markAsChanged() {
  // Use updateSaveBarVisibility to check for actual changes
  updateSaveBarVisibility();
}

function showSaveBar() {
  const saveBar = document.getElementById('save-bar');
  if (saveBar) {
    saveBar.classList.remove('hidden');
  }
}

function hideSaveBar() {
  const saveBar = document.getElementById('save-bar');
  if (saveBar) {
    saveBar.classList.add('hidden');
  }
}

function getSelectedCalendarIds() {
  const ids = [];
  document.querySelectorAll('.calendar-checkbox-item').forEach(item => {
    const cb = item.querySelector('input[type="checkbox"]');
    if (cb?.checked) {
      ids.push(item.dataset.calendarId);
    }
  });
  return ids.sort();
}

function checkForChanges() {
  // Build current settings object and compare to original
  const currentSettings = gatherCurrentSettings();
  const mainChanged = JSON.stringify(currentSettings) !== originalSettingsJson;
  
  // Check calendar selections separately
  const calendarChanged = JSON.stringify(getSelectedCalendarIds()) !== JSON.stringify([...originalSelectedCalendars].sort());
  
  return mainChanged || calendarChanged;
}

function gatherCurrentSettings() {
  // Get active days for schedule
  const activeDays = [];
  document.querySelectorAll('.schedule-day:checked').forEach(checkbox => {
    activeDays.push(parseInt(checkbox.value, 10));
  });
  
  return {
    mode: document.querySelector('input[name="mode"]:checked')?.value || 'blocklist',
    blockedSites: settings.blockedSites,
    allowedSites: settings.allowedSites,
    requireAllMethods: document.getElementById('require-mode').value === 'all',
    allowUnlimitedTime: document.getElementById('allow-unlimited').checked,
    inactivityTimeout: parseInt(document.getElementById('inactivity-timeout').value, 10) || 0,
    dailyLimit: {
      enabled: document.getElementById('daily-limit-enabled').checked,
      minutes: parseInt(document.getElementById('daily-limit-minutes').value, 10) || 30
    },
    earnedTime: {
      enabled: document.getElementById('earned-time-enabled').checked,
      minutesPerTask: parseInt(document.getElementById('earned-time-per-task').value, 10) || 5,
      maxBankMinutes: parseInt(document.getElementById('earned-time-max-bank').value, 10) || 60,
      requireTasksToUnlock: document.getElementById('earned-time-required').checked
    },
    schedule: {
      enabled: document.getElementById('schedule-enabled').checked,
      allowedTimes: settings.schedule?.allowedTimes || [],
      activeDays: activeDays
    },
    unblockMethods: {
      timer: {
        enabled: document.getElementById('timer-enabled').checked,
        minutes: parseInt(document.getElementById('timer-minutes').value, 10) || 5
      },
      completeTodo: {
        enabled: document.getElementById('todo-enabled').checked
      },
      typePhrase: {
        enabled: document.getElementById('phrase-enabled').checked,
        phrase: document.getElementById('phrase-text').value || 'I want to waste my time',
        useRandomString: document.getElementById('phrase-use-random').checked,
        randomLength: parseInt(document.getElementById('phrase-random-length').value, 10) || 30
      },
      typeReason: {
        enabled: document.getElementById('reason-enabled').checked,
        minLength: parseInt(document.getElementById('reason-min-length').value, 10) || 50
      },
      mathProblem: {
        enabled: document.getElementById('math-enabled').checked
      },
      password: {
        enabled: document.getElementById('password-enabled').checked,
        value: document.getElementById('password-value').value
      }
    }
  };
}

// =============================================================================
// REASON HISTORY
// =============================================================================

async function loadReasonHistory() {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'GET_UNBLOCK_REASONS' });
    
    if (!result || result.error) {
      console.error('Failed to load reason history:', result?.error);
      return;
    }
    
    const { reasons = [], stats = {}, categoryStats = {} } = result;
    
    // Update stats
    document.getElementById('total-reasons').textContent = reasons.length;
    
    if (stats?.topCategory) {
      document.getElementById('top-category').textContent = capitalizeFirst(stats.topCategory);
    } else {
      document.getElementById('top-category').textContent = '-';
    }
    
    if (stats?.topDomain) {
      document.getElementById('top-domain').textContent = stats.topDomain;
    } else {
      document.getElementById('top-domain').textContent = '-';
    }
    
    // Update recent reasons list
    const recentList = document.getElementById('recent-reasons-list');
    if (reasons.length === 0) {
      recentList.innerHTML = '<li class="no-reasons">No reasons recorded yet.</li>';
    } else {
      const recentReasons = reasons.slice(0, 10); // Show last 10
      recentList.innerHTML = recentReasons.map(r => `
        <li class="reason-item">
          <div class="reason-item-header">
            <span class="reason-domain">${escapeHtml(r.domain)}</span>
            <span class="reason-category">${capitalizeFirst(r.category)}</span>
          </div>
          <p class="reason-text">${escapeHtml(r.reason)}</p>
          <span class="reason-date">${formatReasonDate(r.timestamp)}</span>
        </li>
      `).join('');
    }
    
    // Update reasons by category
    const categoryContainer = document.getElementById('reasons-by-category');
    if (reasons.length === 0 || Object.keys(categoryStats).length === 0) {
      categoryContainer.innerHTML = '<p class="no-reasons">No reasons recorded yet.</p>';
    } else {
      const categoryHtml = Object.entries(categoryStats)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([category, count]) => `
          <div class="category-stat">
            <span class="category-name">${capitalizeFirst(category)}</span>
            <span class="category-count">${count}</span>
          </div>
        `).join('');
      
      categoryContainer.innerHTML = categoryHtml || '<p class="no-reasons">No reasons recorded yet.</p>';
    }
    
  } catch (e) {
    console.error('Failed to load reason history:', e);
  }
}

async function clearReasonHistory() {
  if (!confirm('Are you sure you want to clear all unblock reason history? This cannot be undone.')) {
    return;
  }
  
  try {
    await chrome.runtime.sendMessage({ type: 'CLEAR_UNBLOCK_REASONS' });
    loadReasonHistory();
    showSaveStatus('Reason history cleared');
  } catch (e) {
    console.error('Failed to clear reason history:', e);
    showSaveStatus('Failed to clear history', true);
  }
}

function capitalizeFirst(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatReasonDate(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString();
}

// =============================================================================
// NUCLEAR MODE
// =============================================================================

let nuclearCountdownInterval = null;

async function checkNuclearStatus() {
  const status = await chrome.runtime.sendMessage({ type: 'GET_NUCLEAR_STATUS' });
  
  if (status && status.active) {
    showNuclearActive(status);
  } else {
    showNuclearInactive();
  }
}

function showNuclearActive(status) {
  document.getElementById('nuclear-inactive').style.display = 'none';
  document.getElementById('nuclear-active').style.display = 'block';
  
  // Start countdown
  startNuclearCountdown(status.expiresAt);
}

function showNuclearInactive() {
  document.getElementById('nuclear-inactive').style.display = 'block';
  document.getElementById('nuclear-active').style.display = 'none';
  
  if (nuclearCountdownInterval) {
    clearInterval(nuclearCountdownInterval);
    nuclearCountdownInterval = null;
  }
}

function startNuclearCountdown(expiresAt) {
  if (nuclearCountdownInterval) {
    clearInterval(nuclearCountdownInterval);
  }
  
  function update() {
    const remaining = Math.max(0, expiresAt - Date.now());
    
    if (remaining <= 0) {
      clearInterval(nuclearCountdownInterval);
      showNuclearInactive();
      return;
    }
    
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    
    document.getElementById('nuclear-time-remaining').textContent = 
      `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  
  update();
  nuclearCountdownInterval = setInterval(update, 1000);
}

async function activateNuclearMode() {
  const duration = parseInt(document.getElementById('nuclear-duration').value, 10);
  
  if (!confirm(`Are you sure you want to activate Nuclear Mode for ${duration} minutes?\n\nThis CANNOT be cancelled until the timer expires!`)) {
    return;
  }
  
  const result = await chrome.runtime.sendMessage({ 
    type: 'ACTIVATE_NUCLEAR_MODE', 
    minutes: duration 
  });
  
  if (result && result.success) {
    showNuclearActive({ expiresAt: result.expiresAt });
    showSaveStatus('Nuclear Mode activated!');
  }
}

function setupNuclearModeListeners() {
  document.getElementById('activate-nuclear').addEventListener('click', activateNuclearMode);
}

// =============================================================================
// UTILITIES
// =============================================================================

function extractDomain(url) {
  if (!url) return '';
  
  try {
    // Add protocol if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    // If URL parsing fails, try to extract domain directly
    return url.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
  }
}

// =============================================================================
// SITE CATEGORIES
// =============================================================================

let categoryTemplates = {};
let editingCategoryId = null;
let editingCategorySites = [];

async function loadCategories() {
  const categories = await chrome.runtime.sendMessage({ type: 'GET_CATEGORIES' });
  categoryTemplates = await chrome.runtime.sendMessage({ type: 'GET_CATEGORY_TEMPLATES' });
  
  renderCategories(categories);
  renderTemplateMenu();
}

function renderCategories(categories) {
  const list = document.getElementById('categories-list');
  
  if (!categories || categories.length === 0) {
    list.innerHTML = '<div class="empty-categories">No categories yet. Create one or add from a template.</div>';
    return;
  }
  
  list.innerHTML = categories.map(category => {
    const siteCount = category.sites.length;
    const previewSites = category.sites.slice(0, 3);
    const moreSites = siteCount > 3 ? siteCount - 3 : 0;
    const categoryIcon = getIconSvg(category.icon);
    
    return `
      <div class="category-card ${category.enabled ? 'enabled' : ''}" data-category-id="${category.id}">
        <div class="category-header">
          <div class="category-icon">${categoryIcon}</div>
          <div class="category-info">
            <div class="category-name">${escapeHtml(category.name)}</div>
            <div class="category-count">${siteCount} site${siteCount !== 1 ? 's' : ''}</div>
          </div>
          <div class="category-actions">
            <button class="category-edit" data-category-id="${category.id}">Edit</button>
            <label class="toggle">
              <input type="checkbox" class="category-toggle" data-category-id="${category.id}" ${category.enabled ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
        ${siteCount > 0 ? `
          <div class="category-sites-preview">
            ${previewSites.map(site => `<span class="category-site-tag">${escapeHtml(site)}</span>`).join('')}
            ${moreSites > 0 ? `<span class="category-sites-more">+${moreSites} more</span>` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function renderTemplateMenu() {
  const menu = document.getElementById('template-menu');
  
  menu.innerHTML = Object.entries(categoryTemplates).map(([key, template]) => `
    <button class="dropdown-item" data-template-key="${key}">
      <span class="dropdown-item-icon">${getIconSvg(template.icon)}</span>
      <span>${template.name}</span>
    </button>
  `).join('');
}

function setupCategoryListeners() {
  // Add new category button
  document.getElementById('add-category-btn').addEventListener('click', () => {
    openCategoryModal(null);
  });
  
  // Template dropdown toggle
  const templateBtn = document.getElementById('template-btn');
  const dropdown = document.getElementById('template-dropdown');
  
  templateBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });
  
  // Close dropdown when clicking outside
  document.addEventListener('click', () => {
    dropdown.classList.remove('open');
  });
  
  // Template selection
  document.getElementById('template-menu').addEventListener('click', async (e) => {
    const btn = e.target.closest('.dropdown-item');
    if (!btn) return;
    
    const templateKey = btn.dataset.templateKey;
    await chrome.runtime.sendMessage({ type: 'ADD_CATEGORY_FROM_TEMPLATE', templateKey });
    dropdown.classList.remove('open');
    await loadCategories();
    showSaveStatus('Category added from template!');
  });
  
  // Category list event delegation
  document.getElementById('categories-list').addEventListener('click', (e) => {
    // Edit button
    if (e.target.classList.contains('category-edit')) {
      const categoryId = e.target.dataset.categoryId;
      openCategoryModal(categoryId);
    }
  });
  
  // Category toggle
  document.getElementById('categories-list').addEventListener('change', async (e) => {
    if (e.target.classList.contains('category-toggle')) {
      const categoryId = e.target.dataset.categoryId;
      await chrome.runtime.sendMessage({ type: 'TOGGLE_CATEGORY', categoryId });
      await loadCategories();
    }
  });
  
  // Modal close
  document.getElementById('modal-close').addEventListener('click', closeCategoryModal);
  document.querySelector('.modal-backdrop').addEventListener('click', closeCategoryModal);
  
  // Add site to category in modal
  document.getElementById('add-category-site-btn').addEventListener('click', addSiteToEditingCategory);
  document.getElementById('category-site-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addSiteToEditingCategory();
    }
  });
  
  // Save category
  document.getElementById('save-category-btn').addEventListener('click', saveCategory);
  
  // Delete category
  document.getElementById('delete-category-btn').addEventListener('click', deleteCategory);
  
  // Remove site from editing category (delegated)
  document.getElementById('category-sites-list').addEventListener('click', (e) => {
    if (e.target.classList.contains('site-remove')) {
      const site = e.target.dataset.site;
      editingCategorySites = editingCategorySites.filter(s => s !== site);
      renderEditingSites();
    }
  });
  
  // Setup category icon picker
  setupCategoryIconPicker();
}

function setupCategoryIconPicker() {
  const btn = document.getElementById('category-icon-btn');
  const dropdown = document.getElementById('category-icon-picker-dropdown');
  const preview = document.getElementById('category-icon-preview');
  const hiddenInput = document.getElementById('category-icon');
  
  if (!btn || !dropdown) return;
  
  // Render icon options using CATEGORY_ICON_OPTIONS from lib/icons.js
  dropdown.innerHTML = CATEGORY_ICON_OPTIONS.map(opt => `
    <button type="button" class="icon-picker-option" data-icon="${opt.id}" title="${opt.name}">
      <span class="icon-svg">${opt.icon}</span>
    </button>
  `).join('');
  
  // Toggle dropdown
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropdown.classList.toggle('open');
    
    // Highlight currently selected icon
    const current = hiddenInput.value;
    dropdown.querySelectorAll('.icon-picker-option').forEach(opt => {
      opt.classList.toggle('selected', opt.dataset.icon === current);
    });
  });
  
  // Select icon
  dropdown.addEventListener('click', (e) => {
    const option = e.target.closest('.icon-picker-option');
    if (option) {
      const iconId = option.dataset.icon;
      hiddenInput.value = iconId;
      preview.innerHTML = getIconSvg(iconId);
      dropdown.classList.remove('open');
      
      // Update selection highlight
      dropdown.querySelectorAll('.icon-picker-option').forEach(opt => {
        opt.classList.toggle('selected', opt === option);
      });
    }
  });
  
  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!btn.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.remove('open');
    }
  });
}

function updateCategoryIconPicker(iconId) {
  const preview = document.getElementById('category-icon-preview');
  const hiddenInput = document.getElementById('category-icon');
  const defaultIconId = 'folder';
  if (preview) preview.innerHTML = getIconSvg(iconId || defaultIconId);
  if (hiddenInput) hiddenInput.value = iconId || defaultIconId;
}

async function openCategoryModal(categoryId) {
  const modal = document.getElementById('category-modal');
  const deleteBtn = document.getElementById('delete-category-btn');
  
  editingCategoryId = categoryId;
  
  if (categoryId) {
    // Editing existing category
    document.getElementById('modal-title').textContent = 'Edit Category';
    deleteBtn.style.display = 'block';
    
    const categories = await chrome.runtime.sendMessage({ type: 'GET_CATEGORIES' });
    const category = categories.find(c => c.id === categoryId);
    
    if (category) {
      document.getElementById('category-name').value = category.name;
      updateCategoryIconPicker(category.icon);
      editingCategorySites = [...category.sites];
    }
  } else {
    // Creating new category
    document.getElementById('modal-title').textContent = 'New Category';
    deleteBtn.style.display = 'none';
    
    document.getElementById('category-name').value = '';
    updateCategoryIconPicker('folder');
    editingCategorySites = [];
  }
  
  renderEditingSites();
  modal.classList.remove('hidden');
}

function closeCategoryModal() {
  const modal = document.getElementById('category-modal');
  modal.classList.add('hidden');
  editingCategoryId = null;
  editingCategorySites = [];
}

function renderEditingSites() {
  const list = document.getElementById('category-sites-list');
  
  if (editingCategorySites.length === 0) {
    list.innerHTML = '<li class="empty-list">No sites added yet</li>';
    return;
  }
  
  list.innerHTML = editingCategorySites.map(site => `
    <li class="site-item">
      <span class="site-name">${escapeHtml(site)}</span>
      <button class="site-remove" data-site="${escapeHtml(site)}" title="Remove">&times;</button>
    </li>
  `).join('');
}

function addSiteToEditingCategory() {
  const input = document.getElementById('category-site-input');
  const site = extractDomain(input.value.trim());
  
  if (site && !editingCategorySites.includes(site)) {
    editingCategorySites.push(site);
    renderEditingSites();
  }
  
  input.value = '';
  input.focus();
}

async function saveCategory() {
  const name = document.getElementById('category-name').value.trim();
  const icon = document.getElementById('category-icon').value.trim() || 'folder';
  
  if (!name) {
    alert('Please enter a category name');
    return;
  }
  
  if (editingCategoryId) {
    // Update existing
    await chrome.runtime.sendMessage({
      type: 'UPDATE_CATEGORY',
      categoryId: editingCategoryId,
      updates: { name, icon, sites: editingCategorySites }
    });
    showSaveStatus('Category updated!');
  } else {
    // Create new
    await chrome.runtime.sendMessage({
      type: 'CREATE_CATEGORY',
      category: { name, icon, sites: editingCategorySites, enabled: false }
    });
    showSaveStatus('Category created!');
  }
  
  closeCategoryModal();
  await loadCategories();
}

async function deleteCategory() {
  if (!editingCategoryId) return;
  
  if (!confirm('Are you sure you want to delete this category?')) {
    return;
  }
  
  await chrome.runtime.sendMessage({ type: 'DELETE_CATEGORY', categoryId: editingCategoryId });
  closeCategoryModal();
  await loadCategories();
  showSaveStatus('Category deleted');
}

// =============================================================================
// KEYWORD BLOCKING
// =============================================================================

async function loadKeywords() {
  const keywordSettings = await chrome.runtime.sendMessage({ type: 'GET_BLOCKED_KEYWORDS' });
  
  document.getElementById('keyword-blocking-enabled').checked = keywordSettings.enabled;
  renderKeywords(keywordSettings.keywords);
}

function renderKeywords(keywords) {
  const list = document.getElementById('keywords-list');
  
  if (!keywords || keywords.length === 0) {
    list.innerHTML = '<li class="empty-keywords">No keywords added yet. Add keywords to block URLs containing them.</li>';
    return;
  }
  
  list.innerHTML = keywords.map(k => `
    <li class="keyword-item">
      <div>
        <span class="keyword-text">${escapeHtml(k.keyword)}</span>
        ${k.caseSensitive ? '<span class="keyword-badge">Case Sensitive</span>' : ''}
      </div>
      <div class="keyword-actions">
        <button class="keyword-remove" data-keyword="${escapeHtml(k.keyword)}" title="Remove">&times;</button>
      </div>
    </li>
  `).join('');
}

function setupKeywordListeners() {
  // Toggle keyword blocking
  document.getElementById('keyword-blocking-enabled').addEventListener('change', async (e) => {
    await chrome.runtime.sendMessage({ type: 'TOGGLE_KEYWORD_BLOCKING' });
    showSaveStatus(e.target.checked ? 'Keyword blocking enabled' : 'Keyword blocking disabled');
  });
  
  // Add keyword button
  document.getElementById('add-keyword-btn').addEventListener('click', addKeyword);
  
  // Add keyword on Enter
  document.getElementById('keyword-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addKeyword();
    }
  });
  
  // Remove keyword (delegated)
  document.getElementById('keywords-list').addEventListener('click', async (e) => {
    if (e.target.classList.contains('keyword-remove')) {
      const keyword = e.target.dataset.keyword;
      await chrome.runtime.sendMessage({ type: 'REMOVE_BLOCKED_KEYWORD', keyword });
      await loadKeywords();
      showSaveStatus('Keyword removed');
    }
  });
}

async function addKeyword() {
  const input = document.getElementById('keyword-input');
  const caseSensitive = document.getElementById('keyword-case-sensitive').checked;
  const keyword = input.value.trim();
  
  if (!keyword) {
    return;
  }
  
  const result = await chrome.runtime.sendMessage({
    type: 'ADD_BLOCKED_KEYWORD',
    keyword,
    caseSensitive
  });
  
  if (result.success) {
    input.value = '';
    document.getElementById('keyword-case-sensitive').checked = false;
    await loadKeywords();
    showSaveStatus('Keyword added');
  } else {
    showSaveStatus(result.error || 'Failed to add keyword', true);
  }
}

// =============================================================================
// URL WHITELIST
// =============================================================================

async function loadWhitelistUrls() {
  const allowedUrls = await chrome.runtime.sendMessage({ type: 'GET_ALLOWED_URLS' });
  renderWhitelistUrls(allowedUrls);
}

function renderWhitelistUrls(urls) {
  const list = document.getElementById('whitelist-urls-list');
  
  if (!urls || urls.length === 0) {
    list.innerHTML = '<li class="empty-whitelist">No URLs whitelisted. Add specific URLs you want to access on blocked domains.</li>';
    return;
  }
  
  list.innerHTML = urls.map(url => {
    // Extract domain for display
    let domain = '';
    try {
      const urlObj = new URL(url);
      domain = urlObj.hostname.replace(/^www\./, '');
    } catch {
      domain = url;
    }
    
    // Truncate URL for display if too long
    const displayUrl = url.length > 60 ? url.substring(0, 57) + '...' : url;
    
    return `
      <li class="whitelist-url-item">
        <span class="whitelist-url-domain">${escapeHtml(domain)}</span>
        <span class="whitelist-url-text" title="${escapeHtml(url)}">${escapeHtml(displayUrl)}</span>
        <button class="whitelist-remove" data-url="${escapeHtml(url)}" title="Remove">&times;</button>
      </li>
    `;
  }).join('');
}

function setupWhitelistListeners() {
  // Add URL button
  document.getElementById('add-whitelist-url-btn').addEventListener('click', addWhitelistUrl);
  
  // Add URL on Enter
  document.getElementById('whitelist-url-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addWhitelistUrl();
    }
  });
  
  // Remove URL (delegated)
  document.getElementById('whitelist-urls-list').addEventListener('click', async (e) => {
    if (e.target.classList.contains('whitelist-remove')) {
      const url = e.target.dataset.url;
      await chrome.runtime.sendMessage({ type: 'REMOVE_ALLOWED_URL', url });
      await loadWhitelistUrls();
      showSaveStatus('URL removed from whitelist');
    }
  });
}

async function addWhitelistUrl() {
  const input = document.getElementById('whitelist-url-input');
  const url = input.value.trim();
  
  if (!url) {
    return;
  }
  
  const result = await chrome.runtime.sendMessage({
    type: 'ADD_ALLOWED_URL',
    url
  });
  
  if (result.success) {
    input.value = '';
    await loadWhitelistUrls();
    showSaveStatus('URL added to whitelist');
  } else {
    showSaveStatus(result.error || 'Failed to add URL', true);
  }
}

// =============================================================================
// PROFILES
// =============================================================================

let currentEditingProfile = null;

async function loadProfiles() {
  const profiles = await chrome.runtime.sendMessage({ type: 'GET_PROFILES' });
  const activeProfileId = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_PROFILE_ID' });
  renderProfiles(profiles, activeProfileId);
}

function renderProfiles(profiles, activeProfileId) {
  const list = document.getElementById('profiles-list');
  
  if (!profiles || profiles.length === 0) {
    list.innerHTML = `
      <div class="empty-profiles">
        <div class="empty-profiles-icon">${Icons.folder}</div>
        <p class="empty-profiles-text">No profiles yet. Create your first profile to get started!</p>
      </div>
    `;
    return;
  }
  
  list.innerHTML = profiles.map(profile => {
    const isActive = profile.id === activeProfileId;
    const siteCount = (profile.blockedSites || []).length;
    const categoryCount = (profile.categories || []).filter(c => c.enabled).length;
    const methodCount = countEnabledMethods(profile.unblockMethods);
    const profileIcon = getIcon(profile.icon) || Icons.target;
    
    return `
      <div class="profile-card ${isActive ? 'active' : ''}" data-profile-id="${profile.id}">
        <div class="profile-card-header">
          <div class="profile-icon" style="background-color: ${profile.color || '#6366f1'}20; color: ${profile.color || '#6366f1'}">
            ${profileIcon}
          </div>
          <div class="profile-info">
            <div class="profile-name">${escapeHtml(profile.name)}</div>
            <div class="profile-meta">${profile.id === 'default' ? 'Default profile' : 'Custom profile'}</div>
          </div>
        </div>
        <div class="profile-card-body">
          <span class="profile-stat">
            <span class="profile-stat-icon">${Icons.ban}</span>
            ${siteCount} blocked site${siteCount !== 1 ? 's' : ''}
          </span>
          <span class="profile-stat">
            <span class="profile-stat-icon">${Icons.folder}</span>
            ${categoryCount} active categor${categoryCount !== 1 ? 'ies' : 'y'}
          </span>
          <span class="profile-stat">
            <span class="profile-stat-icon">${Icons.unlock}</span>
            ${methodCount} unlock method${methodCount !== 1 ? 's' : ''}
          </span>
        </div>
        <div class="profile-card-actions">
          ${!isActive ? `<button class="btn btn-activate" data-action="activate" data-profile-id="${profile.id}">Activate</button>` : ''}
          <button class="btn btn-secondary" data-action="edit" data-profile-id="${profile.id}">Edit</button>
        </div>
      </div>
    `;
  }).join('');
}

function countEnabledMethods(methods) {
  if (!methods) return 0;
  let count = 0;
  if (methods.timer?.enabled) count++;
  if (methods.typePhrase?.enabled) count++;
  if (methods.mathProblem?.enabled) count++;
  if (methods.completeTodo?.enabled) count++;
  if (methods.typeReason?.enabled) count++;
  if (methods.password?.enabled) count++;
  return count;
}

function setupProfileListeners() {
  // Profile card actions (delegated)
  document.getElementById('profiles-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    
    const action = btn.dataset.action;
    const profileId = btn.dataset.profileId;
    
    if (action === 'activate') {
      await activateProfile(profileId);
    } else if (action === 'edit') {
      await openProfileModal(profileId);
    }
  });
  
  // Add new profile button
  document.getElementById('add-profile-btn').addEventListener('click', () => {
    openProfileModal(null); // null = create new
  });
  
  // Profile template dropdown
  const templateDropdown = document.getElementById('profile-template-dropdown');
  const templateBtn = document.getElementById('profile-template-btn');
  const templateMenu = document.getElementById('profile-template-menu');
  
  templateBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    templateDropdown.classList.toggle('open');
  });
  
  // Close dropdown when clicking outside
  document.addEventListener('click', () => {
    templateDropdown.classList.remove('open');
  });
  
  // Template item clicks
  templateMenu.addEventListener('click', async (e) => {
    const item = e.target.closest('.dropdown-item');
    if (item) {
      const templateKey = item.dataset.template;
      await createProfileFromTemplate(templateKey);
      templateDropdown.classList.remove('open');
    }
  });
  
  // Modal controls
  document.getElementById('profile-modal-close').addEventListener('click', closeProfileModal);
  document.querySelector('#profile-modal .modal-backdrop').addEventListener('click', closeProfileModal);
  
  // Save profile button
  document.getElementById('save-profile-btn').addEventListener('click', saveProfile);
  
  // Delete profile button
  document.getElementById('delete-profile-btn').addEventListener('click', deleteProfile);
  
  // Duplicate profile button
  document.getElementById('duplicate-profile-btn').addEventListener('click', duplicateProfile);
  
  // Add site to profile
  document.getElementById('add-profile-site-btn').addEventListener('click', addProfileSite);
  document.getElementById('profile-site-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addProfileSite();
  });
  
  // Remove site from profile (delegated)
  document.getElementById('profile-sites-list').addEventListener('click', (e) => {
    if (e.target.classList.contains('site-remove')) {
      const site = e.target.dataset.site;
      removeProfileSite(site);
    }
  });
}

async function activateProfile(profileId) {
  const result = await chrome.runtime.sendMessage({
    type: 'SET_ACTIVE_PROFILE',
    profileId
  });
  
  if (result.success) {
    await loadProfiles();
    // Reload settings since active profile changed
    settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    populateSettings();
    // Reload categories, keywords, and whitelist since they're profile-specific
    await loadCategories();
    await loadKeywords();
    await loadWhitelistUrls();
    showSaveStatus(`Switched to "${result.profile.name}" profile`);
  } else {
    showSaveStatus(result.error || 'Failed to activate profile', true);
  }
}

async function openProfileModal(profileId) {
  const modal = document.getElementById('profile-modal');
  const title = document.getElementById('profile-modal-title');
  const deleteBtn = document.getElementById('delete-profile-btn');
  const duplicateBtn = document.getElementById('duplicate-profile-btn');
  
  if (profileId) {
    // Edit existing profile
    const profiles = await chrome.runtime.sendMessage({ type: 'GET_PROFILES' });
    currentEditingProfile = profiles.find(p => p.id === profileId);
    
    if (!currentEditingProfile) {
      showSaveStatus('Profile not found', true);
      return;
    }
    
    title.textContent = 'Edit Profile';
    deleteBtn.style.display = currentEditingProfile.id === 'default' ? 'none' : 'block';
    duplicateBtn.style.display = 'block';
    
    // Populate form
    document.getElementById('profile-name').value = currentEditingProfile.name || '';
    updateIconPicker(currentEditingProfile.icon || '*');
    document.getElementById('profile-color').value = currentEditingProfile.color || '#6366f1';
    
    // Populate blocked sites
    renderProfileSites(currentEditingProfile.blockedSites || []);
    
    // Populate unblock methods
    const methods = currentEditingProfile.unblockMethods || {};
    document.getElementById('profile-timer-enabled').checked = methods.timer?.enabled ?? true;
    document.getElementById('profile-timer-minutes').value = methods.timer?.minutes ?? 5;
    document.getElementById('profile-phrase-enabled').checked = methods.typePhrase?.enabled ?? false;
    document.getElementById('profile-math-enabled').checked = methods.mathProblem?.enabled ?? false;
    document.getElementById('profile-todo-enabled').checked = methods.completeTodo?.enabled ?? false;
    document.getElementById('profile-reason-enabled').checked = methods.typeReason?.enabled ?? false;
    document.getElementById('profile-require-all').checked = currentEditingProfile.requireAllMethods ?? false;
    
  } else {
    // Create new profile
    currentEditingProfile = {
      name: '',
      icon: '*',
      color: '#6366f1',
      blockedSites: [],
      unblockMethods: {
        timer: { enabled: true, minutes: 5 },
        typePhrase: { enabled: false, phrase: 'I want to waste my time' },
        mathProblem: { enabled: false },
        completeTodo: { enabled: false },
        typeReason: { enabled: false, minLength: 50 },
        password: { enabled: false, value: '' }
      },
      requireAllMethods: false
    };
    
    title.textContent = 'Create New Profile';
    deleteBtn.style.display = 'none';
    duplicateBtn.style.display = 'none';
    
    // Reset form
    document.getElementById('profile-name').value = '';
    updateIconPicker('*');
    document.getElementById('profile-color').value = '#6366f1';
    renderProfileSites([]);
    
    document.getElementById('profile-timer-enabled').checked = true;
    document.getElementById('profile-timer-minutes').value = 5;
    document.getElementById('profile-phrase-enabled').checked = false;
    document.getElementById('profile-math-enabled').checked = false;
    document.getElementById('profile-todo-enabled').checked = false;
    document.getElementById('profile-reason-enabled').checked = false;
    document.getElementById('profile-require-all').checked = false;
  }
  
  modal.classList.remove('hidden');
}

function closeProfileModal() {
  document.getElementById('profile-modal').classList.add('hidden');
  document.getElementById('icon-picker-dropdown').classList.remove('open');
  currentEditingProfile = null;
}

// Icon Picker
function setupIconPicker() {
  const btn = document.getElementById('profile-icon-btn');
  const dropdown = document.getElementById('icon-picker-dropdown');
  const preview = document.getElementById('profile-icon-preview');
  const hiddenInput = document.getElementById('profile-icon');
  
  if (!btn || !dropdown) return;
  
  // Render icon options using SVG icons from lib/icons.js
  dropdown.innerHTML = PROFILE_ICON_OPTIONS.map(opt => `
    <button type="button" class="icon-picker-option" data-icon="${opt.id}" title="${opt.name}">
      <span class="icon-svg">${opt.icon}</span>
    </button>
  `).join('');
  
  // Toggle dropdown
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropdown.classList.toggle('open');
    
    // Highlight currently selected icon
    const current = hiddenInput.value;
    dropdown.querySelectorAll('.icon-picker-option').forEach(opt => {
      opt.classList.toggle('selected', opt.dataset.icon === current);
    });
  });
  
  // Select icon
  dropdown.addEventListener('click', (e) => {
    const option = e.target.closest('.icon-picker-option');
    if (option) {
      const iconId = option.dataset.icon;
      hiddenInput.value = iconId;
      preview.innerHTML = getIcon(iconId);
      dropdown.classList.remove('open');
      
      // Update selection highlight
      dropdown.querySelectorAll('.icon-picker-option').forEach(opt => {
        opt.classList.toggle('selected', opt === option);
      });
    }
  });
  
  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!btn.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.remove('open');
    }
  });
}

function updateIconPicker(iconId) {
  const preview = document.getElementById('profile-icon-preview');
  const hiddenInput = document.getElementById('profile-icon');
  const defaultIconId = 'target';
  if (preview) preview.innerHTML = getIcon(iconId || defaultIconId);
  if (hiddenInput) hiddenInput.value = iconId || defaultIconId;
}

function renderProfileSites(sites) {
  const list = document.getElementById('profile-sites-list');
  
  if (!sites || sites.length === 0) {
    list.innerHTML = '';
    return;
  }
  
  list.innerHTML = sites.map(site => `
    <li class="site-item">
      <span class="site-name">${escapeHtml(site)}</span>
      <button class="site-remove" data-site="${escapeHtml(site)}">&times;</button>
    </li>
  `).join('');
}

function addProfileSite() {
  const input = document.getElementById('profile-site-input');
  const site = input.value.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
  
  if (!site) return;
  
  if (!currentEditingProfile.blockedSites) {
    currentEditingProfile.blockedSites = [];
  }
  
  if (!currentEditingProfile.blockedSites.includes(site)) {
    currentEditingProfile.blockedSites.push(site);
    renderProfileSites(currentEditingProfile.blockedSites);
  }
  
  input.value = '';
}

function removeProfileSite(site) {
  if (!currentEditingProfile.blockedSites) return;
  
  currentEditingProfile.blockedSites = currentEditingProfile.blockedSites.filter(s => s !== site);
  renderProfileSites(currentEditingProfile.blockedSites);
}

async function saveProfile() {
  const name = document.getElementById('profile-name').value.trim();
  const icon = document.getElementById('profile-icon').value || '*';
  const color = document.getElementById('profile-color').value || '#6366f1';
  
  if (!name) {
    showSaveStatus('Please enter a profile name', true);
    return;
  }
  
  // Build unblock methods
  const unblockMethods = {
    timer: {
      enabled: document.getElementById('profile-timer-enabled').checked,
      minutes: parseInt(document.getElementById('profile-timer-minutes').value) || 5
    },
    typePhrase: {
      enabled: document.getElementById('profile-phrase-enabled').checked,
      phrase: currentEditingProfile.unblockMethods?.typePhrase?.phrase || 'I want to waste my time',
      useRandomString: currentEditingProfile.unblockMethods?.typePhrase?.useRandomString || false,
      randomLength: currentEditingProfile.unblockMethods?.typePhrase?.randomLength || 30
    },
    mathProblem: {
      enabled: document.getElementById('profile-math-enabled').checked
    },
    completeTodo: {
      enabled: document.getElementById('profile-todo-enabled').checked
    },
    typeReason: {
      enabled: document.getElementById('profile-reason-enabled').checked,
      minLength: currentEditingProfile.unblockMethods?.typeReason?.minLength || 50
    },
    password: {
      enabled: currentEditingProfile.unblockMethods?.password?.enabled || false,
      value: currentEditingProfile.unblockMethods?.password?.value || ''
    }
  };
  
  const profileData = {
    name,
    icon,
    color,
    blockedSites: currentEditingProfile.blockedSites || [],
    allowedSites: currentEditingProfile.allowedSites || [],
    categories: currentEditingProfile.categories || [],
    blockedKeywords: currentEditingProfile.blockedKeywords || { enabled: false, keywords: [] },
    allowedUrls: currentEditingProfile.allowedUrls || [],
    schedule: currentEditingProfile.schedule || { enabled: false, allowedTimes: [], activeDays: [1, 2, 3, 4, 5] },
    unblockMethods,
    requireAllMethods: document.getElementById('profile-require-all').checked
  };
  
  let result;
  if (currentEditingProfile.id) {
    // Update existing
    result = await chrome.runtime.sendMessage({
      type: 'UPDATE_PROFILE',
      profileId: currentEditingProfile.id,
      updates: profileData
    });
  } else {
    // Create new
    result = await chrome.runtime.sendMessage({
      type: 'CREATE_PROFILE',
      profileData
    });
  }
  
  if (result.success) {
    closeProfileModal();
    await loadProfiles();
    showSaveStatus(currentEditingProfile.id ? 'Profile updated' : 'Profile created');
    
    // Reload settings if this was the active profile
    const activeId = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_PROFILE_ID' });
    if (currentEditingProfile.id === activeId) {
      settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      populateSettings();
    }
  } else {
    showSaveStatus(result.error || 'Failed to save profile', true);
  }
}

async function deleteProfile() {
  if (!currentEditingProfile?.id || currentEditingProfile.id === 'default') {
    showSaveStatus('Cannot delete this profile', true);
    return;
  }
  
  if (!confirm(`Are you sure you want to delete "${currentEditingProfile.name}"? This cannot be undone.`)) {
    return;
  }
  
  const result = await chrome.runtime.sendMessage({
    type: 'DELETE_PROFILE',
    profileId: currentEditingProfile.id
  });
  
  if (result.success) {
    closeProfileModal();
    await loadProfiles();
    showSaveStatus('Profile deleted');
    
    // Reload settings since we may have switched to default profile
    settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    populateSettings();
    await loadCategories();
    await loadKeywords();
    await loadWhitelistUrls();
  } else {
    showSaveStatus(result.error || 'Failed to delete profile', true);
  }
}

async function duplicateProfile() {
  if (!currentEditingProfile?.id) return;
  
  const result = await chrome.runtime.sendMessage({
    type: 'DUPLICATE_PROFILE',
    profileId: currentEditingProfile.id,
    newName: `${currentEditingProfile.name} (Copy)`
  });
  
  if (result.success) {
    closeProfileModal();
    await loadProfiles();
    showSaveStatus('Profile duplicated');
    // Open the new profile for editing
    await openProfileModal(result.profile.id);
  } else {
    showSaveStatus(result.error || 'Failed to duplicate profile', true);
  }
}

async function createProfileFromTemplate(templateKey) {
  const result = await chrome.runtime.sendMessage({
    type: 'CREATE_PROFILE_FROM_TEMPLATE',
    templateKey
  });
  
  if (result.success) {
    await loadProfiles();
    showSaveStatus(`Created "${result.profile.name}" profile from template`);
    // Open the new profile for editing
    await openProfileModal(result.profile.id);
  } else {
    showSaveStatus(result.error || 'Failed to create profile from template', true);
  }
}

// =============================================================================
// GOOGLE CALENDAR INTEGRATION
// =============================================================================

let calendarSettings = null;
let calendarList = [];
let originalSelectedCalendars = [];
let profiles = [];

/**
 * Load calendar connection status
 */
async function loadCalendarStatus() {
  try {
    // Display setup info (extension ID and redirect URL)
    const extensionIdEl = document.getElementById('calendar-extension-id');
    const redirectUrlEl = document.getElementById('calendar-redirect-url');
    
    if (extensionIdEl) {
      extensionIdEl.textContent = chrome.runtime.id;
    }
    if (redirectUrlEl) {
      redirectUrlEl.textContent = chrome.identity.getRedirectURL();
    }
    
    calendarSettings = await chrome.runtime.sendMessage({ type: 'GET_CALENDAR_STATUS' });
    profiles = await chrome.runtime.sendMessage({ type: 'GET_PROFILES' }) || [];
    
    updateCalendarUI();
  } catch (e) {
    console.error('Failed to load calendar status:', e);
  }
}

/**
 * Update calendar UI based on connection status
 */
function updateCalendarUI() {
  const notConnected = document.getElementById('calendar-not-connected');
  const connected = document.getElementById('calendar-connected');
  const settingsSection = document.getElementById('calendar-settings');
  const setupHelp = document.getElementById('calendar-setup-help');
  
  if (calendarSettings?.connected) {
    notConnected.style.display = 'none';
    connected.style.display = 'flex';
    settingsSection.classList.remove('hidden');
    if (setupHelp) setupHelp.style.display = 'none';
    
    // Update email display
    document.getElementById('calendar-email').textContent = 
      calendarSettings.email || 'Connected';
    
    // Update toggle states
    document.getElementById('calendar-sync-enabled').checked = 
      calendarSettings.syncEnabled || false;
    document.getElementById('calendar-auto-switch').checked = 
      calendarSettings.autoSwitchProfiles || false;
    
    // Show/hide profile mapping section
    const mappingSection = document.getElementById('profile-mapping-section');
    if (calendarSettings.autoSwitchProfiles) {
      mappingSection.classList.remove('hidden');
    } else {
      mappingSection.classList.add('hidden');
    }
    
    // Update keywords (store in hidden field and render tags)
    document.getElementById('focus-keywords').value = 
      (calendarSettings.focusEventKeywords || []).join(', ');
    document.getElementById('break-keywords').value = 
      (calendarSettings.breakEventKeywords || []).join(', ');
    renderKeywordTags('focus');
    renderKeywordTags('break');
    
    // Update date display
    updateCalendarDateDisplay();
    
    // Update last sync time
    updateLastSyncTime();
    
    // Load calendars and events
    loadCalendarList();
    loadTodayEvents();
    loadProfileMappings();
    checkCalendarSuggestion();
  } else {
    notConnected.style.display = 'flex';
    connected.style.display = 'none';
    settingsSection.classList.add('hidden');
    if (setupHelp) setupHelp.style.display = '';
  }
}

/**
 * Update the calendar date display
 */
function updateCalendarDateDisplay() {
  const now = new Date();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  const dayNameEl = document.getElementById('calendar-day-name');
  const dateEl = document.getElementById('calendar-date');
  
  if (dayNameEl) dayNameEl.textContent = dayNames[now.getDay()];
  if (dateEl) dateEl.textContent = `${monthNames[now.getMonth()]} ${now.getDate()}`;
}

/**
 * Render keyword tags for focus or break
 */
function renderKeywordTags(type) {
  const container = document.getElementById(`${type}-keywords-tags`);
  const hiddenInput = document.getElementById(`${type}-keywords`);
  if (!container || !hiddenInput) return;
  
  const keywords = hiddenInput.value
    .split(',')
    .map(k => k.trim())
    .filter(k => k);
  
  container.innerHTML = keywords.map(keyword => `
    <span class="keyword-tag" data-keyword="${escapeHtml(keyword)}">
      ${escapeHtml(keyword)}
      <button type="button" class="keyword-tag-remove" data-type="${type}" data-keyword="${escapeHtml(keyword)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </span>
  `).join('');
  
  // Add remove handlers
  container.querySelectorAll('.keyword-tag-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const keywordType = btn.dataset.type;
      const keyword = btn.dataset.keyword;
      await removeKeywordTag(keywordType, keyword);
    });
  });
}

/**
 * Add a keyword tag
 */
async function addKeywordTag(type, keyword) {
  const hiddenInput = document.getElementById(`${type}-keywords`);
  if (!hiddenInput || !keyword.trim()) return;
  
  const keywords = hiddenInput.value
    .split(',')
    .map(k => k.trim())
    .filter(k => k);
  
  if (!keywords.includes(keyword.trim())) {
    keywords.push(keyword.trim());
    hiddenInput.value = keywords.join(', ');
    renderKeywordTags(type);
    
    // Save to storage
    const settingKey = type === 'focus' ? 'focusEventKeywords' : 'breakEventKeywords';
    await chrome.runtime.sendMessage({
      type: 'UPDATE_CALENDAR_SETTINGS',
      settings: { [settingKey]: keywords }
    });
  }
}

/**
 * Remove a keyword tag
 */
async function removeKeywordTag(type, keyword) {
  const hiddenInput = document.getElementById(`${type}-keywords`);
  if (!hiddenInput) return;
  
  const keywords = hiddenInput.value
    .split(',')
    .map(k => k.trim())
    .filter(k => k && k !== keyword);
  
  hiddenInput.value = keywords.join(', ');
  renderKeywordTags(type);
  
  // Save to storage
  const settingKey = type === 'focus' ? 'focusEventKeywords' : 'breakEventKeywords';
  await chrome.runtime.sendMessage({
    type: 'UPDATE_CALENDAR_SETTINGS',
    settings: { [settingKey]: keywords }
  });
}

/**
 * Load list of available calendars
 */
async function loadCalendarList() {
  const container = document.getElementById('calendar-list');
  container.innerHTML = '<div class="calendar-loading"><div class="spinner"></div><span>Loading calendars...</span></div>';
  
  try {
    calendarList = await chrome.runtime.sendMessage({ type: 'GET_CALENDAR_LIST' });
    
    if (calendarList.error) {
      container.innerHTML = `<div class="calendar-loading">Error: ${calendarList.error}</div>`;
      return;
    }
    
    if (!calendarList.length) {
      container.innerHTML = '<div class="calendar-loading">No calendars found</div>';
      return;
    }
    
    const selectedIds = calendarSettings?.selectedCalendars || [];
    originalSelectedCalendars = [...selectedIds];
    
    container.innerHTML = calendarList.map(cal => `
      <div class="calendar-checkbox-item" data-calendar-id="${cal.id}">
        <input type="checkbox" ${selectedIds.includes(cal.id) ? 'checked' : ''}>
        <span class="calendar-color-dot" style="background: ${cal.color || '#4285f4'}"></span>
        <span class="calendar-checkbox-label">${escapeHtml(cal.name)}</span>
        ${cal.primary ? '<span class="calendar-checkbox-badge">Primary</span>' : ''}
      </div>
    `).join('');
    
    // Add click handlers
    container.querySelectorAll('.calendar-checkbox-item').forEach(item => {
      const checkbox = item.querySelector('input[type="checkbox"]');
      
      item.addEventListener('click', (e) => {
        if (e.target.type !== 'checkbox') {
          checkbox.checked = !checkbox.checked;
        }
        updateSaveBarVisibility();
      });
    });
  } catch (e) {
    console.error('Failed to load calendars:', e);
    container.innerHTML = '<div class="calendar-loading">Failed to load calendars</div>';
  }
}

/**
 * Format time in 12-hour format
 */
function formatTime12h(date) {
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const minutesStr = minutes < 10 ? '0' + minutes : minutes;
  return `${hours}:${minutesStr} ${ampm}`;
}

/**
 * Load today's events
 */
async function loadTodayEvents() {
  const container = document.getElementById('today-events');
  
  try {
    const events = await chrome.runtime.sendMessage({ type: 'GET_TODAY_EVENTS' });
    
    if (events.error) {
      container.innerHTML = `
        <div class="calendar-empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
          </svg>
          <span>Error: ${events.error}</span>
        </div>`;
      return;
    }
    
    if (!events.length) {
      container.innerHTML = `
        <div class="calendar-empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
          <span>No events for today</span>
        </div>`;
      return;
    }
    
    const now = Date.now();
    
    container.innerHTML = events.map(event => {
      const start = new Date(event.start);
      const end = new Date(event.end);
      const isCurrent = start.getTime() <= now && end.getTime() > now;
      
      // Check if event matches focus/break keywords using proper scoring
      let eventType = '';
      let tags = [];
      const text = `${event.title} ${event.description || ''}`.toLowerCase();
      const focusKeywords = (calendarSettings?.focusEventKeywords || []);
      const breakKeywords = (calendarSettings?.breakEventKeywords || []);
      
      const focusMatch = findBestKeywordMatchForEvent(text, focusKeywords);
      const breakMatch = findBestKeywordMatchForEvent(text, breakKeywords);
      
      if (focusMatch && (!breakMatch || focusMatch.score >= breakMatch.score)) {
        eventType = 'event-focus';
        tags.push('<span class="event-tag event-tag-focus">Focus</span>');
      } else if (breakMatch) {
        eventType = 'event-break';
        tags.push('<span class="event-tag event-tag-break">Break</span>');
      }
      
      if (isCurrent) {
        tags.unshift('<span class="event-tag event-tag-now">Now</span>');
      }
      
      const startTimeStr = event.isAllDay ? 'All Day' : formatTime12h(start);
      const endTimeStr = event.isAllDay ? '' : formatTime12h(end);
      
      return `
        <div class="calendar-event ${eventType} ${isCurrent ? 'event-current' : ''}">
          <div class="calendar-event-time">
            <span class="event-start-time">${startTimeStr}</span>
            ${endTimeStr ? `<span class="event-end-time">${endTimeStr}</span>` : ''}
          </div>
          <div class="calendar-event-content">
            <span class="event-title">${escapeHtml(event.title)}</span>
            <div class="event-meta">
              ${event.calendarName ? `<span class="event-calendar-name">${escapeHtml(event.calendarName)}</span>` : ''}
              ${tags.join('')}
            </div>
          </div>
        </div>
      `;
    }).join('');
    
    updateLastSyncTime();
  } catch (e) {
    console.error('Failed to load today events:', e);
    container.innerHTML = `
      <div class="calendar-empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="15" y1="9" x2="9" y2="15"></line>
          <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>
        <span>Failed to load events</span>
      </div>`;
  }
}

/**
 * Format event time
 */
function formatEventTime(date) {
  return date.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true 
  });
}

/**
 * Format event duration
 */
function formatDuration(start, end) {
  const diffMs = end - start;
  const diffMins = Math.round(diffMs / 60000);
  
  if (diffMins < 60) {
    return `${diffMins} min`;
  }
  
  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  
  if (mins === 0) {
    return `${hours} hr`;
  }
  return `${hours} hr ${mins} min`;
}

/**
 * Update last sync time display
 */
function updateLastSyncTime() {
  const el = document.getElementById('calendar-last-sync');
  if (!calendarSettings?.lastSync) {
    el.textContent = 'Never synced';
    return;
  }
  
  const syncTime = new Date(calendarSettings.lastSync);
  const now = new Date();
  const diffMins = Math.round((now - syncTime) / 60000);
  
  if (diffMins < 1) {
    el.textContent = 'Just synced';
  } else if (diffMins < 60) {
    el.textContent = `Synced ${diffMins} min ago`;
  } else {
    el.textContent = `Synced at ${formatEventTime(syncTime)}`;
  }
}

/**
 * Load profile mappings
 */
function loadProfileMappings() {
  const container = document.getElementById('profile-mappings');
  const mappings = calendarSettings?.profileMapping || [];
  
  if (!mappings.length) {
    container.innerHTML = '';
    return;
  }
  
  container.innerHTML = mappings.map((mapping, index) => `
    <div class="profile-mapping-item" data-index="${index}">
      <div class="mapping-keyword">
        <input type="text" class="input mapping-keywords" value="${(mapping.eventKeywords || []).join(', ')}" placeholder="keyword">
      </div>
      <div class="mapping-arrow">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </div>
      <div class="mapping-profile">
        <select class="select mapping-profile-select">
          ${profiles.map(p => `
            <option value="${p.id}" ${p.id === mapping.profileId ? 'selected' : ''}>
              ${p.icon} ${escapeHtml(p.name)}
            </option>
          `).join('')}
        </select>
      </div>
      <button class="mapping-remove" title="Remove mapping">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  `).join('');
  
  // Add event listeners
  container.querySelectorAll('.profile-mapping-item').forEach(item => {
    const index = parseInt(item.dataset.index);
    
    item.querySelector('.mapping-keywords').addEventListener('change', () => saveMappings());
    item.querySelector('.mapping-profile-select').addEventListener('change', () => saveMappings());
    item.querySelector('.mapping-remove').addEventListener('click', () => deleteMapping(index));
  });
}

/**
 * Save profile mappings
 */
async function saveMappings() {
  const mappings = [];
  
  document.querySelectorAll('.profile-mapping-item').forEach(item => {
    const keywords = item.querySelector('.mapping-keywords').value
      .split(',')
      .map(k => k.trim())
      .filter(k => k);
    const profileId = item.querySelector('.mapping-profile-select').value;
    
    if (keywords.length && profileId) {
      mappings.push({ eventKeywords: keywords, profileId });
    }
  });
  
  await chrome.runtime.sendMessage({
    type: 'UPDATE_CALENDAR_SETTINGS',
    settings: { profileMapping: mappings }
  });
}

/**
 * Delete a mapping
 */
async function deleteMapping(index) {
  const mappings = calendarSettings?.profileMapping || [];
  mappings.splice(index, 1);
  
  await chrome.runtime.sendMessage({
    type: 'UPDATE_CALENDAR_SETTINGS',
    settings: { profileMapping: mappings }
  });
  
  loadProfileMappings();
}

/**
 * Add a new mapping
 */
async function addMapping() {
  const mappings = calendarSettings?.profileMapping || [];
  mappings.push({
    eventKeywords: [],
    profileId: profiles[0]?.id || 'default'
  });
  
  await chrome.runtime.sendMessage({
    type: 'UPDATE_CALENDAR_SETTINGS',
    settings: { profileMapping: mappings }
  });
  
  calendarSettings.profileMapping = mappings;
  loadProfileMappings();
}

/**
 * Check for profile suggestion based on current events
 */
async function checkCalendarSuggestion() {
  const container = document.getElementById('calendar-suggestion');
  
  try {
    const suggestion = await chrome.runtime.sendMessage({ type: 'GET_SUGGESTED_PROFILE' });
    
    if (!suggestion) {
      container.classList.add('hidden');
      return;
    }
    
    const profile = profiles.find(p => p.id === suggestion.profileId);
    if (!profile) {
      container.classList.add('hidden');
      return;
    }
    
    document.getElementById('suggestion-text').textContent = 
      `Switch to "${profile.icon} ${profile.name}" for event: ${suggestion.event.title}`;
    
    container.classList.remove('hidden');
    container.dataset.profileId = suggestion.profileId;
  } catch (e) {
    console.error('Failed to check calendar suggestion:', e);
    container.classList.add('hidden');
  }
}

/**
 * Setup calendar event listeners
 */
function setupCalendarListeners() {
  // Connect button
  document.getElementById('connect-calendar-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('connect-calendar-btn');
    btn.disabled = true;
    btn.textContent = 'Connecting...';
    
    try {
      const result = await chrome.runtime.sendMessage({ type: 'CONNECT_GOOGLE_CALENDAR' });
      
      if (result.success) {
        calendarSettings = await chrome.runtime.sendMessage({ type: 'GET_CALENDAR_STATUS' });
        updateCalendarUI();
        showSaveStatus('Connected to Google Calendar');
      } else {
        showSaveStatus(`Failed to connect: ${result.error}`, true);
      }
    } catch (e) {
      showSaveStatus(`Connection error: ${e.message}`, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Connect Google Calendar';
    }
  });
  
  // Disconnect button
  document.getElementById('disconnect-calendar-btn')?.addEventListener('click', async () => {
    if (!confirm('Disconnect from Google Calendar? Your settings will be preserved but sync will stop.')) {
      return;
    }
    
    const result = await chrome.runtime.sendMessage({ type: 'DISCONNECT_GOOGLE_CALENDAR' });
    
    if (result.success) {
      calendarSettings = await chrome.runtime.sendMessage({ type: 'GET_CALENDAR_STATUS' });
      updateCalendarUI();
      showSaveStatus('Disconnected from Google Calendar');
    } else {
      showSaveStatus(`Failed to disconnect: ${result.error}`, true);
    }
  });
  
  // Sync toggle
  document.getElementById('calendar-sync-enabled')?.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    
    if (enabled) {
      await chrome.runtime.sendMessage({ type: 'START_CALENDAR_SYNC' });
    } else {
      await chrome.runtime.sendMessage({ type: 'STOP_CALENDAR_SYNC' });
    }
    
    await chrome.runtime.sendMessage({
      type: 'UPDATE_CALENDAR_SETTINGS',
      settings: { syncEnabled: enabled }
    });
    
    showSaveStatus(enabled ? 'Calendar sync enabled' : 'Calendar sync disabled');
  });
  
  // Auto-switch toggle
  document.getElementById('calendar-auto-switch')?.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    
    await chrome.runtime.sendMessage({
      type: 'UPDATE_CALENDAR_SETTINGS',
      settings: { autoSwitchProfiles: enabled }
    });
    
    // Show/hide mapping section
    const mappingSection = document.getElementById('profile-mapping-section');
    if (enabled) {
      mappingSection.classList.remove('hidden');
    } else {
      mappingSection.classList.add('hidden');
    }
    
    showSaveStatus(enabled ? 'Auto-switch enabled' : 'Auto-switch disabled');
  });
  
  // Add mapping button
  document.getElementById('add-mapping-btn')?.addEventListener('click', addMapping);
  
  // Refresh events button
  document.getElementById('refresh-events-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('refresh-events-btn');
    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;"></div> Refreshing...';
    
    await chrome.runtime.sendMessage({ type: 'GET_UPCOMING_EVENTS', days: 7 });
    calendarSettings = await chrome.runtime.sendMessage({ type: 'GET_CALENDAR_STATUS' });
    await loadTodayEvents();
    await checkCalendarSuggestion();
    
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  });
  
  // Apply suggestion button
  document.getElementById('apply-suggestion-btn')?.addEventListener('click', async () => {
    const container = document.getElementById('calendar-suggestion');
    const profileId = container.dataset.profileId;
    
    if (!profileId) return;
    
    await chrome.runtime.sendMessage({ type: 'SWITCH_PROFILE', profileId });
    
    showSaveStatus('Profile switched');
    container.classList.add('hidden');
    
    // Reload to reflect the change
    settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    populateSettings();
    await loadProfiles();
  });
  
  // Focus keyword add button
  document.getElementById('add-focus-keyword')?.addEventListener('click', async () => {
    const input = document.getElementById('focus-keyword-input');
    if (input && input.value.trim()) {
      await addKeywordTag('focus', input.value);
      input.value = '';
      input.focus();
    }
  });
  
  // Focus keyword input enter key
  document.getElementById('focus-keyword-input')?.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const input = e.target;
      if (input.value.trim()) {
        await addKeywordTag('focus', input.value);
        input.value = '';
      }
    }
  });
  
  // Break keyword add button
  document.getElementById('add-break-keyword')?.addEventListener('click', async () => {
    const input = document.getElementById('break-keyword-input');
    if (input && input.value.trim()) {
      await addKeywordTag('break', input.value);
      input.value = '';
      input.focus();
    }
  });
  
  // Break keyword input enter key
  document.getElementById('break-keyword-input')?.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const input = e.target;
      if (input.value.trim()) {
        await addKeywordTag('break', input.value);
        input.value = '';
      }
    }
  });
}
