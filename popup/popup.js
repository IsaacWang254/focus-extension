/**
 * Focus Extension - Popup Logic
 */

import * as todoist from '../lib/todoist.js';

// =============================================================================
// STATE
// =============================================================================

let settings = null;
let currentDomain = null;
let sessionUpdateInterval = null;
let focusSessionInterval = null;

// Helper to get profile icon SVG (handles both old text codes and new icon IDs)
function getProfileIcon(iconCode) {
  // If it's a valid icon ID in the Icons object, use it
  if (typeof Icons !== 'undefined' && Icons[iconCode]) {
    return Icons[iconCode];
  }
  // Default to target icon
  return typeof Icons !== 'undefined' ? Icons.target : iconCode || '*';
}

// =============================================================================
// INITIALIZATION
// =============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  // Load theme first to avoid flash
  await loadTheme();
  
  // Initialize static icons
  initializeIcons();
  
  // Load settings
  settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  
  // Get current tab URL
  const tabInfo = await chrome.runtime.sendMessage({ type: 'GET_CURRENT_TAB_URL' });
  currentDomain = tabInfo.domain;
  
  // Update UI
  await updateUI();
  
  // Load profiles
  await loadProfiles();
  
  // Load active sessions
  await loadActiveSessions();
  
  // Load focus session
  await loadFocusSession();
  
  // Check Todoist status
  await checkTodoistStatus();
  
  // Check Google Calendar status
  await checkCalendarStatus();
  
  // Setup event listeners
  setupEventListeners();
  setupProfileListeners();
  
  // Update sessions every second
  sessionUpdateInterval = setInterval(loadActiveSessions, 1000);
  focusSessionInterval = setInterval(updateFocusSessionTimer, 1000);
});

// Initialize static SVG icons
function initializeIcons() {
  // Achievement icon (trophy)
  const achievementIcon = document.getElementById('achievement-icon');
  if (achievementIcon) {
    achievementIcon.innerHTML = Icons.trophy;
  }
  
  // Stats button icon (trending up / chart)
  const statsBtnIcon = document.getElementById('stats-btn-icon');
  if (statsBtnIcon) {
    statsBtnIcon.innerHTML = Icons.trendingUp;
  }
  
  // Settings button icon (gear)
  const settingsBtnIcon = document.getElementById('settings-btn-icon');
  if (settingsBtnIcon) {
    settingsBtnIcon.innerHTML = Icons.settings;
  }
}

// Clean up interval when popup closes
window.addEventListener('unload', () => {
  if (sessionUpdateInterval) {
    clearInterval(sessionUpdateInterval);
  }
  if (focusSessionInterval) {
    clearInterval(focusSessionInterval);
  }
});

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

// =============================================================================
// UI UPDATES
// =============================================================================

async function updateUI() {
  // Enabled toggle
  const enabledToggle = document.getElementById('enabled-toggle');
  enabledToggle.checked = settings.enabled;
  
  // XP and Level
  await updateXPDisplay();
  
  // Achievements count
  await updateAchievementsDisplay();
  
  // Status text
  const statusText = document.getElementById('status-text');
  const statusBar = document.querySelector('.status-bar');
  
  if (settings.enabled) {
    statusText.textContent = 'Blocking enabled';
    statusBar.classList.remove('disabled');
  } else {
    statusText.textContent = 'Blocking disabled';
    statusBar.classList.add('disabled');
  }
  
  // Mode badge
  const modeBadge = document.getElementById('mode-badge');
  if (settings.mode === 'blocklist') {
    modeBadge.textContent = 'Blocklist';
    modeBadge.classList.remove('allowlist');
  } else {
    modeBadge.textContent = 'Allowlist';
    modeBadge.classList.add('allowlist');
  }
  
  // Current domain
  document.getElementById('current-domain').textContent = currentDomain || 'N/A';
  
  // Site actions
  updateSiteActions();
  
  // Stats
  document.getElementById('blocked-count').textContent = settings.blockedSites.length;
  document.getElementById('allowed-count').textContent = settings.allowedSites.length;
  
  // Streak
  await updateStreakDisplay();
  
  // Schedule status
  updateScheduleStatus();
  
  // Daily limit status
  await updateDailyLimitStatus();
}

