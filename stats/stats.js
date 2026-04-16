/**
 * Focus Extension - Stats Page Logic
 */

// =============================================================================
// STATE
// =============================================================================

// All overview stats show all-time values for consistency
let availableSiteCategories = {};

// =============================================================================
// INITIALIZATION
// =============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  // Load theme
  await loadTheme();

  // Keep the page in sync if theme settings change while stats is open
  chrome.storage.onChanged.addListener(handleStorageThemeChange);

  // Initialize icons
  initializeIcons();

  // Initialize sidebar
  initializeSidebar();

  // Setup event listeners
  setupEventListeners();

  // Load all stats
  await loadAllStats();
});

function handleStorageThemeChange(changes, areaName) {
  if (areaName !== 'local') return;

  if (changes.theme || changes.accentColor) {
    loadTheme();
  }
}

// Initialize SVG icons
function initializeIcons() {
  // Overview stat icons
  const iconMappings = {
    'icon-focus': Icons.target,
    'icon-time': Icons.clock,
    'icon-blocked': Icons.ban,
    'icon-unblocked': Icons.list,
    // Productivity breakdown icons
    'icon-productive': Icons.trendingUp,
    'icon-distracting': Icons.trendingDown,
    'icon-neutral': Icons.minus,
  };

  for (const [id, iconSvg] of Object.entries(iconMappings)) {
    const el = document.getElementById(id);
    if (el) {
      el.innerHTML = iconSvg;
    }
  }
}

// Initialize sidebar navigation
function initializeSidebar() {
  // Setup smooth scrolling for sidebar links
  const sidebarLinks = document.querySelectorAll('.sidebar-link');
  sidebarLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = link.getAttribute('href').slice(1);
      const targetEl = document.getElementById(targetId);

      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // Update active state
        sidebarLinks.forEach(l => l.classList.remove('active'));
        link.classList.add('active');
      }
    });
  });

  // Track scroll position to highlight active section
  const sections = [
    'overview', 'boundaries',
    'history-analysis', 'productivity-score', 'categories', 'hourly',
    'weekly', 'top-sites', 'suggestions', 'insights'
  ];

  let ticking = false;

  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        updateActiveSection(sections, sidebarLinks);
        ticking = false;
      });
      ticking = true;
    }
  });
}

// Update active section in sidebar based on scroll
function updateActiveSection(sections, sidebarLinks) {
  const scrollPos = window.scrollY + 100; // Offset for header

  let activeSection = sections[0];

  for (const sectionId of sections) {
    const section = document.getElementById(sectionId);
    if (section) {
      const sectionTop = section.offsetTop;
      if (scrollPos >= sectionTop) {
        activeSection = sectionId;
      }
    }
  }

  sidebarLinks.forEach(link => {
    const linkSection = link.getAttribute('data-section');
    if (linkSection === activeSection) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });
}

// =============================================================================
// THEME
// =============================================================================

const ACCENT_COLOR_CSS_VARIABLES = [
  '--indigo',
  '--indigo-foreground',
  '--indigo-hover',
  '--indigo-subtle',
  '--indigo-50',
  '--indigo-100',
  '--indigo-200',
  '--indigo-800',
  '--indigo-900'
];

function clearAccentColorOverrides() {
  const rootStyle = document.documentElement.style;
  ACCENT_COLOR_CSS_VARIABLES.forEach(variable => rootStyle.removeProperty(variable));
}

async function loadTheme() {
  try {
    const result = await chrome.storage.local.get(['theme', 'brutalistEnabled']);
    const base = result.theme || 'light';
    if (base && base !== 'auto') {
      const resolved = resolveThemeVariant(base);
      document.documentElement.setAttribute('data-theme', resolved);
    }
    if (result.brutalistEnabled) {
      await chrome.storage.local.remove('brutalistEnabled');
    }
    await applyAccentColorFromStorage();
  } catch (e) {
    console.error('Failed to load theme:', e);
  }
}

function resolveThemeVariant(base) {
  return base === 'dark' ? 'dashboard-dark' : 'dashboard-light';
}

