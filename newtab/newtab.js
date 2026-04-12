/**
 * New Tab Page
 * Shows clock, motivational quote, Google Calendar events, and Todoist tasks
 */

import * as todoist from '../lib/todoist.js';
import { getDailyQuote } from './quotes.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const INITIAL_TASK_COUNT = 8;
const EXPANDED_TASK_COUNT = 20;

const WEATHER_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

const DEFAULTS = {
  newtabShowWeather: true,
  newtabShowQuotes: true,
  newtabShowCalendar: true,
  newtabShowTodos: true,
  newtabShowFocusSnapshot: true,
  newtabTempUnit: 'C', // 'C' or 'F'
  newtabBgImageLight: '',
  newtabBgImageDark: '',
  bedtimeReminderEnabled: false,
  bedtimeReminderTime: '22:30',
  bedtimeReminderEndTime: '07:00',
};

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

// =============================================================================
// STATE
// =============================================================================

let allTasks = [];
let tasksExpanded = false;
let completedToday = [];
let reminderIntervalId = null;
let lastFocusedElement = null;

// =============================================================================
// THEME (same pattern as blocked.js / options.js)
// =============================================================================

async function loadTheme() {
  const result = await chrome.storage.local.get(['theme', 'brutalistEnabled', 'themeSyncWithBrowser']);
  let base = result.theme;
  const syncWithBrowser = result.themeSyncWithBrowser !== false;
  if (!base) {
    base = 'light';
    await chrome.storage.local.set({ theme: 'light' });
  }
  base = getEffectiveThemeBase(base, syncWithBrowser);
  const resolved = resolveThemeVariant(base);
  document.documentElement.setAttribute('data-theme', resolved);
  if (result.brutalistEnabled) {
    await chrome.storage.local.remove('brutalistEnabled');
  }
  await applyAccentColorFromStorage();
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

function getCurrentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'light';
}

function getBgImageStorageKey() {
  const theme = getCurrentTheme();
  return (theme === 'dark' || theme === 'dashboard-dark') ? 'newtabBgImageDark' : 'newtabBgImageLight';
}

function setupThemeToggle() {
  const toggle = document.getElementById('theme-toggle');
  toggle.addEventListener('click', async () => {
    const root = document.documentElement;

    // Read storage to get base theme
    const result = await chrome.storage.local.get(['theme', 'themeSyncWithBrowser']);
    const storedBase = result.theme || 'light';
    const syncWithBrowser = isThemeSyncEnabled(result.themeSyncWithBrowser);
    const currentBase = getEffectiveThemeBase(storedBase, syncWithBrowser);

    // Toggle the base theme
    const newBase = currentBase === 'dark' ? 'light' : 'dark';

    // Resolve the actual data-theme value
    const resolved = resolveThemeVariant(newBase);
    root.setAttribute('data-theme', resolved);
    await chrome.storage.local.set({ theme: newBase, themeSyncWithBrowser: false });

    // Re-apply accent color for the new theme
    await applyAccentColorFromStorage();

    // Refresh background color for the new theme
    await refreshBgColor();
  });
}

function setupBrowserThemeSyncListener() {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', async () => {
    const result = await chrome.storage.local.get('themeSyncWithBrowser');
    if (!isThemeSyncEnabled(result.themeSyncWithBrowser)) return;
    await loadTheme();
    await refreshBgColor();
  });
}

// =============================================================================
// ICONS
// =============================================================================

function setupIcons() {
  document.getElementById('theme-icon-light').innerHTML = Icons.sun;
  document.getElementById('theme-icon-dark').innerHTML = Icons.moon;
  document.getElementById('settings-icon').innerHTML = Icons.settings;
  document.getElementById('settings-close-icon').innerHTML = Icons.x;
  document.getElementById('calendar-icon').innerHTML = Icons.calendar;
  document.getElementById('todos-icon').innerHTML = Icons.list;
  document.getElementById('completed-icon').innerHTML = Icons.checkCircle;
  document.getElementById('bedtime-reminder-icon').innerHTML = Icons.moon;
}

// =============================================================================
// CLOCK & GREETING
// =============================================================================

function updateClock() {
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  document.getElementById('clock').innerHTML = `
    <span class="clock-part">${hours}</span>
    <span class="clock-separator" aria-hidden="true">:</span>
    <span class="clock-part">${minutes}</span>
  `;
}

function startClock() {
  updateClock();
  updateDate();
  // Update every second for the clock
  setInterval(updateClock, 1000);
}

function parseTimeString(timeString) {
  if (typeof timeString !== 'string') {
    return null;
  }

  const match = timeString.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return { hours, minutes };
}