function updateSiteActions() {
  const blockBtn = document.getElementById('block-site-btn');
  const unblockBtn = document.getElementById('unblock-site-btn');
  const domainEl = document.getElementById('current-domain');
  
  if (!currentDomain || currentDomain === 'N/A' || currentDomain.includes('chrome')) {
    blockBtn.style.display = 'none';
    unblockBtn.style.display = 'none';
    domainEl?.classList.remove('blocked');
    return;
  }
  
  const isBlocked = settings.blockedSites.includes(currentDomain);
  const isAllowed = settings.allowedSites.includes(currentDomain);
  
  if (settings.mode === 'blocklist') {
    if (isBlocked) {
      blockBtn.style.display = 'none';
      unblockBtn.style.display = 'inline-flex';
      domainEl?.classList.add('blocked');
    } else {
      blockBtn.style.display = 'inline-flex';
      unblockBtn.style.display = 'none';
      domainEl?.classList.remove('blocked');
    }
  } else {
    // Allowlist mode
    if (isAllowed) {
      blockBtn.style.display = 'inline-flex';
      blockBtn.textContent = 'Remove from allowed';
      unblockBtn.style.display = 'none';
      domainEl?.classList.remove('blocked');
    } else {
      blockBtn.style.display = 'none';
      unblockBtn.style.display = 'inline-flex';
      unblockBtn.textContent = 'Allow this site';
      domainEl?.classList.add('blocked');
    }
  }
}

async function checkTodoistStatus() {
  const isAuthenticated = await todoist.isAuthenticated();
  const statusEl = document.getElementById('todoist-status');
  
  if (isAuthenticated) {
    statusEl.innerHTML = '<span class="dot connected"></span>Todoist';
    statusEl.classList.add('connected');
  } else {
    statusEl.innerHTML = '<span class="dot disconnected"></span>Todoist';
    statusEl.classList.remove('connected');
  }
}

async function checkCalendarStatus() {
  try {
    const result = await chrome.storage.local.get('calendarSettings');
    const calendarSettings = result.calendarSettings;
    const isConnected = calendarSettings?.connected || false;
    const statusEl = document.getElementById('calendar-status');
    
    if (isConnected) {
      statusEl.innerHTML = '<span class="dot connected"></span>Calendar';
      statusEl.classList.add('connected');
    } else {
      statusEl.innerHTML = '<span class="dot disconnected"></span>Calendar';
      statusEl.classList.remove('connected');
    }
  } catch (e) {
    console.error('Failed to check calendar status:', e);
  }
}

// =============================================================================
// ACTIVE SESSIONS
// =============================================================================

async function loadActiveSessions() {
  const sessions = await chrome.runtime.sendMessage({ type: 'GET_TEMP_UNBLOCKS' });
  const container = document.getElementById('active-sessions');
  const list = document.getElementById('session-list');
  
  if (sessions.length === 0) {
    container.style.display = 'none';
    return;
  }
  
  container.style.display = 'block';
  list.innerHTML = '';
  
  for (const session of sessions) {
    const item = document.createElement('li');
    item.className = 'session-item';
    
    let timeText, timeClass;
    if (session.expiry === 'unlimited') {
      timeText = '∞ Unlimited';
      timeClass = 'unlimited';
    } else {
      const remaining = session.remaining;
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      
      if (mins >= 60) {
        const hours = Math.floor(mins / 60);
        const remMins = mins % 60;
        timeText = `${hours}h ${remMins}m remaining`;
      } else if (mins > 0) {
        timeText = `${mins}m ${secs}s remaining`;
      } else {
        timeText = `${secs}s remaining`;
      }
      
      if (remaining <= 60000) {
        timeClass = 'danger';
      } else if (remaining <= 300000) {
        timeClass = 'warning';
      } else {
        timeClass = '';
      }
    }
    
    item.innerHTML = `
      <div class="session-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
      </div>
      <div class="session-info">
        <div class="session-domain">${session.domain}</div>
        <div class="session-time ${timeClass}">${timeText}</div>
      </div>
      <button class="session-end" data-domain="${session.domain}">End</button>
    `;
    
    list.appendChild(item);
  }
  
  // Add click handlers for end buttons
  list.querySelectorAll('.session-end').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const domain = e.target.dataset.domain;
      await chrome.runtime.sendMessage({ type: 'END_TEMP_UNBLOCK', domain });
      await loadActiveSessions();
    });
  });
}

