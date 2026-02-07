/**
 * Focus Extension - Stats Page Logic
 */

// =============================================================================
// STATE
// =============================================================================

let currentTimeRange = 'week';

// =============================================================================
// INITIALIZATION
// =============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  // Load theme
  await loadTheme();
  
  // Initialize icons
  initializeIcons();
  
  // Initialize sidebar
  initializeSidebar();
  
  // Setup event listeners
  setupEventListeners();
  
  // Load all stats
  await loadAllStats();
});

// Initialize SVG icons
function initializeIcons() {
  // Overview stat icons
  const iconMappings = {
    'icon-focus': Icons.target,
    'icon-time': Icons.clock,
    'icon-streak': Icons.flame,
    'icon-xp': Icons.star,
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
  // Add icons to sidebar links
  const sidebarIcons = {
    'sidebar-icon-overview': Icons.home,
    'sidebar-icon-streak': Icons.flame,
    'sidebar-icon-achievements': Icons.trophy,
    'sidebar-icon-blocking': Icons.ban,
    'sidebar-icon-reasons': Icons.list,
    'sidebar-icon-xp': Icons.star,
    'sidebar-icon-history': Icons.eye,
  };
  
  for (const [id, iconSvg] of Object.entries(sidebarIcons)) {
    const el = document.getElementById(id);
    if (el) {
      el.innerHTML = iconSvg;
    }
  }
  
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
    'overview', 'streak', 'achievements', 'blocking', 'reasons', 'xp',
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

async function loadTheme() {
  try {
    const result = await chrome.storage.local.get('theme');
    if (result.theme && result.theme !== 'auto') {
      document.documentElement.setAttribute('data-theme', result.theme);
    }
  } catch (e) {
    console.error('Failed to load theme:', e);
  }
}

// =============================================================================
// EVENT LISTENERS
// =============================================================================

function setupEventListeners() {
  // Time range selector
  document.getElementById('time-range').addEventListener('change', async (e) => {
    currentTimeRange = e.target.value;
    await loadAllStats();
  });
  
  // Back button
  document.getElementById('back-btn').addEventListener('click', () => {
    window.close();
  });
}

// =============================================================================
// DATA LOADING
// =============================================================================

async function loadAllStats() {
  await Promise.all([
    loadOverviewStats(),
    loadStreakStats(),
    loadAchievements(),
    loadBlockingStats(),
    loadUnblockReasons(),
    loadXPHistory(),
    loadHistoryAnalysis()
  ]);
}

async function loadOverviewStats() {
  try {
    const focusStats = await chrome.runtime.sendMessage({ type: 'GET_FOCUS_SESSION_STATS' });
    const streakInfo = await chrome.runtime.sendMessage({ type: 'GET_STREAK_INFO' });
    const xpData = await chrome.runtime.sendMessage({ type: 'GET_XP_DATA' });
    
    // Get stats based on time range
    const allTimeStats = await chrome.runtime.sendMessage({ type: 'GET_ALL_TIME_STATS' });
    
    let sessions = 0;
    let minutes = 0;
    
    switch (currentTimeRange) {
      case 'today':
        sessions = focusStats?.todaySessions || 0;
        minutes = focusStats?.todayMinutes || 0;
        break;
      case 'week':
        sessions = focusStats?.weeklySessions || 0;
        minutes = focusStats?.weeklyMinutes || 0;
        break;
      case 'month':
        sessions = allTimeStats?.monthlySessions || focusStats?.weeklySessions || 0;
        minutes = allTimeStats?.monthlyMinutes || focusStats?.weeklyMinutes || 0;
        break;
      case 'all':
        sessions = allTimeStats?.totalSessions || 0;
        minutes = allTimeStats?.totalMinutes || 0;
        break;
    }
    
    document.getElementById('focus-sessions').textContent = sessions;
    document.getElementById('focus-minutes').textContent = minutes;
    document.getElementById('current-streak').textContent = streakInfo?.currentStreak || 0;
    document.getElementById('total-xp').textContent = xpData?.totalXpEarned || xpData?.xp || 0;
  } catch (e) {
    console.error('Failed to load overview stats:', e);
  }
}

async function loadStreakStats() {
  try {
    const streakInfo = await chrome.runtime.sendMessage({ type: 'GET_STREAK_INFO' });
    
    document.getElementById('longest-streak').textContent = streakInfo?.longestStreak || 0;
    
    if (streakInfo?.streakStartDate) {
      const startDate = new Date(streakInfo.streakStartDate);
      document.getElementById('streak-start').textContent = formatDate(startDate);
    } else {
      document.getElementById('streak-start').textContent = '-';
    }
    
    // Build streak calendar (last 28 days)
    buildStreakCalendar(streakInfo?.history || []);
  } catch (e) {
    console.error('Failed to load streak stats:', e);
  }
}

function buildStreakCalendar(history) {
  const graph = document.getElementById('streak-graph');
  graph.innerHTML = '';
  
  // Create a map of dates to focus status
  const focusMap = {};
  for (const day of history) {
    focusMap[day.date] = day.focused;
  }
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Calculate how many weeks to show (go back ~52 weeks, aligning to Sunday starts)
  const todayDay = today.getDay(); // 0=Sun
  const totalDays = 52 * 7 + todayDay + 1; // 52 full weeks + partial current week
  
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - totalDays + 1);
  
  // Build weeks array
  const weeks = [];
  let currentWeek = [];
  const tempDate = new Date(startDate);
  
  for (let i = 0; i < totalDays; i++) {
    currentWeek.push(new Date(tempDate));
    if (tempDate.getDay() === 6 || i === totalDays - 1) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
    tempDate.setDate(tempDate.getDate() + 1);
  }
  
  const numWeeks = weeks.length;
  
  // Set grid template: 1 col for day labels + 1 per week; auto row for months, equal rows for days, auto for legend
  graph.style.gridTemplateColumns = `28px repeat(${numWeeks}, 1fr)`;
  graph.style.gridTemplateRows = `auto repeat(7, 1fr) auto`;
  
  // Row 1: month labels
  // Empty corner cell for day-label column
  const corner = document.createElement('span');
  corner.className = 'graph-day-label';
  graph.appendChild(corner);
  
  // One month-label cell per week column
  let prevMonth = -1;
  for (let w = 0; w < numWeeks; w++) {
    const firstDay = weeks[w][0];
    const month = firstDay.getMonth();
    
    const cell = document.createElement('span');
    cell.className = 'graph-month-cell';
    
    if (month !== prevMonth) {
      cell.textContent = firstDay.toLocaleDateString('en-US', { month: 'short' });
      prevMonth = month;
    }
    
    graph.appendChild(cell);
  }
  
  // Rows 2-8: one per day of week (Sun=0 through Sat=6)
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  
  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
    // Day label
    const label = document.createElement('span');
    label.className = 'graph-day-label';
    if (dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5) {
      label.textContent = dayNames[dayOfWeek];
    }
    graph.appendChild(label);
    
    // One cell per week
    for (let w = 0; w < numWeeks; w++) {
      const cell = document.createElement('span');
      
      const matchingDay = weeks[w].find(d => d.getDay() === dayOfWeek);
      
      if (!matchingDay || matchingDay > today) {
        cell.className = 'graph-cell empty';
      } else {
        const dateStr = matchingDay.toDateString();
        const isToday = matchingDay.getTime() === today.getTime();
        
        if (focusMap[dateStr] === true) {
          cell.className = 'graph-cell focused';
        } else if (focusMap[dateStr] === false) {
          cell.className = 'graph-cell unfocused';
        } else {
          cell.className = 'graph-cell no-data';
        }
        
        if (isToday) {
          cell.classList.add('today');
        }
        
        const status = focusMap[dateStr] === true ? 'Focused' : focusMap[dateStr] === false ? 'Unfocused' : 'No data';
        cell.title = `${formatDate(matchingDay)} - ${status}`;
      }
      
      graph.appendChild(cell);
    }
  }
  
  // Legend (outside the grid)
  const legend = document.createElement('div');
  legend.className = 'graph-legend';
  legend.style.gridColumn = `1 / -1`;
  legend.innerHTML = `
    <span class="graph-legend-label">Less</span>
    <span class="graph-legend-cell no-data"></span>
    <span class="graph-legend-cell unfocused"></span>
    <span class="graph-legend-cell focused"></span>
    <span class="graph-legend-label">More</span>
  `;
  graph.appendChild(legend);
}