function formatReminderTime(timeString) {
  const parsed = parseTimeString(timeString);
  if (!parsed) {
    return timeString;
  }

  const date = new Date();
  date.setHours(parsed.hours, parsed.minutes, 0, 0);

  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit'
  });
}

function isWithinReminderWindow(startTime, endTime, now = new Date()) {
  const start = parseTimeString(startTime);
  const end = parseTimeString(endTime);
  if (!start || !end) {
    return false;
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = start.hours * 60 + start.minutes;
  const endMinutes = end.hours * 60 + end.minutes;

  if (startMinutes === endMinutes) {
    return true;
  }

  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function getReminderElapsedMinutes(startTime, now = new Date()) {
  const start = parseTimeString(startTime);
  if (!start) {
    return null;
  }

  let currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = start.hours * 60 + start.minutes;

  if (currentMinutes < startMinutes) {
    currentMinutes += 24 * 60;
  }

  return currentMinutes - startMinutes;
}

function formatElapsedDuration(totalMinutes) {
  if (typeof totalMinutes !== 'number' || totalMinutes < 0) {
    return '';
  }

  if (totalMinutes < 60) {
    return `${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (minutes === 0) {
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }

  return `${hours} hour${hours === 1 ? '' : 's'} ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function renderBedtimeReminder(settings) {
  const reminderEl = document.getElementById('bedtime-reminder');
  const textEl = document.getElementById('bedtime-reminder-text');
  const subEl = document.getElementById('bedtime-reminder-sub');
  if (!reminderEl || !textEl || !subEl) {
    return;
  }

  const enabled = !!settings.bedtimeReminderEnabled;
  const startTime = settings.bedtimeReminderTime || DEFAULTS.bedtimeReminderTime;
  const endTime = settings.bedtimeReminderEndTime || DEFAULTS.bedtimeReminderEndTime;
  const showReminder = enabled && isWithinReminderWindow(startTime, endTime);

  reminderEl.classList.toggle('hidden', !showReminder);

  if (!showReminder) {
    return;
  }

  const elapsedMinutes = getReminderElapsedMinutes(startTime);
  const elapsedText = formatElapsedDuration(elapsedMinutes);

  if (elapsedText) {
    textEl.innerHTML = `You're <span class="bedtime-reminder-elapsed">${elapsedText}</span> past your ${formatReminderTime(startTime)} shutdown time.`;
  } else {
    textEl.textContent = `You planned to shut down at ${formatReminderTime(startTime)}.`;
  }

  subEl.textContent = `Stay off until ${formatReminderTime(endTime)}`;
}

async function refreshBedtimeReminder() {
  const settings = await getBedtimeReminderSettings();
  renderBedtimeReminder(settings);
}

async function getBedtimeReminderSettings() {
  const [{ settings = {} }, localSettings] = await Promise.all([
    chrome.storage.local.get('settings'),
    chrome.storage.local.get(['bedtimeReminderEnabled', 'bedtimeReminderTime', 'bedtimeReminderEndTime'])
  ]);

  return {
    ...DEFAULTS,
    ...settings,
    ...localSettings
  };
}

function startBedtimeReminderRefresh() {
  if (reminderIntervalId) {
    clearInterval(reminderIntervalId);
  }

  reminderIntervalId = window.setInterval(() => {
    refreshBedtimeReminder().catch(error => {
      console.error('Failed to refresh bedtime reminder:', error);
    });
  }, 60000);
}

function updateDate() {
  const now = new Date();
  const formatted = now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const calendarDateEl = document.getElementById('calendar-date');
  if (calendarDateEl) {
    calendarDateEl.textContent = formatted;
  }
}

// =============================================================================
// QUOTES
// =============================================================================

function loadQuote() {
  const quote = getDailyQuote();
  document.getElementById('quote-text').textContent = quote.text;
  document.getElementById('quote-author').textContent = quote.author;
}

// =============================================================================
// WEATHER
// =============================================================================

/**
 * WMO Weather Code → icon key + description
 * Uses is_day to distinguish sun/moon variants
 */
function getWeatherInfo(code, isDay) {
  const map = {
    0: { icon: isDay ? 'sun' : 'moon', desc: 'Clear' },
    1: { icon: isDay ? 'partlyCloudy' : 'moon', desc: 'Mostly clear' },
    2: { icon: 'partlyCloudy', desc: 'Partly cloudy' },
    3: { icon: 'cloud', desc: 'Overcast' },
    45: { icon: 'cloudFog', desc: 'Fog' },
    48: { icon: 'cloudFog', desc: 'Rime fog' },
    51: { icon: 'cloudRain', desc: 'Light drizzle' },
    53: { icon: 'cloudRain', desc: 'Drizzle' },
    55: { icon: 'cloudRain', desc: 'Heavy drizzle' },
    61: { icon: 'cloudRain', desc: 'Light rain' },
    63: { icon: 'cloudRain', desc: 'Rain' },
    65: { icon: 'cloudRain', desc: 'Heavy rain' },
    71: { icon: 'cloudSnow', desc: 'Light snow' },
    73: { icon: 'cloudSnow', desc: 'Snow' },
    75: { icon: 'cloudSnow', desc: 'Heavy snow' },
    77: { icon: 'cloudSnow', desc: 'Snow grains' },
    80: { icon: 'cloudRain', desc: 'Light showers' },
    81: { icon: 'cloudRain', desc: 'Showers' },
    82: { icon: 'cloudRain', desc: 'Heavy showers' },
    85: { icon: 'cloudSnow', desc: 'Snow showers' },
    86: { icon: 'cloudSnow', desc: 'Heavy snow showers' },
    95: { icon: 'cloudLightning', desc: 'Thunderstorm' },
    96: { icon: 'cloudLightning', desc: 'Thunderstorm w/ hail' },
    99: { icon: 'cloudLightning', desc: 'Thunderstorm w/ heavy hail' },
  };
  return map[code] || { icon: 'cloud', desc: 'Unknown' };
}

async function getCoordinates() {
  // Try cached coordinates first
  const cached = await chrome.storage.local.get(['weatherLat', 'weatherLon']);
  if (cached.weatherLat != null && cached.weatherLon != null) {
    return { lat: cached.weatherLat, lon: cached.weatherLon };
  }

  // Request geolocation
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        // Cache coordinates
        await chrome.storage.local.set({ weatherLat: lat, weatherLon: lon });
        resolve({ lat, lon });
      },
      (err) => {
        reject(new Error(err.code === 1 ? 'Location permission denied' : 'Unable to get location'));
      },
      { timeout: 10000, maximumAge: 300000 }
    );
  });
}