// =============================================================================
// EVENT LISTENERS
// =============================================================================

function setupEventListeners() {
  // Enable/disable toggle
  document.getElementById('enabled-toggle').addEventListener('change', async (e) => {
    const result = await chrome.runtime.sendMessage({ type: 'TOGGLE_ENABLED' });
    settings.enabled = result.enabled;
    await updateUI();
  });
  
  // Block site button
  document.getElementById('block-site-btn').addEventListener('click', async () => {
    if (settings.mode === 'blocklist') {
      await chrome.runtime.sendMessage({
        type: 'ADD_BLOCKED_SITE',
        site: currentDomain
      });
      settings.blockedSites.push(currentDomain);
    } else {
      // In allowlist mode, "block" means remove from allowed
      await chrome.runtime.sendMessage({
        type: 'REMOVE_ALLOWED_SITE',
        site: currentDomain
      });
      settings.allowedSites = settings.allowedSites.filter(s => s !== currentDomain);
    }
    await updateUI();
  });
  
  // Unblock site button
  document.getElementById('unblock-site-btn').addEventListener('click', async () => {
    if (settings.mode === 'blocklist') {
      await chrome.runtime.sendMessage({
        type: 'REMOVE_BLOCKED_SITE',
        site: currentDomain
      });
      settings.blockedSites = settings.blockedSites.filter(s => s !== currentDomain);
    } else {
      // In allowlist mode, "unblock" means add to allowed
      await chrome.runtime.sendMessage({
        type: 'ADD_ALLOWED_SITE',
        site: currentDomain
      });
      settings.allowedSites.push(currentDomain);
    }
    await updateUI();
  });
  
  // Settings button
  document.getElementById('settings-btn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  
  // Stats button
  document.getElementById('stats-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('stats/stats.html') });
  });
  
  // Focus session preset buttons
  document.querySelectorAll('.focus-preset-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const sessionType = btn.dataset.type;
      await startFocusSession(sessionType);
    });
  });
  
  // Skip phase button
  document.getElementById('skip-phase-btn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'SKIP_FOCUS_PHASE' });
    await loadFocusSession();
  });
  
  // Stop session button
  document.getElementById('stop-session-btn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'STOP_FOCUS_SESSION' });
    await loadFocusSession();
  });
}

// =============================================================================
// SCHEDULE STATUS
// =============================================================================

function updateScheduleStatus() {
  const container = document.getElementById('schedule-status');
  const iconEl = document.getElementById('schedule-icon');
  const iconWrapper = document.getElementById('schedule-icon-wrapper');
  const textEl = document.getElementById('schedule-text');
  const detailEl = document.getElementById('schedule-detail');
  
  // Check if schedule is enabled
  if (!settings.schedule || !settings.schedule.enabled) {
    container.style.display = 'none';
    return;
  }
  
  // Check if there are any time windows configured
  if (!settings.schedule.allowedTimes || settings.schedule.allowedTimes.length === 0) {
    container.style.display = 'flex';
    iconEl.innerHTML = Icons.clock;
    textEl.textContent = 'Schedule: Always locked';
    detailEl.textContent = 'No time windows configured';
    iconWrapper.classList.remove('available');
    iconWrapper.classList.add('locked');
    return;
  }
  
  container.style.display = 'flex';
  
  const now = new Date();
  const currentDay = now.getDay();
  const isActiveDay = settings.schedule.activeDays && settings.schedule.activeDays.includes(currentDay);
  
  if (!isActiveDay) {
    // Not an active day - no restrictions
    iconEl.innerHTML = Icons.checkCircle;
    textEl.textContent = 'Schedule paused today';
    detailEl.textContent = getNextActiveDayText();
    iconWrapper.classList.remove('locked');
    iconWrapper.classList.add('available');
    return;
  }
  
  const inAllowedWindow = isInAllowedTimeWindow();
  
  if (inAllowedWindow) {
    // In allowed window - can unblock sites
    iconEl.innerHTML = Icons.checkCircle;
    textEl.textContent = 'Unblock methods available';
    detailEl.textContent = getWindowEndText();
    iconWrapper.classList.remove('locked');
    iconWrapper.classList.add('available');
  } else {
    // Outside allowed window - fully locked
    iconEl.innerHTML = Icons.clock;
    textEl.textContent = 'Schedule: Locked';
    const nextWindowText = getNextWindowText();
    detailEl.textContent = nextWindowText || 'No upcoming windows';
    iconWrapper.classList.remove('available');
    iconWrapper.classList.add('locked');
  }
}