async function loadAchievements() {
  try {
    const achievementsData = await chrome.runtime.sendMessage({ type: 'GET_ACHIEVEMENTS' });
    
    if (!achievementsData) return;
    
    // Update progress bar
    const progress = (achievementsData.unlockedCount / achievementsData.totalCount) * 100;
    document.getElementById('achievements-fill').style.width = `${progress}%`;
    document.getElementById('achievements-text').textContent = 
      `${achievementsData.unlockedCount} / ${achievementsData.totalCount} unlocked`;
    
    // Build achievements grid
    const grid = document.getElementById('achievements-grid');
    grid.innerHTML = '';
    
    // Sort: unlocked first, then by name
    const sorted = [...achievementsData.achievements].sort((a, b) => {
      if (a.unlocked && !b.unlocked) return -1;
      if (!a.unlocked && b.unlocked) return 1;
      return a.name.localeCompare(b.name);
    });
    
    for (const achievement of sorted) {
      const item = document.createElement('div');
      item.className = `achievement-item ${achievement.unlocked ? 'unlocked' : 'locked'}`;
      
      item.innerHTML = `
        <div class="achievement-icon">${achievement.icon}</div>
        <div class="achievement-info">
          <div class="achievement-name">${achievement.name}</div>
          <div class="achievement-desc">${achievement.description}</div>
        </div>
      `;
      
      if (achievement.unlocked && achievement.unlockedAt) {
        item.title = `Unlocked ${formatDateTime(new Date(achievement.unlockedAt))}`;
      }
      
      grid.appendChild(item);
    }
  } catch (e) {
    console.error('Failed to load achievements:', e);
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
      
      topBlocked.innerHTML = `
        <div class="top-blocked-title">Most Unblocked Sites</div>
        ${sorted.map(([domain, count]) => `
          <div class="blocked-site">
            <span class="blocked-site-name">${domain}</span>
            <span class="blocked-site-count">${count} times</span>
          </div>
        `).join('')}
      `;
    } else {
      topBlocked.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-text">No unblock history yet</div>
        </div>
      `;
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
      recentEl.innerHTML = `
        <div class="recent-reasons-title">Recent Reasons</div>
        ${recent.map(r => `
          <div class="reason-item">
            <div class="reason-header">
              <span class="reason-domain">${r.domain}</span>
              <span class="reason-time">${formatRelativeTime(r.timestamp)}</span>
            </div>
            <div class="reason-text">${escapeHtml(r.reason)}</div>
          </div>
        `).join('')}
      `;
    } else {
      recentEl.innerHTML = '';
    }
  } catch (e) {
    console.error('Failed to load unblock reasons:', e);
  }
}

async function loadXPHistory() {
  try {
    const xpData = await chrome.runtime.sendMessage({ type: 'GET_XP_DATA' });
    const xpHistory = await chrome.runtime.sendMessage({ type: 'GET_XP_HISTORY' });
    
    document.getElementById('xp-level').textContent = xpData?.level || 1;
    document.getElementById('xp-to-next').textContent = xpData?.xpToNextLevel || 100;
    
    const listEl = document.getElementById('xp-history-list');
    
    if (xpHistory && xpHistory.length > 0) {
      const recent = xpHistory.slice(-20).reverse();
      listEl.innerHTML = recent.map(item => `
        <div class="xp-history-item">
          <div class="xp-history-info">
            <span class="xp-history-reason">${formatXPReason(item.reason)}</span>
            <span class="xp-history-time">${formatRelativeTime(item.timestamp)}</span>
          </div>
          <span class="xp-history-amount">+${item.amount} XP</span>
        </div>
      `).join('');
    } else {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-text">No XP history yet</div>
        </div>
      `;
    }
  } catch (e) {
    console.error('Failed to load XP history:', e);
  }
}