/**
 * Load accent color from storage and apply as CSS custom properties.
 */
async function applyAccentColorFromStorage() {
  try {
    const result = await chrome.storage.local.get('accentColor');
    const hex = result.accentColor || '#6366f1';
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    if (theme.startsWith('dashboard')) {
      clearAccentColorOverrides();
      return;
    }

    const isDark = theme === 'dark';
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    const mix = (rgb, amt, dir) => {
      const t = dir === 'lighten' ? 255 : 0;
      return { r: rgb.r + (t - rgb.r) * amt, g: rgb.g + (t - rgb.g) * amt, b: rgb.b + (t - rgb.b) * amt };
    };
    const toHex = (r, g, b) => '#' + [r, g, b].map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
    const s = document.documentElement.style;
    const rgb = { r, g, b };

    if (isDark) {
      const lighter = mix(rgb, 0.25, 'lighten');
      const mainHex = toHex(lighter.r, lighter.g, lighter.b);
      const fgDark = (0.299 * lighter.r + 0.587 * lighter.g + 0.114 * lighter.b) / 255 > 0.5 ? '#09090b' : '#ffffff';
      s.setProperty('--indigo', mainHex);
      s.setProperty('--indigo-foreground', fgDark);
      s.setProperty('--indigo-hover', hex);
      s.setProperty('--indigo-subtle', `rgba(${r}, ${g}, ${b}, 0.15)`);
      const s50 = mix(rgb, 0.90, 'darken'), s100 = mix(rgb, 0.85, 'darken'), s200 = mix(rgb, 0.75, 'darken');
      const s800 = mix(rgb, 0.25, 'lighten'), s900 = mix(rgb, 0.40, 'lighten');
      s.setProperty('--indigo-50', toHex(s50.r, s50.g, s50.b));
      s.setProperty('--indigo-100', toHex(s100.r, s100.g, s100.b));
      s.setProperty('--indigo-200', toHex(s200.r, s200.g, s200.b));
      s.setProperty('--indigo-800', toHex(s800.r, s800.g, s800.b));
      s.setProperty('--indigo-900', toHex(s900.r, s900.g, s900.b));
    } else {
      const darker = mix(rgb, 0.15, 'darken');
      const fg = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? '#09090b' : '#ffffff';
      s.setProperty('--indigo', hex);
      s.setProperty('--indigo-foreground', fg);
      s.setProperty('--indigo-hover', toHex(darker.r, darker.g, darker.b));
      s.setProperty('--indigo-subtle', `rgba(${r}, ${g}, ${b}, 0.08)`);
      const s50 = mix(rgb, 0.92, 'lighten'), s100 = mix(rgb, 0.85, 'lighten'), s200 = mix(rgb, 0.72, 'lighten');
      const s800 = mix(rgb, 0.55, 'darken'), s900 = mix(rgb, 0.65, 'darken');
      s.setProperty('--indigo-50', toHex(s50.r, s50.g, s50.b));
      s.setProperty('--indigo-100', toHex(s100.r, s100.g, s100.b));
      s.setProperty('--indigo-200', toHex(s200.r, s200.g, s200.b));
      s.setProperty('--indigo-800', toHex(s800.r, s800.g, s800.b));
      s.setProperty('--indigo-900', toHex(s900.r, s900.g, s900.b));
    }
  } catch (e) {
    // Silently fail — default CSS values remain
  }
}

// =============================================================================
// EVENT LISTENERS
// =============================================================================