function isInAllowedTimeWindow() {
  if (!settings.schedule.allowedTimes || settings.schedule.allowedTimes.length === 0) {
    return false;
  }
  
  const now = new Date();
  const currentTime = now.getHours() * 60 + now.getMinutes();
  
  for (const window of settings.schedule.allowedTimes) {
    const [startHour, startMin] = window.start.split(':').map(Number);
    const [endHour, endMin] = window.end.split(':').map(Number);
    
    const startTime = startHour * 60 + startMin;
    const endTime = endHour * 60 + endMin;
    
    if (currentTime >= startTime && currentTime < endTime) {
      return true;
    }
  }
  
  return false;
}

function getWindowEndText() {
  if (!settings.schedule.allowedTimes || settings.schedule.allowedTimes.length === 0) {
    return '';
  }
  
  const now = new Date();
  const currentTime = now.getHours() * 60 + now.getMinutes();
  
  for (const window of settings.schedule.allowedTimes) {
    const [startHour, startMin] = window.start.split(':').map(Number);
    const [endHour, endMin] = window.end.split(':').map(Number);
    
    const startTime = startHour * 60 + startMin;
    const endTime = endHour * 60 + endMin;
    
    if (currentTime >= startTime && currentTime < endTime) {
      return `Until ${formatTimeDisplay(endHour, endMin)}`;
    }
  }
  
  return '';
}

function getNextWindowText() {
  if (!settings.schedule.allowedTimes || settings.schedule.allowedTimes.length === 0) {
    return 'No time windows configured';
  }
  
  const now = new Date();
  const currentTime = now.getHours() * 60 + now.getMinutes();
  
  // Sort windows by start time
  const sortedWindows = [...settings.schedule.allowedTimes].sort((a, b) => {
    const [aHour, aMin] = a.start.split(':').map(Number);
    const [bHour, bMin] = b.start.split(':').map(Number);
    return (aHour * 60 + aMin) - (bHour * 60 + bMin);
  });
  
  // Find next window today
  const currentDay = now.getDay();
  const activeDays = settings.schedule.activeDays || [];
  
  // If today is an active day, check for later windows today
  if (activeDays.includes(currentDay)) {
    for (const window of sortedWindows) {
      const [startHour, startMin] = window.start.split(':').map(Number);
      const startTime = startHour * 60 + startMin;
      
      if (startTime > currentTime) {
        return `Opens at ${formatTimeDisplay(startHour, startMin)}`;
      }
    }
  }
  
  // No more windows today, find next active day
  for (let i = 1; i <= 7; i++) {
    const nextDay = (currentDay + i) % 7;
    if (activeDays.includes(nextDay)) {
      const dayName = i === 1 ? 'Tomorrow' : getDayName(nextDay);
      const firstWindow = sortedWindows[0];
      const [h, m] = firstWindow.start.split(':').map(Number);
      return `Opens ${dayName} at ${formatTimeDisplay(h, m)}`;
    }
  }
  
  return 'No upcoming windows';
}

function getNextActiveDayText() {
  const now = new Date();
  const currentDay = now.getDay();
  
  // Sort windows by start time for display
  const sortedWindows = [...settings.schedule.allowedTimes].sort((a, b) => {
    const [aHour, aMin] = a.start.split(':').map(Number);
    const [bHour, bMin] = b.start.split(':').map(Number);
    return (aHour * 60 + aMin) - (bHour * 60 + bMin);
  });
  
  for (let i = 1; i <= 7; i++) {
    const nextDay = (currentDay + i) % 7;
    if (settings.schedule.activeDays.includes(nextDay)) {
      const dayName = i === 1 ? 'Tomorrow' : getDayName(nextDay);
      if (sortedWindows.length > 0) {
        const firstWindow = sortedWindows[0];
        const [h, m] = firstWindow.start.split(':').map(Number);
        return `Resumes ${dayName} at ${formatTimeDisplay(h, m)}`;
      }
      return `Resumes ${dayName}`;
    }
  }
  
  return '';
}