// =============================================================================
// UTILITIES
// =============================================================================

function formatDate(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateTime(date) {
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
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

function formatXPReason(reason) {
  const reasonLabels = {
    'complete_todo': 'Completed todo',
    'focused_day': 'Focused day',
    'focused_day_streak_3': 'Focused day (3-day streak)',
    'focused_day_streak_7': 'Focused day (7-day streak)',
    'focused_day_streak_14': 'Focused day (14-day streak)',
    'focused_day_streak_30': 'Focused day (30-day streak)',
    'blocked_attempt': 'Resisted temptation',
    'focus_session_25': 'Completed 25min session',
    'focus_session_50': 'Completed 50min session',
    'focus_session_15': 'Completed 15min session'
  };
  
  // Check for achievement reasons
  if (reason.startsWith('achievement_')) {
    const achievementId = reason.replace('achievement_', '');
    return `Achievement: ${achievementId.replace(/_/g, ' ')}`;
  }
  
  return reasonLabels[reason] || reason.replace(/_/g, ' ');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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
      historyData,
      productivityData,
      weeklyPatterns,
      suggestions
    ] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'ANALYZE_HISTORY', days: 7 }),
      chrome.runtime.sendMessage({ type: 'GET_PRODUCTIVITY_SCORE', days: 7 }),
      chrome.runtime.sendMessage({ type: 'GET_BROWSING_PATTERNS', days: 7 }),
      chrome.runtime.sendMessage({ type: 'GET_BLOCK_SUGGESTIONS' })
    ]);
    
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
  
  // Hide the divider before history-analysis
  const historyLink = document.querySelector('.sidebar-link[data-section="history-analysis"]');
  if (historyLink) {
    const historyItem = historyLink.closest('li');
    const prevSibling = historyItem?.previousElementSibling;
    if (prevSibling?.classList.contains('sidebar-divider')) {
      prevSibling.style.display = 'none';
    }
  }
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
  // Update grade
  const gradeEl = document.getElementById('productivity-grade');
  if (gradeEl) {
    gradeEl.textContent = data.grade || '-';
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
  
  // Category key to friendly name mapping
  const categoryNames = {
    socialMedia: 'Social Media',
    entertainment: 'Entertainment',
    news: 'News & Media',
    gaming: 'Gaming',
    shopping: 'Shopping',
    forums: 'Forums & Communities',
    productivity: 'Productivity',
    education: 'Education',
    email: 'Email'
  };
  
  container.innerHTML = sites.slice(0, 10).map((site, index) => {
    const rankClass = index < 3 ? ` rank-${index + 1}` : '';
    const categoryName = categoryNames[site.category] || site.category || 'Uncategorized';
    
    return `
      <div class="top-site-item">
        <span class="top-site-rank${rankClass}">${index + 1}</span>
        <div class="top-site-info">
          <div class="top-site-domain">${escapeHtml(site.domain)}</div>
          <div class="top-site-category">${escapeHtml(categoryName)}</div>
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
        <span style="margin-top: 8px;">No suggestions yet. Keep browsing and we'll identify distracting sites.</span>
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
  
  // Score-based achievement insight (show first if score is good)
  const score = productivityData.score || 0;
  if (score >= 80) {
    insights.push({
      type: 'achievement',
      title: 'Excellent Focus!',
      text: 'You\'re maintaining an outstanding balance of productive browsing. Keep it up!'
    });
  } else if (score >= 70) {
    insights.push({
      type: 'positive',
      title: 'Great Progress',
      text: 'You have a healthy balance of productive browsing habits.'
    });
  }
  
  // Top productive site
  if (insightsData.topProductiveSite) {
    insights.push({
      type: 'positive',
      title: 'Top Productive Site',
      text: `Your most visited productive site is ${insightsData.topProductiveSite}`
    });
  }
  
  // Peak hour insight
  if (insightsData.peakHourLabel) {
    insights.push({
      type: 'neutral',
      title: 'Peak Activity Time',
      text: `You're most active online around ${insightsData.peakHourLabel}`
    });
  }
  
  // Daily average insight
  if (insightsData.avgDailyVisits > 0) {
    insights.push({
      type: 'neutral',
      title: 'Daily Average',
      text: `You average ${insightsData.avgDailyVisits} site visits per day`
    });
  }
  
  // Top distracting site
  if (insightsData.topDistractingSite) {
    insights.push({
      type: 'warning',
      title: 'Biggest Distraction',
      text: `Your most visited distracting site is ${insightsData.topDistractingSite}`
    });
  }
  
  // Score-based warning
  if (score < 40) {
    insights.push({
      type: 'tip',
      title: 'Focus Tip',
      text: 'Consider blocking some of your most visited distracting sites to improve focus.'
    });
  } else if (score >= 40 && score < 60) {
    insights.push({
      type: 'tip',
      title: 'Room for Improvement',
      text: 'Try scheduling focused work sessions with distracting sites blocked.'
    });
  }
  
  // Total sites insight
  if (insightsData.uniqueSites > 0) {
    insights.push({
      type: 'neutral',
      title: 'Sites Visited',
      text: `You visited ${insightsData.uniqueSites} unique sites in the past week`
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
    warning: Icons.alertTriangle,
    achievement: Icons.trophy
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