async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather API error: ${res.status}`);
  return res.json();
}

async function loadWeather() {
  const loadingEl = document.getElementById('weather-loading');
  const contentEl = document.getElementById('weather-content');
  const errorEl = document.getElementById('weather-error');
  const errorTextEl = document.getElementById('weather-error-text');

  try {
    // Check cache first
    const cache = await chrome.storage.local.get(['weatherCache', 'weatherCacheTime']);
    const now = Date.now();

    let data;
    if (cache.weatherCache && cache.weatherCacheTime && (now - cache.weatherCacheTime < WEATHER_CACHE_TTL)) {
      data = cache.weatherCache;
    } else {
      const coords = await getCoordinates();
      data = await fetchWeather(coords.lat, coords.lon);

      // Cache the result
      await chrome.storage.local.set({
        weatherCache: data,
        weatherCacheTime: now,
      });
    }

    // Parse data
    const current = data.current;
    const daily = data.daily;
    const weatherCode = current.weather_code;
    const isDay = current.is_day === 1;
    const info = getWeatherInfo(weatherCode, isDay);

    // Get temp unit preference
    const unitResult = await chrome.storage.local.get('newtabTempUnit');
    const unit = unitResult.newtabTempUnit || 'C';
    const convert = unit === 'F' ? (c) => Math.round(c * 9 / 5 + 32) : (c) => Math.round(c);

    const temp = convert(current.temperature_2m);
    const high = convert(daily.temperature_2m_max[0]);
    const low = convert(daily.temperature_2m_min[0]);

    // Render
    const iconHtml = Icons[info.icon] || Icons.cloud;
    document.getElementById('weather-icon').innerHTML = iconHtml;
    document.getElementById('weather-temp').textContent = `${temp}°`;
    document.getElementById('weather-desc').textContent = info.desc;
    document.getElementById('weather-highlow').textContent = `H:${high}° L:${low}°`;

    loadingEl.classList.add('hidden');
    contentEl.classList.remove('hidden');
  } catch (err) {
    console.error('Failed to load weather:', err);
    loadingEl.classList.add('hidden');
    errorEl.classList.remove('hidden');
    errorTextEl.textContent = err.message === 'Location permission denied'
      ? 'Enable location to see weather'
      : 'Weather unavailable';
  }
}

// =============================================================================
// SETTINGS
// =============================================================================

async function loadSettings() {
  const settings = {
    ...DEFAULTS,
    ...(await getBedtimeReminderSettings()),
    ...(await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }))
  };

  // Apply visibility
  applyVisibility(settings);
  renderBedtimeReminder(settings);

  const bgImageKey = getBgImageStorageKey();
  const bgImage = settings[bgImageKey] || '';
  applyBackgroundAppearance(bgImage);
}

function applyVisibility(settings) {
  const weatherSection = document.getElementById('weather-section');
  const quoteSection = document.getElementById('quote-section');
  const focusSnapshot = document.getElementById('focus-snapshot');
  const calendarPanel = document.getElementById('calendar-panel');
  const todosPanel = document.getElementById('todos-panel');
  const completedPanel = document.getElementById('completed-panel');
  const contentPanels = document.getElementById('content-panels');

  weatherSection.classList.toggle('hidden', !settings.newtabShowWeather);
  quoteSection.classList.toggle('hidden', !settings.newtabShowQuotes);
  focusSnapshot.classList.toggle('hidden', !settings.newtabShowFocusSnapshot);
  calendarPanel.classList.toggle('hidden', !settings.newtabShowCalendar);
  todosPanel.classList.toggle('hidden', !settings.newtabShowTodos);

  // Completed panel is tied to the todos toggle
  completedPanel.classList.toggle('hidden', !settings.newtabShowTodos);

  // Hide the content-panels container if all panels are hidden
  const allHidden = !settings.newtabShowCalendar && !settings.newtabShowTodos;
  contentPanels.classList.toggle('hidden', allHidden);
}

function setupSettings() {
  const settingsBtn = document.getElementById('settings-btn');
  const modal = document.getElementById('settings-modal');
  const backdrop = document.getElementById('settings-modal-backdrop');
  const dialog = document.getElementById('settings-dialog');
  const closeBtn = document.getElementById('settings-close-btn');
  const frame = document.getElementById('settings-frame');

  if (!settingsBtn || !modal || !backdrop || !dialog || !closeBtn || !frame) {
    return;
  }

  const settingsUrl = chrome.runtime.getURL('options/options.html?embedded=popup');
  let settingsFrameLoaded = false;

  const closeSettings = () => {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('settings-open');
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      lastFocusedElement.focus();
    }
  };

  const openSettings = () => {
    if (!settingsFrameLoaded) {
      frame.src = settingsUrl;
      settingsFrameLoaded = true;
    }
    lastFocusedElement = document.activeElement;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('settings-open');
    closeBtn.focus();
  };

  settingsBtn.addEventListener('click', () => {
    openSettings();
  });

  closeBtn.addEventListener('click', closeSettings);
  backdrop.addEventListener('click', closeSettings);

  dialog.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeSettings();
    }
  });
}

// =============================================================================
// BACKGROUND COLOR
// =============================================================================

function applyBackgroundAppearance(image = '') {
  document.body.style.backgroundImage = image ? `url("${image}")` : '';
  document.body.style.backgroundSize = image ? 'cover' : '';
  document.body.style.backgroundPosition = image ? 'center center' : '';
  document.body.style.backgroundRepeat = image ? 'no-repeat' : '';
}

async function refreshBgColor() {
  const imageKey = getBgImageStorageKey();
  const result = await chrome.storage.local.get(imageKey);
  const image = result[imageKey] || '';
  applyBackgroundAppearance(image);
}

function setupBgImagePicker() {
  const uploadButton = document.getElementById('upload-bg-image-btn');
  const removeButton = document.getElementById('remove-bg-image-btn');
  const input = document.getElementById('bg-image-input');

  if (!uploadButton || !removeButton || !input) return;

  uploadButton.addEventListener('click', () => {
    input.click();
  });

  input.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const imageData = await readFileAsDataUrl(file);
      const imageKey = getBgImageStorageKey();
      await chrome.storage.local.set({ [imageKey]: imageData });
      applyBackgroundAppearance(imageData);
    } catch (error) {
      console.error('Failed to upload background image:', error);
    } finally {
      input.value = '';
    }
  });

  removeButton.addEventListener('click', async () => {
    const imageKey = getBgImageStorageKey();
    await chrome.storage.local.set({ [imageKey]: '' });
    applyBackgroundAppearance('');
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

// =============================================================================
// GOOGLE CALENDAR
// =============================================================================

async function loadCalendar() {
  const titleEl = document.getElementById('calendar-title');
  const dateEl = document.getElementById('calendar-date');
  const connectEl = document.getElementById('calendar-connect');
  const reconnectEl = document.getElementById('calendar-reconnect');
  const loadingEl = document.getElementById('calendar-loading');
  const emptyEl = document.getElementById('calendar-empty');
  const emptyTextEl = document.getElementById('calendar-empty-text');
  const listEl = document.getElementById('event-list');

  try {
    // Check if calendar is connected
    const status = await chrome.runtime.sendMessage({ type: 'GET_CALENDAR_STATUS' });

    if (!status || !status.connected) {
      connectEl.classList.remove('hidden');
      reconnectEl.classList.add('hidden');
      loadingEl.classList.add('hidden');
      return;
    }

    // Connected — hide prompts, show loading
    connectEl.classList.add('hidden');
    reconnectEl.classList.add('hidden');
    loadingEl.classList.remove('hidden');

    // Fetch the new tab display payload so passed events disappear and
    // the card can roll forward to tomorrow when today is done.
    const payload = await getCalendarDisplayPayload();
    const events = payload?.events || [];

    loadingEl.classList.add('hidden');

    // The fetch may have discovered a revoked token and marked the
    // calendar disconnected — re-check so we show the reconnect prompt
    // instead of a misleading "No events today".
    const freshStatus = await chrome.runtime.sendMessage({ type: 'GET_CALENDAR_STATUS' });
    if (!freshStatus || !freshStatus.connected) {
      reconnectEl.classList.remove('hidden');
      emptyEl.classList.add('hidden');
      listEl.innerHTML = '';
      return;
    }

    if (titleEl) {
      titleEl.textContent = payload?.title || 'Today\'s Schedule';
    }
    if (dateEl) {
      dateEl.textContent = payload?.displayDate || '';
    }

    if (!events || events.length === 0) {
      listEl.innerHTML = '';
      if (emptyTextEl) {
        emptyTextEl.textContent = 'No upcoming events';
      }
      emptyEl.classList.remove('hidden');
      return;
    }

    emptyEl.classList.add('hidden');
    renderEvents(events, listEl);
  } catch (err) {
    console.error('Failed to load calendar:', err);
    loadingEl.classList.add('hidden');
    emptyEl.classList.remove('hidden');
  }
}

async function getCalendarDisplayPayload() {
  try {
    return await chrome.runtime.sendMessage({ type: 'GET_NEWTAB_EVENTS' });
  } catch (error) {
    const message = String(error?.message || error || '');
    const shouldFallback =
      message.includes('Unknown message type: GET_NEWTAB_EVENTS') ||
      message.includes('Could not establish connection') ||
      message.includes('Receiving end does not exist');

    if (!shouldFallback) {
      throw error;
    }

    const events = await chrome.runtime.sendMessage({ type: 'GET_TODAY_EVENTS' });
    const now = new Date();
    return {
      title: 'Today\'s Schedule',
      displayDate: now.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }),
      events: events || []
    };
  }
}

function renderEvents(events, listEl) {
  const now = new Date();

  // Separate all-day and timed events
  const allDayEvents = events.filter(e => e.isAllDay);
  const timedEvents = events.filter(e => !e.isAllDay);

  // Sort timed events by start time
  timedEvents.sort((a, b) => new Date(a.start) - new Date(b.start));

  listEl.innerHTML = '';

  // Render all-day events first
  for (const event of allDayEvents) {
    const li = createEventItem(event, now, true);
    listEl.appendChild(li);
  }

  // Render timed events
  for (const event of timedEvents) {
    const li = createEventItem(event, now, false);
    listEl.appendChild(li);
  }
}

function createEventItem(event, now, isAllDay) {
  const li = document.createElement('li');
  li.className = 'event-item';

  // Check if current event
  if (!isAllDay) {
    const start = new Date(event.start);
    const end = new Date(event.end);
    if (now >= start && now < end) {
      li.classList.add('event-current');
    }
  }

  // Color dot
  const dot = document.createElement('span');
  dot.className = 'event-color-dot';
  dot.style.backgroundColor = event.color || 'var(--indigo)';
  li.appendChild(dot);

  // Details
  const details = document.createElement('div');
  details.className = 'event-details';

  const title = document.createElement('div');
  title.className = 'event-title';
  title.textContent = event.title;
  details.appendChild(title);

  if (isAllDay) {
    const badge = document.createElement('span');
    badge.className = 'event-allday';
    badge.textContent = 'All day';
    details.appendChild(badge);
  } else {
    const time = document.createElement('div');
    time.className = 'event-time';
    const startTime = formatTime(new Date(event.start));
    const endTime = formatTime(new Date(event.end));
    time.textContent = `${startTime} - ${endTime}`;
    details.appendChild(time);
  }

  li.appendChild(details);
  return li;
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function setupCalendarConnect() {
  const connectBtn = document.getElementById('calendar-connect-btn');
  const reconnectBtn = document.getElementById('calendar-reconnect-btn');

  const handleConnect = async (btn, label) => {
    btn.disabled = true;
    btn.textContent = 'Connecting...';
    try {
      await chrome.runtime.sendMessage({ type: 'CONNECT_GOOGLE_CALENDAR' });
      await loadCalendar();
    } catch (err) {
      console.error('Failed to connect calendar:', err);
      btn.disabled = false;
      btn.textContent = label;
    }
  };

  connectBtn.addEventListener('click', () => handleConnect(connectBtn, 'Connect Calendar'));
  reconnectBtn.addEventListener('click', () => handleConnect(reconnectBtn, 'Reconnect Calendar'));
}

// =============================================================================
// COMPLETED TASKS (from Todoist API)
// =============================================================================

async function fetchCompletedToday() {
  const loadingEl = document.getElementById('completed-loading');
  const emptyEl = document.getElementById('completed-empty');

  try {
    const authenticated = await todoist.isAuthenticated();
    if (!authenticated) return;

    loadingEl.classList.remove('hidden');
    emptyEl.classList.add('hidden');

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const since = startOfDay.toISOString();
    const until = now.toISOString();

    const tasks = await todoist.getCompletedTasks({ since, until, limit: 50 });
    completedToday = tasks.map(t => ({
      id: t.id || t.task_id,
      content: t.content,
    }));

    loadingEl.classList.add('hidden');
    renderCompletedSection();
  } catch (err) {
    console.error('Failed to fetch completed tasks:', err);
    loadingEl.classList.add('hidden');
    renderCompletedSection();
  }
}

function renderCompletedSection() {
  const countEl = document.getElementById('completed-count');
  const emptyEl = document.getElementById('completed-empty');
  const listEl = document.getElementById('completed-list');

  countEl.textContent = completedToday.length;

  if (completedToday.length === 0) {
    emptyEl.classList.remove('hidden');
    listEl.classList.add('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  listEl.classList.remove('hidden');

  // Render the list
  listEl.innerHTML = '';
  for (const task of completedToday) {
    const li = document.createElement('li');
    li.className = 'completed-item';

    // Checkmark circle
    const check = document.createElement('span');
    check.className = 'completed-item-check';
    check.innerHTML = Icons.check;
    li.appendChild(check);

    // Task content
    const content = document.createElement('span');
    content.className = 'completed-item-content';
    content.textContent = task.content;
    li.appendChild(content);

    listEl.appendChild(li);
  }
}

// =============================================================================
// TODOIST
// =============================================================================

async function loadTodos() {
  const connectEl = document.getElementById('todos-connect');
  const loadingEl = document.getElementById('todos-loading');
  const emptyEl = document.getElementById('todos-empty');
  const listEl = document.getElementById('todo-list');
  const showMoreBtn = document.getElementById('todos-show-more');

  try {
    // Check if authenticated
    const authenticated = await todoist.isAuthenticated();

    if (!authenticated) {
      connectEl.classList.remove('hidden');
      loadingEl.classList.add('hidden');
      return;
    }

    // Authenticated — hide prompt, show loading
    connectEl.classList.add('hidden');
    loadingEl.classList.remove('hidden');

    // Fetch tasks
    const tasks = await todoist.getTasksWithSubtasks();

    loadingEl.classList.add('hidden');

    // Sort: priority desc, then due date asc (no due = last)
    allTasks = sortTasks(tasks);

    if (allTasks.length === 0) {
      emptyEl.classList.remove('hidden');
      return;
    }

    renderTodos(listEl, showMoreBtn);
  } catch (err) {
    console.error('Failed to load todos:', err);
    loadingEl.classList.add('hidden');

    // If auth expired, show connect prompt
    if (err.message && err.message.includes('Authentication expired')) {
      connectEl.classList.remove('hidden');
    } else {
      emptyEl.classList.remove('hidden');
    }
  }
}

function sortTasks(tasks) {
  return tasks.sort((a, b) => {
    // Priority: higher first (4 = urgent, 1 = normal)
    if (b.priority !== a.priority) return b.priority - a.priority;

    // Due date: earlier first, no due date last
    const aDue = a.due ? (a.due.datetime || a.due.date) : null;
    const bDue = b.due ? (b.due.datetime || b.due.date) : null;

    if (aDue && bDue) return new Date(aDue) - new Date(bDue);
    if (aDue && !bDue) return -1;
    if (!aDue && bDue) return 1;
    return 0;
  });
}

function renderTodos(listEl, showMoreBtn) {
  const limit = tasksExpanded ? EXPANDED_TASK_COUNT : INITIAL_TASK_COUNT;
  const visibleTasks = allTasks.slice(0, limit);

  listEl.innerHTML = '';

  for (const task of visibleTasks) {
    const li = createTodoItem(task);
    listEl.appendChild(li);
  }

  // Show more button
  if (allTasks.length > INITIAL_TASK_COUNT) {
    showMoreBtn.classList.remove('hidden');
    showMoreBtn.textContent = tasksExpanded
      ? `Show less`
      : `Show more (${allTasks.length - INITIAL_TASK_COUNT} more)`;
  } else {
    showMoreBtn.classList.add('hidden');
  }
}

function createTodoItem(task, isSubtask = false) {
  const li = document.createElement('li');
  li.className = `todo-item${isSubtask ? ' subtask' : ''}`;
  li.dataset.taskId = task.id;

  // Checkbox
  const checkbox = document.createElement('button');
  checkbox.className = `todo-checkbox ${todoist.getPriorityClass(task.priority)}`;
  checkbox.title = 'Complete task';
  checkbox.addEventListener('click', () => completeTask(task.id, li, checkbox));
  li.appendChild(checkbox);

  // Details
  const details = document.createElement('div');
  details.className = 'todo-details';

  const content = document.createElement('div');
  content.className = 'todo-content';
  content.textContent = task.content;
  details.appendChild(content);

  // Meta (due date + subtask count)
  const dueStr = todoist.formatDueDate(task);
  const hasSubtasks = !isSubtask && task.subtasks && task.subtasks.length > 0;

  if (dueStr || hasSubtasks) {
    const meta = document.createElement('div');
    meta.className = 'todo-meta';

    if (dueStr) {
      const due = document.createElement('span');
      due.className = 'todo-due';
      due.textContent = dueStr;

      if (dueStr === 'Overdue') due.classList.add('overdue');
      if (dueStr === 'Today' || dueStr.startsWith('Today')) due.classList.add('today');

      meta.appendChild(due);
    }

    if (hasSubtasks) {
      const subtaskCount = document.createElement('span');
      subtaskCount.className = 'subtask-count';
      subtaskCount.textContent = `${task.subtasks.length} subtask${task.subtasks.length > 1 ? 's' : ''}`;
      meta.appendChild(subtaskCount);
    }

    details.appendChild(meta);
  }

  // Render nested subtasks
  if (hasSubtasks) {
    const subtasksList = document.createElement('ul');
    subtasksList.className = 'subtasks-list';

    for (const subtask of task.subtasks) {
      subtasksList.appendChild(createTodoItem(subtask, true));
    }

    details.appendChild(subtasksList);
  }

  li.appendChild(details);
  return li;
}

async function completeTask(taskId, li, checkbox) {
  // Prevent double-click
  if (checkbox.classList.contains('checked')) return;

  checkbox.classList.add('checked');

  try {
    await todoist.completeTask(taskId);

    const rewardResult = await chrome.runtime.sendMessage({ type: 'ADD_EARNED_TIME', taskCount: 1 });
    if (rewardResult && rewardResult.added > 0) {
      console.log('Task reward applied:', rewardResult);
    }

    // Re-fetch completed tasks from Todoist API
    fetchCompletedToday();

    // Animate removal
    li.classList.add('completing');
    setTimeout(() => {
      // Remove from allTasks
      allTasks = allTasks.filter(t => t.id !== taskId);

      // Re-render
      const listEl = document.getElementById('todo-list');
      const showMoreBtn = document.getElementById('todos-show-more');
      renderTodos(listEl, showMoreBtn);

      // Show empty state if needed
      if (allTasks.length === 0) {
        document.getElementById('todos-empty').classList.remove('hidden');
      }
    }, 300);
  } catch (err) {
    console.error('Failed to complete task:', err);
    checkbox.classList.remove('checked');
  }
}

function setupTodosConnect() {
  const btn = document.getElementById('todos-connect-btn');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Connecting...';
    try {
      await todoist.authenticate();
      // Reload todos section
      await loadTodos();
    } catch (err) {
      console.error('Failed to connect Todoist:', err);
      btn.disabled = false;
      btn.textContent = 'Connect Todoist';
    }
  });
}

function setupShowMore() {
  const btn = document.getElementById('todos-show-more');
  btn.addEventListener('click', () => {
    tasksExpanded = !tasksExpanded;
    const listEl = document.getElementById('todo-list');
    renderTodos(listEl, btn);
  });
}

async function loadFocusSnapshot(preloadedDisplaySettings = null) {
  const displaySettings = preloadedDisplaySettings || {
    ...DEFAULTS,
    ...(await chrome.storage.local.get([
      'newtabShowFocusSnapshot'
    ]))
  };

  if (!displaySettings.newtabShowFocusSnapshot) {
    return;
  }

  try {
    const blockingSummary = await chrome.runtime.sendMessage({ type: 'GET_BLOCKING_SUMMARY' });
    const totalBlockAttempts = blockingSummary?.totalBlockAttempts || 0;
    const estimatedSavedMinutes = totalBlockAttempts * 15;
    document.getElementById('focus-snapshot-blocked').textContent = totalBlockAttempts;
    renderSavedTime(estimatedSavedMinutes);
  } catch (error) {
    console.error('Failed to load focus snapshot:', error);
    document.getElementById('focus-snapshot-blocked').textContent = '-';
    document.getElementById('focus-snapshot-saved').textContent = '-';
  }
}

function getSavedTimeParts(minutes) {
  if (minutes < 60) {
    return { value: String(minutes), unit: 'min' };
  }

  const MINUTES_PER_HOUR = 60;
  const MINUTES_PER_DAY = MINUTES_PER_HOUR * 24;
  const MINUTES_PER_WEEK = MINUTES_PER_DAY * 7;
  const MINUTES_PER_MONTH = MINUTES_PER_DAY * 30;
  const MINUTES_PER_YEAR = MINUTES_PER_DAY * 365;

  const formatLargeUnit = (value, singularUnit, pluralUnit) => {
    const displayValue = value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '');
    const numericValue = Number(displayValue);
    return {
      value: displayValue,
      unit: numericValue === 1 ? singularUnit : pluralUnit
    };
  };

  if (minutes >= MINUTES_PER_YEAR) {
    return formatLargeUnit(minutes / MINUTES_PER_YEAR, 'year', 'years');
  }

  if (minutes >= MINUTES_PER_MONTH) {
    return formatLargeUnit(minutes / MINUTES_PER_MONTH, 'month', 'months');
  }

  if (minutes >= MINUTES_PER_WEEK) {
    return formatLargeUnit(minutes / MINUTES_PER_WEEK, 'week', 'weeks');
  }

  if (minutes >= MINUTES_PER_DAY) {
    return formatLargeUnit(minutes / MINUTES_PER_DAY, 'day', 'days');
  }

  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const remainder = minutes % MINUTES_PER_HOUR;

  if (remainder === 0) {
    return { value: String(hours), unit: 'hr' };
  }

  return { value: `${hours}h ${remainder}`, unit: 'min' };
}

function renderSavedTime(minutes) {
  const savedTimeEl = document.getElementById('focus-snapshot-saved');
  const { value, unit } = getSavedTimeParts(minutes);
  savedTimeEl.innerHTML = `
    <span class="focus-snapshot-saved-number">${value}</span>
    <span class="focus-snapshot-saved-unit">${unit}</span>
  `;
}

function setupStorageSync() {
  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== 'local') return;

    const changedKeys = Object.keys(changes);
    const visibilityKeys = [
      'newtabShowWeather',
      'newtabShowQuotes',
      'newtabShowCalendar',
      'newtabShowTodos',
      'newtabShowFocusSnapshot',
      'bedtimeReminderEnabled',
      'bedtimeReminderTime',
      'bedtimeReminderEndTime',
      'newtabBgImageLight',
      'newtabBgImageDark'
    ];

    if (changedKeys.some(key => visibilityKeys.includes(key))) {
      await loadSettings();
    }

    if (changedKeys.includes('newtabShowFocusSnapshot')) {
      await loadFocusSnapshot();
    }

    if (changedKeys.includes('newtabShowCalendar')) {
      await loadCalendar();
    }

    if (changedKeys.includes('newtabShowTodos')) {
      await Promise.allSettled([
        loadTodos(),
        fetchCompletedToday()
      ]);
    }

    if (changedKeys.includes('newtabTempUnit')) {
      await loadWeather();
    }

    if (changedKeys.some(key => ['theme', 'themeSyncWithBrowser', 'accentColor'].includes(key))) {
      await loadTheme();
      await refreshBgColor();
    }
  });
}

// =============================================================================
// INIT
// =============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  // Load theme first to avoid flash
  await loadTheme();

  // Setup icons
  setupIcons();

  // Setup interactions
  setupThemeToggle();
  setupBrowserThemeSyncListener();
  setupSettings();
  setupStorageSync();
  setupCalendarConnect();
  setupTodosConnect();
  setupShowMore();

  // Start clock
  startClock();
  startBedtimeReminderRefresh();

  // Load quote
  loadQuote();

  // Load settings and apply visibility
  await loadSettings();
  await loadFocusSnapshot();

  // Load data (in parallel)
  loadCalendar();
  window.setInterval(() => {
    loadCalendar().catch(error => {
      console.error('Failed to refresh calendar:', error);
    });
  }, 60000);
  loadTodos();
  loadWeather();
  fetchCompletedToday();
});