function getDayName(dayIndex) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[dayIndex];
}

function formatTimeDisplay(hours, minutes) {
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const displayMinutes = minutes.toString().padStart(2, '0');
  return `${displayHours}:${displayMinutes} ${period}`;
}

// =============================================================================
// DAILY LIMIT STATUS
// =============================================================================

async function updateDailyLimitStatus() {
  const container = document.getElementById('daily-limit-status');
  const iconEl = document.getElementById('daily-limit-icon');
  const iconWrapper = document.getElementById('daily-limit-icon-wrapper');
  const textEl = document.getElementById('daily-limit-text');
  const detailEl = document.getElementById('daily-limit-detail');
  
  // Get daily usage info from background
  const usageInfo = await chrome.runtime.sendMessage({ type: 'GET_DAILY_USAGE' });
  
  // Check if daily limit is enabled
  if (!usageInfo || !usageInfo.enabled) {
    container.style.display = 'none';
    return;
  }
  
  container.style.display = 'flex';
  
  if (usageInfo.exceeded) {
    // Daily limit exceeded
    iconEl.innerHTML = Icons.clock;
    textEl.textContent = 'Daily limit reached';
    detailEl.textContent = `${usageInfo.usedMinutes} / ${usageInfo.limitMinutes} min used`;
    iconWrapper.classList.remove('available');
    iconWrapper.classList.add('locked');
  } else {
    // Daily limit not exceeded
    iconEl.innerHTML = Icons.clock;
    textEl.textContent = `${usageInfo.remainingMinutes} min remaining`;
    detailEl.textContent = `${usageInfo.usedMinutes} / ${usageInfo.limitMinutes} min used today`;
    iconWrapper.classList.remove('locked');
    iconWrapper.classList.add('available');
  }
}

// =============================================================================
// STREAK DISPLAY
// =============================================================================

async function updateStreakDisplay() {
  try {
    const streakInfo = await chrome.runtime.sendMessage({ type: 'GET_STREAK_INFO' });
    const streakEl = document.getElementById('streak-count');
    const streakCard = document.querySelector('.stat-card.streak-card');
    
    if (streakInfo) {
      streakEl.textContent = streakInfo.currentStreak;
      
      // Add fire emoji for streaks of 3+
      if (streakInfo.currentStreak >= 7) {
        streakEl.innerHTML = `${streakInfo.currentStreak} <span class="stat-fire">&#128293;</span>`;
      } else if (streakInfo.currentStreak >= 3) {
        streakEl.innerHTML = `${streakInfo.currentStreak} <span class="stat-fire small">&#128293;</span>`;
      }
      
      // Show if today is focused or broken
      if (!streakInfo.todayFocused) {
        streakCard?.classList.add('broken');
        streakCard && (streakCard.title = 'Streak at risk - too many unblocks today');
      } else {
        streakCard?.classList.remove('broken');
        streakCard && (streakCard.title = `Best: ${streakInfo.longestStreak} days`);
      }
    }
  } catch (e) {
    console.error('Failed to load streak info:', e);
  }
}

// =============================================================================
// XP DISPLAY
// =============================================================================

async function updateXPDisplay() {
  try {
    const xpData = await chrome.runtime.sendMessage({ type: 'GET_XP_DATA' });
    
    if (xpData) {
      // Update level badge
      document.getElementById('level-number').textContent = xpData.level;
      document.getElementById('level-name').textContent = xpData.levelName;
      
      // Update XP bar
      document.getElementById('xp-fill').style.width = `${xpData.xpProgress}%`;
      document.getElementById('xp-current').textContent = xpData.xp;
      
      if (xpData.maxLevel) {
        document.getElementById('xp-next').textContent = 'MAX';
        document.getElementById('xp-bar-container').classList.add('max-level');
      } else {
        document.getElementById('xp-next').textContent = xpData.xp + xpData.xpToNextLevel;
      }
      
      // Update level badge tooltip
      document.getElementById('level-badge').title = `Level ${xpData.level}: ${xpData.levelName}`;
    }
  } catch (e) {
    console.error('Failed to load XP data:', e);
  }
}