function setupEventListeners() {
  // Back button
  document.getElementById('back-btn').addEventListener('click', () => {
    window.close();
  });

  const topSitesList = document.getElementById('top-sites-list');
  topSitesList?.addEventListener('click', (event) => {
    const categorizeButton = event.target.closest('.top-site-categorize-btn');
    if (!categorizeButton) {
      return;
    }

    const topSiteItem = categorizeButton.closest('.top-site-item');
    topSiteItem?.classList.toggle('categorize-open');
    topSiteItem?.querySelector('.top-site-category-select')?.focus();
  });

  topSitesList?.addEventListener('change', async (event) => {
    const categorySelect = event.target.closest('.top-site-category-select');
    if (!categorySelect) {
      return;
    }

    const domain = categorySelect.dataset.domain;
    const category = categorySelect.value;
    if (!domain || !category) {
      return;
    }

    try {
      categorySelect.disabled = true;
      await chrome.runtime.sendMessage({
        type: 'SET_SITE_CATEGORY_OVERRIDE',
        domain,
        category
      });
      await loadHistoryAnalysis();
    } catch (error) {
      console.error('Failed to save site category override:', error);
      categorySelect.disabled = false;
    }
  });
}

// =============================================================================
// DATA LOADING
// =============================================================================

async function loadAllStats() {
  await Promise.all([
    loadOverviewStats(),
    loadBlockingStats(),
    loadUnblockReasons(),
    loadHistoryAnalysis()
  ]);
}

async function loadOverviewStats() {
  try {
    const [allTimeStats, settings, unblockReasons] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_ALL_TIME_STATS' }),
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }),
      chrome.runtime.sendMessage({ type: 'GET_UNBLOCK_REASONS' }),
    ]);

    document.getElementById('focus-sessions').textContent = allTimeStats?.totalSessions || 0;
    document.getElementById('focus-minutes').textContent = allTimeStats?.totalMinutes || 0;
    document.getElementById('blocked-sites').textContent = settings?.blockedSites?.length || 0;
    document.getElementById('unblock-count-overview').textContent = unblockReasons?.totalCount || 0;
  } catch (e) {
    console.error('Failed to load overview stats:', e);
  }
}

async function loadBlockingStats() {
  try {
    const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    const unblockReasons = await chrome.runtime.sendMessage({ type: 'GET_UNBLOCK_REASONS' });

    document.getElementById('total-blocks').textContent = settings?.blockedSites?.length || 0;
    document.getElementById('unblock-count').textContent = unblockReasons?.totalCount || 0;

    // Calculate total unblock minutes (estimate based on typical 5-15 min sessions)
    const estimatedMinutes = (unblockReasons?.totalCount || 0) * 10;
    document.getElementById('unblock-minutes').textContent = estimatedMinutes;

    // Top blocked domains
    const topBlocked = document.getElementById('top-blocked');
    const domainStats = unblockReasons?.domainStats || {};

    if (Object.keys(domainStats).length > 0) {
      const sorted = Object.entries(domainStats)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      topBlocked.innerHTML = sorted.map(([domain, count]) => `
        <div class="blocked-site-item">
          <span class="blocked-site-name">${escapeHtml(formatDomainLabel(domain))}</span>
          <span class="blocked-site-count">${count} times</span>
        </div>
      `).join('');
    } else {
      topBlocked.innerHTML = '<div class="empty-state-text">You have not unblocked any sites yet.</div>';
    }
  } catch (e) {
    console.error('Failed to load blocking stats:', e);
  }
}

async function loadUnblockReasons() {
  try {
    const unblockReasons = await chrome.runtime.sendMessage({ type: 'GET_UNBLOCK_REASONS' });

    // Category breakdown
    const chartEl = document.getElementById('reasons-chart');
    const categoryStats = unblockReasons?.categoryStats || {};

    const categoryLabels = {
      work: 'Work',
      research: 'Research',
      social: 'Social',
      entertainment: 'Entertainment',
      news: 'News',
      fomo: 'FOMO',
      other: 'Other'
    };

    if (Object.keys(categoryStats).length > 0) {
      chartEl.innerHTML = Object.entries(categoryStats)
        .sort((a, b) => b[1] - a[1])
        .map(([category, count]) => `
          <div class="reason-tag">
            ${categoryLabels[category] || category}
            <span class="reason-count">${count}</span>
          </div>
        `).join('');
    } else {
      chartEl.innerHTML = '<div class="empty-state-text">No reasons recorded</div>';
    }

    // Recent reasons
    const recentEl = document.getElementById('recent-reasons');
    const recentReasons = unblockReasons?.recentReasons || [];

    if (recentReasons.length > 0) {
      const recent = recentReasons.slice(-5).reverse();
      recentEl.innerHTML = recent.map(r => `
        <div class="reason-item">
          <div class="reason-header">
            <span class="reason-domain">${r.domain}</span>
            <span class="reason-time">${formatRelativeTime(r.timestamp)}</span>
          </div>
          <div class="reason-text">${escapeHtml(r.reason)}</div>
        </div>
      `).join('');
    } else {
      recentEl.innerHTML = '<div class="empty-state-text">No notes recorded yet.</div>';
    }
  } catch (e) {
    console.error('Failed to load unblock reasons:', e);
  }
}

