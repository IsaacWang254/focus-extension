/**
 * Focus Extension - Simplified Popup Logic
 */

// =============================================================================
// STATE
// =============================================================================

let settings = null;
let currentDomain = null;
let sessionUpdateInterval = null;
let focusSessionInterval = null;
let selectedPresetType = 'pomodoro';
let cachedPresets = null;

// =============================================================================
// INITIALIZATION
// =============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  await loadTheme();
  setupBrowserThemeSyncListener();
  settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });

  const tabInfo = await chrome.runtime.sendMessage({ type: 'GET_CURRENT_TAB_URL' });
  currentDomain = tabInfo.domain;

  await updateUI();
  await loadProfiles();
  await loadAlerts();
  await loadActiveSessions();
  await loadFocusPresets();
  await loadFocusSession();

  setupEventListeners();

  sessionUpdateInterval = setInterval(loadActiveSessions, 2000);
  focusSessionInterval = setInterval(updateFocusTimer, 1000);
});

window.addEventListener('unload', () => {
  if (sessionUpdateInterval) clearInterval(sessionUpdateInterval);
  if (focusSessionInterval) clearInterval(focusSessionInterval);
});

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
    const result = await chrome.storage.local.get(['theme', 'brutalistEnabled', 'themeSyncWithBrowser']);
    const base = getEffectiveThemeBase(result.theme || 'light', result.themeSyncWithBrowser !== false);
    if (!result.theme) await chrome.storage.local.set({ theme: 'light' });
    const resolved = resolveThemeVariant(base);
    document.documentElement.setAttribute('data-theme', resolved);
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

function getBrowserThemeBase() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getEffectiveThemeBase(base, syncWithBrowser) {
  return syncWithBrowser ? getBrowserThemeBase() : base;
}

function isThemeSyncEnabled(value) {
  return value !== false;
}

function setupBrowserThemeSyncListener() {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', async () => {
    const result = await chrome.storage.local.get('themeSyncWithBrowser');
    if (!isThemeSyncEnabled(result.themeSyncWithBrowser)) return;
    await loadTheme();
  });
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
    const fg = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? '#09090b' : '#ffffff';
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
// UI UPDATES
// =============================================================================

async function updateUI() {
  const statusText = document.getElementById('status-text');
  const statusEl = document.getElementById('status');
  statusText.textContent = 'Blocking enabled';
  statusEl.classList.remove('disabled');

  const modeBadge = document.getElementById('mode-badge');
  if (settings.mode === 'blocklist') {
    modeBadge.textContent = 'Blocklist';
    modeBadge.classList.remove('allowlist');
  } else {
    modeBadge.textContent = 'Allowlist';
    modeBadge.classList.add('allowlist');
  }

  document.getElementById('current-domain').textContent = currentDomain || '-';
  document.getElementById('current-domain').classList.toggle('blocked', isCurrentSiteBlocked());
  updateSiteActions();
}

function isCurrentSiteBlocked() {
  if (!currentDomain || currentDomain === 'N/A' || currentDomain.includes('chrome')) return false;
  if (settings.mode === 'blocklist') return settings.blockedSites.includes(currentDomain);
  return !settings.allowedSites.includes(currentDomain);
}

function updateSiteActions() {
  const blockBtn = document.getElementById('block-site-btn');
  const unblockBtn = document.getElementById('unblock-site-btn');

  if (!currentDomain || currentDomain === 'N/A' || currentDomain.includes('chrome')) {
    blockBtn.style.display = 'none';
    unblockBtn.style.display = 'none';
    return;
  }

  const isBlocked = settings.blockedSites.includes(currentDomain);
  const isAllowed = settings.allowedSites.includes(currentDomain);

  if (settings.mode === 'blocklist') {
    blockBtn.style.display = isBlocked ? 'none' : 'inline-flex';
    blockBtn.textContent = 'Block';
    unblockBtn.style.display = isBlocked ? 'inline-flex' : 'none';
    unblockBtn.textContent = 'Unblock';
  } else {
    blockBtn.style.display = isAllowed ? 'inline-flex' : 'none';
    blockBtn.textContent = 'Remove';
    unblockBtn.style.display = isAllowed ? 'none' : 'inline-flex';
    unblockBtn.textContent = 'Allow';
  }
}

// =============================================================================
// ALERTS (Schedule & Daily Limit)
// =============================================================================

async function isIncognitoAccessAllowed() {
  if (!chrome.extension || typeof chrome.extension.isAllowedIncognitoAccess !== 'function') {
    return true;
  }

  return new Promise((resolve) => {
    try {
      chrome.extension.isAllowedIncognitoAccess((isAllowedAccess) => {
        if (chrome.runtime.lastError) {
          console.warn('Failed to check incognito access:', chrome.runtime.lastError.message);
          resolve(true);
          return;
        }

        resolve(Boolean(isAllowedAccess));
      });
    } catch (e) {
      console.warn('Incognito access check unavailable:', e);
      resolve(true);
    }
  });
}