// =============================================================================
// ACHIEVEMENTS DISPLAY
// =============================================================================

async function updateAchievementsDisplay() {
  try {
    const achievementsData = await chrome.runtime.sendMessage({ type: 'GET_ACHIEVEMENTS' });
    
    if (achievementsData) {
      const countEl = document.getElementById('achievement-count');
      countEl.textContent = `${achievementsData.unlockedCount}/${achievementsData.totalCount}`;
      
      // Update tooltip with most recent achievement
      const unlockedAchievements = achievementsData.achievements.filter(a => a.unlocked);
      if (unlockedAchievements.length > 0) {
        // Sort by unlock time, most recent first
        unlockedAchievements.sort((a, b) => (b.unlockedAt || 0) - (a.unlockedAt || 0));
        const mostRecent = unlockedAchievements[0];
        document.getElementById('achievements-badge').title = `Latest: ${mostRecent.icon} ${mostRecent.name}`;
      } else {
        document.getElementById('achievements-badge').title = 'No achievements yet';
      }
    }
  } catch (e) {
    console.error('Failed to load achievements:', e);
  }
}

// =============================================================================
// FOCUS SESSION
// =============================================================================

let currentFocusSession = null;

async function loadFocusSession() {
  try {
    const session = await chrome.runtime.sendMessage({ type: 'GET_FOCUS_SESSION' });
    const stats = await chrome.runtime.sendMessage({ type: 'GET_FOCUS_SESSION_STATS' });
    currentFocusSession = session;
    
    const activeEl = document.getElementById('focus-session-active');
    const startEl = document.getElementById('focus-session-start');
    const todayText = document.getElementById('focus-today-text');
    
    // Update today's stats
    if (stats) {
      const sessionsText = stats.todaySessions === 1 ? 'session' : 'sessions';
      todayText.textContent = `${stats.todaySessions} ${sessionsText} today (${stats.todayMinutes} min)`;
    }
    
    if (session && session.active) {
      // Show active session
      activeEl.style.display = 'block';
      startEl.style.display = 'none';
      
      // Update phase display
      updateFocusSessionDisplay(session);
    } else {
      // Show start buttons
      activeEl.style.display = 'none';
      startEl.style.display = 'block';
    }
  } catch (e) {
    console.error('Failed to load focus session:', e);
  }
}

function updateFocusSessionDisplay(session) {
  if (!session || !session.active) return;
  
  const phaseEl = document.getElementById('focus-phase');
  const timeEl = document.getElementById('focus-time');
  const progressEl = document.getElementById('focus-progress-fill');
  const countEl = document.getElementById('focus-sessions-count');
  
  // Update phase label
  const phaseLabels = {
    'work': 'Focus',
    'break': 'Break',
    'longBreak': 'Long Break'
  };
  phaseEl.textContent = phaseLabels[session.phase] || 'Focus';
  phaseEl.className = `focus-phase-badge ${session.phase}`;
  
  // Update time remaining
  const remainingMs = Math.max(0, session.endTime - Date.now());
  const remainingMins = Math.floor(remainingMs / 60000);
  const remainingSecs = Math.floor((remainingMs % 60000) / 1000);
  timeEl.textContent = `${remainingMins.toString().padStart(2, '0')}:${remainingSecs.toString().padStart(2, '0')}`;
  
  // Update progress bar
  const presets = {
    pomodoro: { workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, sessionsBeforeLongBreak: 4 },
    short: { workMinutes: 15, breakMinutes: 3, longBreakMinutes: 10, sessionsBeforeLongBreak: 4 },
    long: { workMinutes: 50, breakMinutes: 10, longBreakMinutes: 20, sessionsBeforeLongBreak: 3 }
  };
  const preset = presets[session.type] || presets.pomodoro;
  
  let totalMs;
  if (session.phase === 'work') {
    const workMinutes = session.customMinutes || preset.workMinutes;
    totalMs = workMinutes * 60 * 1000;
  } else if (session.phase === 'longBreak') {
    totalMs = preset.longBreakMinutes * 60 * 1000;
  } else {
    totalMs = preset.breakMinutes * 60 * 1000;
  }
  
  const progress = ((totalMs - remainingMs) / totalMs) * 100;
  progressEl.style.width = `${Math.min(100, progress)}%`;
  
  // Update session count
  const sessionsBeforeLongBreak = preset.sessionsBeforeLongBreak;
  countEl.textContent = `Session ${session.sessionsCompleted + 1}/${sessionsBeforeLongBreak}`;
}