// =============================================================================
// UTILITIES
// =============================================================================

function formatDate(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatRelativeTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return formatDate(new Date(timestamp));
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDomainLabel(domain) {
  if (typeof domain !== 'string') {
    return 'Unknown site';
  }

  const normalized = domain.trim().replace(/^www\./, '');
  return normalized || 'Unknown site';
}

// =============================================================================
// HISTORY ANALYSIS
// =============================================================================

// Inject icons into history card titles
function initHistoryCardIcons() {
  const titleIcons = {
    'title-category': Icons.folder,
    'title-hourly': Icons.clock,
    'title-weekly': Icons.calendar,
    'title-top-sites': Icons.star,
    'title-suggestions': Icons.ban,
    'title-insights': Icons.lightbulb
  };

  Object.entries(titleIcons).forEach(([id, icon]) => {
    const el = document.getElementById(id);
    if (el && !el.querySelector('svg')) {
      const currentText = el.innerHTML;
      el.innerHTML = icon + currentText;
    }
  });
}

async function loadHistoryAnalysis() {
  try {
    // Initialize card icons
    initHistoryCardIcons();

    // Check if history analysis is enabled in settings
    const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    if (settings?.historyAnalysisEnabled === false) {
      hideHistorySection();
      return;
    }

    // Check if history permission is available
    const hasPermission = await chrome.permissions.contains({ permissions: ['history'] });

    if (!hasPermission) {
      showHistoryPermissionRequest();
      return;
    }

    // Show loading state
    showHistoryLoading();

    // Load all history data in parallel
    const [
      siteCategories,
      historyData,
      productivityData,
      weeklyPatterns,
      suggestions
    ] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_SITE_CATEGORIES' }),
      chrome.runtime.sendMessage({ type: 'ANALYZE_HISTORY', days: 7 }),
      chrome.runtime.sendMessage({ type: 'GET_PRODUCTIVITY_SCORE', days: 7 }),
      chrome.runtime.sendMessage({ type: 'GET_BROWSING_PATTERNS', days: 7 }),
      chrome.runtime.sendMessage({ type: 'GET_BLOCK_SUGGESTIONS' })
    ]);

    availableSiteCategories = siteCategories || {};

    // Check for errors in responses
    if (historyData?.error) {
      console.error('History analysis error:', historyData.error);
      showHistoryError(historyData.error);
      return;
    }

    if (productivityData?.error) {
      console.error('Productivity score error:', productivityData.error);
    }

    if (weeklyPatterns?.error) {
      console.error('Browsing patterns error:', weeklyPatterns.error);
    }

    if (suggestions?.error) {
      console.error('Block suggestions error:', suggestions.error);
    }

    // Render all components
    if (productivityData && !productivityData.error) {
      renderProductivityScore(productivityData);
    }

    if (historyData?.categories) {
      renderCategoryBreakdown(historyData.categories);
    }

    if (historyData?.hourlyDistribution) {
      renderHourlyChart(historyData.hourlyDistribution);
    }

    if (weeklyPatterns && !weeklyPatterns.error) {
      renderWeeklyChart(weeklyPatterns);
    }

    if (historyData?.topDomains) {
      renderTopSites(historyData.topDomains);
    }

    if (suggestions && !suggestions.error) {
      renderBlockSuggestions(suggestions);
    }

    if (productivityData?.insights && !productivityData.error) {
      renderInsights(productivityData);
    }

  } catch (e) {
    console.error('Failed to load history analysis:', e);
    showHistoryError(e.message);
  }
}