function renderIncognitoAlert(container) {
  const el = document.createElement('div');
  el.className = 'alert-item incognito-alert';
  el.innerHTML = `
    <span class="incognito-alert-text">Enable "Allow in Incognito" so your blocks apply in private windows too.</span>
    <button type="button" class="btn btn-small btn-secondary incognito-alert-btn">Enable</button>
  `;

  const button = el.querySelector('.incognito-alert-btn');
  button?.addEventListener('click', async () => {
    try {
      await chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
    } catch (e) {
      console.error('Failed to open extension settings:', e);
    }
  });

  container.appendChild(el);
}

async function loadAlerts() {
  const container = document.getElementById('alerts');
  container.innerHTML = '';

  const incognitoAllowed = await isIncognitoAccessAllowed();
  if (!incognitoAllowed) {
    renderIncognitoAlert(container);
  }

  // Schedule status
  if (settings.schedule?.enabled) {
    const allowedTimes = settings.schedule.allowedTimes || [];
    if (allowedTimes.length === 0) {
      const el = document.createElement('div');
      el.className = 'alert-item locked';
      el.textContent = 'Schedule: Always locked';
      container.appendChild(el);
      return;
    }
    const now = new Date();
    const currentDay = now.getDay();
    const isActiveDay = settings.schedule.activeDays?.includes(currentDay);
    if (isActiveDay && !isInAllowedTimeWindow()) {
      const el = document.createElement('div');
      el.className = 'alert-item locked';
      el.textContent = 'Schedule locked';
      container.appendChild(el);
      return;
    }
  }

  // Daily limit
  const usageInfo = await chrome.runtime.sendMessage({ type: 'GET_DAILY_USAGE' });
  if (usageInfo?.enabled) {
    const el = document.createElement('div');
    el.className = usageInfo.exceeded ? 'alert-item locked' : 'alert-item';
    el.textContent = usageInfo.exceeded
      ? `Daily limit reached (${usageInfo.usedMinutes}/${usageInfo.limitMinutes} min)`
      : `${usageInfo.remainingMinutes} min remaining today`;
    container.appendChild(el);
  }
}

function isInAllowedTimeWindow() {
  if (!settings.schedule?.allowedTimes?.length) return false;
  const now = new Date();
  const currentTime = now.getHours() * 60 + now.getMinutes();

  for (const window of settings.schedule.allowedTimes) {
    const [startHour, startMin] = window.start.split(':').map(Number);
    const [endHour, endMin] = window.end.split(':').map(Number);
    const startTime = startHour * 60 + startMin;
    const endTime = endHour * 60 + endMin;
    if (currentTime >= startTime && currentTime < endTime) return true;
  }
  return false;
}

// =============================================================================
// ACTIVE SESSIONS (Temp Unblocks)
// =============================================================================