function updateFocusSessionTimer() {
  if (currentFocusSession && currentFocusSession.active) {
    // Check if session has ended
    if (currentFocusSession.endTime && currentFocusSession.endTime <= Date.now()) {
      // Session ended, reload to get new state
      loadFocusSession();
    } else {
      updateFocusSessionDisplay(currentFocusSession);
    }
  }
}

async function startFocusSession(sessionType) {
  try {
    const session = await chrome.runtime.sendMessage({ 
      type: 'START_FOCUS_SESSION', 
      sessionType 
    });
    
    if (session && session.active) {
      currentFocusSession = session;
      await loadFocusSession();
    }
  } catch (e) {
    console.error('Failed to start focus session:', e);
  }
}

// =============================================================================
// PROFILES
// =============================================================================

async function loadProfiles() {
  try {
    const profiles = await chrome.runtime.sendMessage({ type: 'GET_PROFILES' });
    const activeProfile = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_PROFILE' });
    
    // Hide profile switcher if only one profile exists
    const profileSwitcher = document.getElementById('profile-switcher');
    if (profileSwitcher) {
      if (!profiles || profiles.length <= 1) {
        profileSwitcher.style.display = 'none';
        return;
      } else {
        profileSwitcher.style.display = '';
      }
    }
    
    // Update current profile display
    const iconEl = document.getElementById('profile-icon');
    const nameEl = document.getElementById('profile-name');
    const currentBtn = document.getElementById('profile-current');
    
    if (activeProfile) {
      iconEl.innerHTML = getProfileIcon(activeProfile.icon);
      nameEl.textContent = activeProfile.name || 'Default';
      currentBtn.style.setProperty('--profile-color', activeProfile.color || '#6366f1');
    }
    
    // Render profile menu
    renderProfileMenu(profiles, activeProfile?.id);
  } catch (e) {
    console.error('Failed to load profiles:', e);
  }
}

function renderProfileMenu(profiles, activeProfileId) {
  const menu = document.getElementById('profile-menu');
  
  if (!profiles || profiles.length === 0) {
    menu.innerHTML = '<div class="profile-option">No profiles available</div>';
    return;
  }
  
  menu.innerHTML = profiles.map(profile => {
    const isActive = profile.id === activeProfileId;
    const siteCount = (profile.blockedSites || []).length;
    const profileIcon = getProfileIcon(profile.icon);
    
    return `
      <button class="profile-option ${isActive ? 'active' : ''}" data-profile-id="${profile.id}">
        <span class="profile-option-icon">${profileIcon}</span>
        <span class="profile-option-name">${escapeHtml(profile.name)}</span>
        <span class="profile-option-meta">${siteCount} sites</span>
      </button>
    `;
  }).join('');
}

function setupProfileListeners() {
  const dropdown = document.getElementById('profile-dropdown');
  const currentBtn = document.getElementById('profile-current');
  const menu = document.getElementById('profile-menu');
  
  // Toggle dropdown
  currentBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });
  
  // Close dropdown when clicking outside
  document.addEventListener('click', () => {
    dropdown.classList.remove('open');
  });
  
  // Profile option clicks
  menu.addEventListener('click', async (e) => {
    const option = e.target.closest('.profile-option');
    if (option && !option.classList.contains('active')) {
      const profileId = option.dataset.profileId;
      await switchProfile(profileId);
      dropdown.classList.remove('open');
    }
  });
}

async function switchProfile(profileId) {
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'SET_ACTIVE_PROFILE',
      profileId
    });
    
    if (result.success) {
      // Reload settings with new profile
      settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      
      // Update UI
      await loadProfiles();
      await updateUI();
    }
  } catch (e) {
    console.error('Failed to switch profile:', e);
  }
}

// Utility function to escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