function showHistoryLoading() {
  const containers = [
    'category-bars', 'hourly-chart', 'weekly-chart',
    'top-sites-list', 'suggestions-list', 'insights-list'
  ];

  containers.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.innerHTML = `
        <div class="history-loading">
          <div class="history-loading-spinner"></div>
          <span>Analyzing browsing history...</span>
        </div>
      `;
    }
  });
}

function showHistoryError(message) {
  const section = document.querySelector('.history-analysis-section');
  if (!section) return;

  const content = section.querySelector('.section-desc');
  if (content) {
    content.insertAdjacentHTML('afterend', `
      <div class="history-error">
        <div class="history-error-icon">${Icons.alertCircle}</div>
        <div class="history-error-text">Failed to analyze history: ${escapeHtml(message)}</div>
      </div>
    `);
  }
}

function hideHistorySection() {
  const section = document.querySelector('.history-analysis-section');
  if (section) {
    section.style.display = 'none';
  }

  // Also hide the sidebar items for history analysis
  const historySections = [
    'history-analysis', 'productivity-score', 'categories',
    'hourly', 'weekly', 'top-sites', 'suggestions', 'insights'
  ];

  historySections.forEach(sectionId => {
    const link = document.querySelector(`.sidebar-link[data-section="${sectionId}"]`);
    if (link) {
      const listItem = link.closest('li');
      if (listItem) {
        listItem.style.display = 'none';
      }
    }
  });

}

function showHistoryPermissionRequest() {
  const section = document.querySelector('.history-analysis-section');
  if (!section) return;

  // Hide all history cards
  const cards = section.querySelectorAll('.history-card, .productivity-score-card');
  cards.forEach(card => card.style.display = 'none');

  // Show permission request
  const desc = section.querySelector('.section-desc');
  if (desc) {
    desc.insertAdjacentHTML('afterend', `
      <div class="history-permission">
        <div class="history-permission-icon">${Icons.alertCircle}</div>
        <div class="history-permission-title">Permission Required</div>
        <div class="history-permission-desc">
          Grant browser history access to analyze your browsing patterns and get personalized suggestions.
        </div>
        <button class="history-permission-btn" id="grant-history-permission">
          Grant Permission
        </button>
      </div>
    `);

    document.getElementById('grant-history-permission')?.addEventListener('click', async () => {
      try {
        const granted = await chrome.permissions.request({ permissions: ['history'] });
        if (granted) {
          // Remove permission request and reload
          section.querySelector('.history-permission')?.remove();
          cards.forEach(card => card.style.display = '');
          await loadHistoryAnalysis();
        }
      } catch (e) {
        console.error('Failed to request permission:', e);
      }
    });
  }
}

function renderProductivityScore(data) {
  const descriptor = getFocusBalanceDescriptor(data.score || 0);

  // Update grade
  const gradeEl = document.getElementById('productivity-grade');
  if (gradeEl) {
    gradeEl.textContent = descriptor.label;
    gradeEl.className = 'productivity-grade grade-' + (data.grade || 'f').toLowerCase();
  }

  // Update score ring
  const ringFill = document.getElementById('productivity-ring-fill');
  const scoreValue = document.getElementById('productivity-score-value');

  if (ringFill && scoreValue) {
    const score = data.score || 0;
    scoreValue.textContent = score;

    // Set stroke-dasharray for circular progress
    ringFill.setAttribute('stroke-dasharray', `${score}, 100`);
    // Use setAttribute for SVG elements instead of className
    ringFill.setAttribute('class', 'productivity-ring-fill grade-' + (data.grade || 'f').toLowerCase());
  }

  // Update breakdown icons
  const productiveIcon = document.getElementById('icon-productive');
  const distractingIcon = document.getElementById('icon-distracting');
  const neutralIcon = document.getElementById('icon-neutral');

  if (productiveIcon) productiveIcon.innerHTML = Icons.trendingUp;
  if (distractingIcon) distractingIcon.innerHTML = Icons.trendingDown;
  if (neutralIcon) neutralIcon.innerHTML = Icons.minus;

  // Update breakdown percentages
  const breakdown = data.breakdown || {};
  const productive = breakdown.productiveVisits || breakdown.productive || 0;
  const distracting = breakdown.distractingVisits || breakdown.distracting || 0;
  const neutral = breakdown.neutralVisits || breakdown.neutral || 0;
  const total = productive + distracting + neutral;

  if (total > 0) {
    document.getElementById('productive-percent').textContent =
      Math.round((productive / total) * 100) + '%';
    document.getElementById('distracting-percent').textContent =
      Math.round((distracting / total) * 100) + '%';
    document.getElementById('neutral-percent').textContent =
      Math.round((neutral / total) * 100) + '%';
  }
}