async function loadActiveSessions() {
  const sessions = await chrome.runtime.sendMessage({ type: 'GET_TEMP_UNBLOCKS' });
  const container = document.getElementById('active-sessions');
  const summaryEl = document.getElementById('sessions-summary');

  if (sessions.length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'flex';
  const first = sessions[0].label || (sessions[0].domain === '__all__' ? 'All blocked sites' : sessions[0].domain);
  summaryEl.textContent = sessions.length === 1
    ? `${first} temporarily unblocked`
    : `${first} +${sessions.length - 1} more unblocked`;
  document.getElementById('end-session-btn').textContent = sessions.length > 1 ? 'End all' : 'End';
}

// =============================================================================
// PROFILES
// =============================================================================

async function loadProfiles() {
  try {
    const profiles = await chrome.runtime.sendMessage({ type: 'GET_PROFILES' });
    const activeProfile = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_PROFILE' });
    const profileRow = document.getElementById('profile-switcher');
    const select = document.getElementById('profile-select');

    if (!profiles || profiles.length <= 1) {
      profileRow.classList.remove('visible');
      return;
    }

    profileRow.classList.add('visible');
    select.innerHTML = profiles.map(p =>
      `<option value="${p.id}" ${p.id === activeProfile?.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
    ).join('');
  } catch (e) {
    console.error('Failed to load profiles:', e);
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
  document.getElementById('block-site-btn').addEventListener('click', async () => {
    if (settings.mode === 'blocklist') {
      await chrome.runtime.sendMessage({ type: 'ADD_BLOCKED_SITE', site: currentDomain });
      settings.blockedSites.push(currentDomain);
    } else {
      await chrome.runtime.sendMessage({ type: 'REMOVE_ALLOWED_SITE', site: currentDomain });
      settings.allowedSites = settings.allowedSites.filter(s => s !== currentDomain);
    }
    await updateUI();
  });

  document.getElementById('unblock-site-btn').addEventListener('click', async () => {
    if (settings.mode === 'blocklist') {
      await chrome.runtime.sendMessage({ type: 'REMOVE_BLOCKED_SITE', site: currentDomain });
      settings.blockedSites = settings.blockedSites.filter(s => s !== currentDomain);
    } else {
      await chrome.runtime.sendMessage({ type: 'ADD_ALLOWED_SITE', site: currentDomain });
      settings.allowedSites.push(currentDomain);
    }
    await updateUI();
  });

  document.getElementById('profile-select').addEventListener('change', async (e) => {
    const profileId = e.target.value;
    const result = await chrome.runtime.sendMessage({ type: 'SET_ACTIVE_PROFILE', profileId });
    if (result?.success) {
      settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      await updateUI();
      await loadProfiles();
    }
  });

  document.getElementById('end-session-btn').addEventListener('click', async () => {
    const sessions = await chrome.runtime.sendMessage({ type: 'GET_TEMP_UNBLOCKS' });
    for (const s of sessions) {
      await chrome.runtime.sendMessage({ type: 'END_TEMP_UNBLOCK', domain: s.domain });
    }
    await loadActiveSessions();
  });

  document.getElementById('settings-link').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('stats-link').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('stats/stats.html') });
  });

  // Focus session preset selection
  document.getElementById('focus-presets').addEventListener('click', (e) => {
    const btn = e.target.closest('.focus-preset-btn');
    if (btn) {
      document.querySelectorAll('.focus-preset-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedPresetType = btn.dataset.type;
    }
  });

  document.getElementById('start-focus-btn').addEventListener('click', startFocusSession);

  document.getElementById('skip-phase-btn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'SKIP_FOCUS_PHASE' });
    await loadFocusSession();
  });

  document.getElementById('stop-session-btn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'STOP_FOCUS_SESSION' });
    await loadFocusSession();
  });
}

// =============================================================================
// FOCUS SESSION
// =============================================================================

async function loadFocusPresets() {
  cachedPresets = await chrome.runtime.sendMessage({ type: 'GET_FOCUS_PRESETS' });
  const container = document.getElementById('focus-presets');
  if (!container || !cachedPresets) return;

  const config = [
    { type: 'pomodoro', label: 'Pomodoro' },
    { type: 'short', label: 'Short' },
    { type: 'long', label: 'Long' }
  ];

  container.innerHTML = config.map(({ type, label }) => {
    const preset = cachedPresets[type] || cachedPresets.pomodoro;
    const isSelected = type === selectedPresetType ? ' selected' : '';
    return `
      <button type="button" class="focus-preset-btn${isSelected}" data-type="${type}">
        <span class="preset-time">${preset.workMinutes}</span>
        <span class="preset-label">${label}</span>
      </button>
    `;
  }).join('');
}

async function loadFocusSession() {
  const session = await chrome.runtime.sendMessage({ type: 'GET_FOCUS_SESSION' });
  const activeEl = document.getElementById('focus-active');
  const startEl = document.getElementById('focus-start');

  if (session?.active) {
    activeEl.style.display = 'flex';
    startEl.style.display = 'none';
    updateFocusDisplay(session);
  } else {
    activeEl.style.display = 'none';
    startEl.style.display = 'block';
  }
}

function updateFocusDisplay(session) {
  if (!session?.active) return;

  const phaseEl = document.getElementById('focus-phase');
  const timeEl = document.getElementById('focus-time');

  const phaseLabels = { work: 'Focus', break: 'Break', longBreak: 'Long Break' };
  phaseEl.textContent = phaseLabels[session.phase] || 'Focus';
  phaseEl.className = `focus-phase-badge ${session.phase}`;

  const remainingMs = Math.max(0, session.endTime - Date.now());
  const mins = Math.floor(remainingMs / 60000);
  const secs = Math.floor((remainingMs % 60000) / 1000);
  timeEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function updateFocusTimer() {
  chrome.runtime.sendMessage({ type: 'GET_FOCUS_SESSION' }).then(session => {
    if (session?.active) {
      if (session.endTime <= Date.now()) {
        loadFocusSession();
      } else {
        const activeEl = document.getElementById('focus-active');
        if (activeEl.style.display !== 'none') {
          updateFocusDisplay(session);
        }
      }
    }
  });
}

async function startFocusSession() {
  try {
    const session = await chrome.runtime.sendMessage({
      type: 'START_FOCUS_SESSION',
      sessionType: selectedPresetType
    });
    if (session?.active) await loadFocusSession();
  } catch (e) {
    console.error('Failed to start focus session:', e);
  }
}