function getFocusBalanceDescriptor(score) {
  if (score >= 80) return { label: 'Steady' };
  if (score >= 65) return { label: 'Good' };
  if (score >= 45) return { label: 'Mixed' };
  if (score >= 25) return { label: 'Drift' };
  return { label: 'Scattered' };
}

// Category icon mapping for SVG icons
const CATEGORY_ICONS = {
  socialMedia: Icons.messageCircle,
  entertainment: Icons.playCircle,
  news: Icons.newspaper,
  gaming: Icons.gamepad,
  shopping: Icons.shoppingCart,
  forums: Icons.users,
  productivity: Icons.zap,
  education: Icons.graduationCap,
  email: Icons.mail,
  uncategorized: Icons.folder
};

function renderCategoryBreakdown(categories) {
  const container = document.getElementById('category-bars');
  if (!container || !categories.length) {
    if (container) {
      container.innerHTML = '<div class="empty-state-text">No browsing data</div>';
    }
    return;
  }

  // Get max visits for scaling
  const maxVisits = Math.max(...categories.map(c => c.visits));

  container.innerHTML = categories.slice(0, 8).map(cat => {
    const icon = CATEGORY_ICONS[cat.key] || CATEGORY_ICONS.uncategorized;
    const color = cat.color || '#6b7280';
    // Create a lighter version of the color for gradient
    const colorLight = color + '99'; // Add some transparency

    return `
      <div class="category-bar-item">
        <span class="category-bar-icon" style="background-color: ${color}15; color: ${color};">
          ${icon}
        </span>
        <span class="category-bar-name">${escapeHtml(cat.name)}</span>
        <div class="category-bar-container">
          <div class="category-bar-fill" style="width: ${(cat.visits / maxVisits) * 100}%; --fill-color: ${color}; --fill-color-light: ${colorLight}; background: linear-gradient(90deg, ${color}, ${colorLight});"></div>
        </div>
        <span class="category-bar-value">${cat.visits} visits</span>
      </div>
    `;
  }).join('');
}

function renderHourlyChart(hourlyData) {
  const container = document.getElementById('hourly-chart');
  if (!container || !hourlyData.length) return;

  // Get max for scaling
  const maxVisits = Math.max(...hourlyData, 1);

  container.innerHTML = hourlyData.map((visits, hour) => {
    const height = (visits / maxVisits) * 100;
    const formattedHour = hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`;
    return `<div class="hourly-bar" style="height: ${Math.max(height, 2)}%" title="${formattedHour}: ${visits} visits"></div>`;
  }).join('');
}

function renderWeeklyChart(patterns) {
  const container = document.getElementById('weekly-chart');
  if (!container || !patterns) return;

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayData = patterns.dayOfWeek || [];

  // Get max visits for scaling
  const maxVisits = Math.max(...dayData.map(d => d.visits || 0), 1);

  container.innerHTML = days.map((day, index) => {
    const visits = dayData[index]?.visits || 0;
    const height = (visits / maxVisits) * 100;

    return `
      <div class="weekly-day">
        <div class="weekly-day-bar-container">
          <div class="weekly-day-bar" style="height: ${Math.max(height, 2)}%"></div>
        </div>
        <span class="weekly-day-label">${day}</span>
        <span class="weekly-day-value">${visits}</span>
      </div>
    `;
  }).join('');
}

function renderTopSites(sites) {
  const container = document.getElementById('top-sites-list');
  if (!container || !sites.length) {
    if (container) {
      container.innerHTML = '<div class="empty-state-text">No browsing data</div>';
    }
    return;
  }

  const categoryOptions = Object.entries(availableSiteCategories)
    .map(([key, category]) => `<option value="${escapeHtml(key)}">${escapeHtml(category.name)}</option>`)
    .join('');

  container.innerHTML = sites.slice(0, 10).map((site, index) => {
    const rankClass = index < 3 ? ` rank-${index + 1}` : '';
    const categoryName = availableSiteCategories[site.category]?.name || site.category || 'Uncategorized';
    const isUncategorized = !site.category;
    const isSuggested = site.categorySource === 'content-scan';
    const showCategoryEditor = isUncategorized || isSuggested;

    return `
      <div class="top-site-item${isUncategorized ? ' is-uncategorized' : ''}">
        <span class="top-site-rank${rankClass}">${index + 1}</span>
        <div class="top-site-info">
          <div class="top-site-domain">${escapeHtml(formatDomainLabel(site.domain))}</div>
          <div class="top-site-meta">
            <div class="top-site-category">${escapeHtml(categoryName)}</div>
            ${isSuggested ? `<span class="top-site-category-hint">Suggested</span>` : ''}
            ${showCategoryEditor ? `
              <button class="top-site-categorize-btn" type="button">
                ${isUncategorized ? 'Set category' : 'Change'}
              </button>
            ` : ''}
          </div>
          ${showCategoryEditor ? `
            <div class="top-site-categorize-panel">
              <label class="top-site-categorize-label" for="top-site-category-${index}">Category</label>
              <select id="top-site-category-${index}" class="top-site-category-select" data-domain="${escapeHtml(site.domain)}">
                <option value="">Choose one...</option>
                ${Object.entries(availableSiteCategories).map(([key, category]) => `
                  <option value="${escapeHtml(key)}" ${site.category === key ? 'selected' : ''}>${escapeHtml(category.name)}</option>
                `).join('')}
              </select>
            </div>
          ` : ''}
        </div>
        <span class="top-site-visits">${site.visits} visits</span>
      </div>
    `;
  }).join('');
}

function renderBlockSuggestions(suggestions) {
  const container = document.getElementById('suggestions-list');
  if (!container) return;

  if (!suggestions || !suggestions.length) {
    container.innerHTML = `
      <div class="empty-state-text">
        ${Icons.checkCircle}
        <span style="margin-top: 8px;">Nothing stands out yet. As patterns become clearer, this area will suggest sites you may want to fence off.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = suggestions.slice(0, 5).map(suggestion => `
    <div class="suggestion-item" data-domain="${escapeHtml(suggestion.domain)}">
      <div class="suggestion-info">
        <div class="suggestion-domain">${escapeHtml(suggestion.domain)}</div>
        <div class="suggestion-reason">${escapeHtml(suggestion.reason || 'Frequently visited distracting site')}</div>
      </div>
      <span class="suggestion-visits">${suggestion.visits} visits</span>
      <button class="suggestion-btn" data-domain="${escapeHtml(suggestion.domain)}">
        ${Icons.ban}
        <span>Block</span>
      </button>
    </div>
  `).join('');

  // Add click handlers for block buttons
  container.querySelectorAll('.suggestion-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const button = e.target.closest('.suggestion-btn');
      const domain = button?.dataset.domain;
      if (!domain) return;

      try {
        button.disabled = true;
        button.innerHTML = `${Icons.clock}<span>Blocking...</span>`;

        await chrome.runtime.sendMessage({
          type: 'ADD_BLOCKED_SITE',
          site: domain
        });

        button.innerHTML = `${Icons.checkCircle}<span>Blocked!</span>`;
        button.style.background = 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)';
        button.style.boxShadow = '0 2px 4px rgba(34, 197, 94, 0.3)';
        button.closest('.suggestion-item')?.classList.add('blocked');

        // Remove the item after a moment
        setTimeout(() => {
          const item = button.closest('.suggestion-item');
          if (item) {
            item.style.opacity = '0';
            item.style.transform = 'translateX(20px)';
            item.style.transition = 'all 0.3s ease';
            setTimeout(() => item.remove(), 300);
          }
        }, 1200);

      } catch (err) {
        console.error('Failed to block site:', err);
        button.disabled = false;
        button.innerHTML = `${Icons.ban}<span>Block</span>`;
      }
    });
  });
}

function renderInsights(productivityData) {
  const container = document.getElementById('insights-list');
  if (!container) return;

  // Generate insights from productivity data
  const insightsData = productivityData.insights || {};
  const insights = [];

  const score = productivityData.score || 0;
  if (score >= 80) {
    insights.push({
      type: 'positive',
      title: 'Your attention looked steady',
      text: 'Most of your recent browsing leaned productive. Notice what helped make that easier.'
    });
  } else if (score >= 70) {
    insights.push({
      type: 'positive',
      title: 'You had a solid balance',
      text: 'There was a healthy mix of productive browsing this week, with some room to tighten the edges.'
    });
  }

  if (insightsData.topProductiveSite) {
    insights.push({
      type: 'positive',
      title: 'Anchor site',
      text: `${insightsData.topProductiveSite} was the place you returned to most for productive work.`
    });
  }

  if (insightsData.peakHourLabel) {
    insights.push({
      type: 'neutral',
      title: 'Peak browsing window',
      text: `You were most active online around ${insightsData.peakHourLabel}. Ask whether that time felt intentional or reactive.`
    });
  }

  if (insightsData.avgDailyVisits > 0) {
    insights.push({
      type: 'neutral',
      title: 'Daily volume',
      text: `You averaged ${insightsData.avgDailyVisits} site visits per day over the last week.`
    });
  }

  if (insightsData.topDistractingSite) {
    insights.push({
      type: 'warning',
      title: 'Recurring distraction',
      text: `${insightsData.topDistractingSite} showed up as the clearest distraction pattern in your recent browsing.`
    });
  }

  if (score < 40) {
    insights.push({
      type: 'tip',
      title: 'A small next step',
      text: 'Pick one high-friction site and block it during the hours you most want to protect.'
    });
  } else if (score >= 40 && score < 60) {
    insights.push({
      type: 'tip',
      title: 'Where to tighten things up',
      text: 'Your patterns look mixed. A lighter blocklist or more intentional session timing could reduce drift.'
    });
  }

  if (insightsData.uniqueSites > 0) {
    insights.push({
      type: 'neutral',
      title: 'Attention spread',
      text: `You visited ${insightsData.uniqueSites} unique sites in the past week. More variety can mean exploration, but it can also mean fragmentation.`
    });
  }

  if (!insights.length) {
    container.innerHTML = `
      <div class="empty-state-text">
        ${Icons.info}
        <span style="margin-top: 8px;">Not enough data for insights yet. Check back after more browsing activity.</span>
      </div>
    `;
    return;
  }

  // Map insight types to icons
  const insightIcons = {
    positive: Icons.trendingUp,
    negative: Icons.trendingDown,
    neutral: Icons.info,
    tip: Icons.lightbulb,
    warning: Icons.alertTriangle
  };

  container.innerHTML = insights.map(insight => {
    const icon = insightIcons[insight.type] || Icons.info;
    return `
      <div class="insight-item insight-${insight.type}">
        <span class="insight-icon">${icon}</span>
        <div class="insight-content">
          <div class="insight-title">${escapeHtml(insight.title || '')}</div>
          <span class="insight-text">${escapeHtml(insight.text)}</span>
        </div>
      </div>
    `;
  }).join('');
}
