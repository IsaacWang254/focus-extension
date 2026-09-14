/**
 * New Tab Page
 * Shows clock, motivational quote, Google Calendar events, and Todoist tasks
 */

import * as todoist from '../lib/todoist.js';
import { createRuntimeMessenger, hasExtensionRuntime } from '../lib/runtime.js';
import {
  applyAccentColorFromStorage,
  getEffectiveThemeBase,
  isThemeSyncEnabled,
  loadTheme,
  resolveThemeVariant
} from '../lib/theme.js';
import { setIconButtonLabel } from '../lib/design-theme.js';
import { getDailyQuote } from './quotes.js';
import { resolveNewtabBackground } from '../lib/newtab-background.js';
import { getCachedResource, withSharedLock } from '../lib/request-cache.js';
import { runWhenVisible } from '../lib/when-visible.js';

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
  newtabBackground: 'ocean',
  newtabShowOceanBackground: true,
  newtabOceanBatterySaver: false,
  newtabOceanWaveSpeed: 0.8,
  newtabTempUnit: 'C', // 'C' or 'F'
  newtabBgImageLight: '',
  newtabBgImageDark: '',
  bedtimeReminderEnabled: false,
  bedtimeReminderTime: '22:30',
  bedtimeReminderEndTime: '07:00',
};

let reminderIntervalId = null;
let dashboardSettings = { ...DEFAULTS };
let lastFocusedElement = null;

function isWidgetVisible(key) {
  return document.visibilityState === 'visible' && dashboardSettings[key] !== false;
}
let completedToday = [];
let allTasks = [];
let tasksExpanded = false;

const previewStorage = {};

function getPreviewResponse(message) {
  switch (message.type) {
    case 'GET_SETTINGS':
      return { ...DEFAULTS };
    case 'GET_CALENDAR_STATUS':
      return { connected: false };
    case 'GET_NEWTAB_EVENTS':
    case 'GET_TODAY_EVENTS':
      return [];
    case 'GET_BLOCKING_SUMMARY':
      return { totalBlockAttempts: 0 };
    case 'ADD_EARNED_TIME':
      return { added: 0 };
    default:
      return null;
  }
}

const sendRuntimeMessage = createRuntimeMessenger(getPreviewResponse);

function hasExtensionStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

async function getLocal(keys) {
  if (hasExtensionStorage()) return chrome.storage.local.get(keys);

  if (Array.isArray(keys)) {
    return keys.reduce((result, key) => {
      if (Object.prototype.hasOwnProperty.call(previewStorage, key)) result[key] = previewStorage[key];
      return result;
    }, {});
  }

  if (typeof keys === 'string') {
    return Object.prototype.hasOwnProperty.call(previewStorage, keys) ? { [keys]: previewStorage[keys] } : {};
  }

  if (keys && typeof keys === 'object') {
    return Object.entries(keys).reduce((result, [key, fallback]) => {
      result[key] = Object.prototype.hasOwnProperty.call(previewStorage, key) ? previewStorage[key] : fallback;
      return result;
    }, {});
  }

  return { ...previewStorage };
}

async function setLocal(values) {
  if (hasExtensionStorage()) return chrome.storage.local.set(values);
  Object.assign(previewStorage, values);
  return undefined;
}

function getExtensionUrl(path) {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) return chrome.runtime.getURL(path);
  return new URL(`../${path}`, import.meta.url).href;
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
    const result = await getLocal(['theme', 'themeSyncWithBrowser']);
    const storedBase = result.theme || 'light';
    const syncWithBrowser = isThemeSyncEnabled(result.themeSyncWithBrowser);
    const currentBase = getEffectiveThemeBase(storedBase, syncWithBrowser);

    // Toggle the base theme
    const newBase = currentBase === 'dark' ? 'light' : 'dark';

    // Resolve the actual data-theme value
    const resolved = resolveThemeVariant(newBase);
    root.setAttribute('data-theme', resolved);
    updateThemeToggleIcon(resolved);
    await setLocal({ theme: newBase, themeSyncWithBrowser: false });

    // Re-apply accent color for the new theme
    await applyAccentColorFromStorage();

    // Refresh background color for the new theme
    await refreshBgColor();
  });
}

// Light themes get the "day" variant, dark themes the night variant. Both
// backgrounds share the convention so one mode value drives either shader.
const SHADER_MODE = { DAY: 2, NIGHT: 1 };

const BACKGROUND_SHADERS = {
  ocean: { canvasId: 'bg-ocean', load: () => import('./ocean-shader.js').then(module => module.initOceanShader) },
  dither: { canvasId: 'bg-dither', load: () => import('./dither-shader.js').then(module => module.initDitherShader) }
};

function getShaderModeForTheme() {
  const theme = document.documentElement.getAttribute('data-theme') || '';
  return theme.includes('dark') ? SHADER_MODE.NIGHT : SHADER_MODE.DAY;
}

let activeBackground = null;      // { kind, handle } for the running shader
let backgroundInitFailed = false; // WebGL unavailable or shader failed to build
let backgroundThemeObserver = null;
let backgroundBatterySaver = false;
let backgroundSpeed = 0.8;
let backgroundGeneration = 0;
let pendingBackgroundLoad = null;
let requestedBackgroundKind = 'none';

function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function hideAllBackgroundCanvases() {
  Object.values(BACKGROUND_SHADERS).forEach(({ canvasId }) => {
    const canvas = document.getElementById(canvasId);
    if (canvas) canvas.style.display = 'none';
  });
}

function teardownActiveBackground() {
  if (backgroundThemeObserver) {
    backgroundThemeObserver.disconnect();
    backgroundThemeObserver = null;
  }
  if (activeBackground) {
    // destroy() rather than stop(): only one WebGL context should be alive at
    // a time, so switching backgrounds must release the previous one.
    activeBackground.handle.destroy();
    activeBackground = null;
  }
  hideAllBackgroundCanvases();
}

async function applyBackgroundSetting(kind) {
  requestedBackgroundKind = kind;
  const generation = ++backgroundGeneration;
  if (pendingBackgroundLoad) {
    pendingBackgroundLoad();
    pendingBackgroundLoad = null;
  }

  const shader = BACKGROUND_SHADERS[kind];
  const active = !!shader && !prefersReducedMotion() && !backgroundInitFailed;

  document.body.classList.toggle('bg-active', active);
  document.body.classList.toggle('bg-dither-active', active && kind === 'dither');

  if (!active) {
    teardownActiveBackground();
    return;
  }

  if (document.visibilityState === 'hidden') {
    pendingBackgroundLoad = runWhenVisible(() => {
      pendingBackgroundLoad = null;
      applyBackgroundSetting(requestedBackgroundKind);
    });
    return;
  }

  if (activeBackground && activeBackground.kind === kind) {
    activeBackground.handle.start();
    return;
  }

  const canvas = document.getElementById(shader.canvasId);
  if (!canvas) return;

  let init;
  try {
    init = await shader.load();
  } catch (error) {
    console.error('Failed to load background shader:', error);
    if (generation === backgroundGeneration) {
      backgroundInitFailed = true;
      document.body.classList.remove('bg-active', 'bg-dither-active');
    }
    return;
  }

  if (generation !== backgroundGeneration ||
      document.visibilityState === 'hidden' ||
      prefersReducedMotion() ||
      backgroundInitFailed) {
    return;
  }

  teardownActiveBackground();
  canvas.style.display = 'block';

  const handle = init(canvas, {
    mode: getShaderModeForTheme(),
    powerSave: backgroundBatterySaver
  });
  if (!handle) {
    backgroundInitFailed = true;
    canvas.style.display = 'none';
    document.body.classList.remove('bg-active', 'bg-dither-active');
    return;
  }

  handle.setSpeed(backgroundSpeed);
  activeBackground = { kind, handle };

  backgroundThemeObserver = new MutationObserver(() => {
    handle.setMode(getShaderModeForTheme());
  });
  backgroundThemeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  });
}

function applyBackgroundBatterySaver(enabled) {
  backgroundBatterySaver = enabled === true;
  if (activeBackground) activeBackground.handle.setBatterySaver(backgroundBatterySaver);
}

function applyBackgroundSpeed(speed) {
  backgroundSpeed = Number.isFinite(speed) ? speed : 0.8;
  if (activeBackground) activeBackground.handle.setSpeed(backgroundSpeed);
}

function setupBrowserThemeSyncListener() {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', async () => {
    const result = await getLocal('themeSyncWithBrowser');
    if (!isThemeSyncEnabled(result.themeSyncWithBrowser)) return;
    await loadTheme();
    updateThemeToggleIcon();
    await refreshBgColor();
  });
}

// =============================================================================
// ICONS
// =============================================================================

function updateThemeToggleIcon(themeValue = document.documentElement.getAttribute('data-theme')) {
  const themeIconLight = document.getElementById('theme-icon-light');
  const themeIconDark = document.getElementById('theme-icon-dark');
  const toggle = document.getElementById('theme-toggle');
  const isDark = themeValue === 'dashboard-dark' || themeValue === 'dark';

  if (themeIconLight) {
    themeIconLight.innerHTML = isDark ? '' : Icons.moon;
    themeIconLight.setAttribute('aria-hidden', isDark ? 'true' : 'false');
  }

  if (themeIconDark) {
    themeIconDark.innerHTML = isDark ? Icons.sun : '';
    themeIconDark.setAttribute('aria-hidden', isDark ? 'false' : 'true');
  }

  setIconButtonLabel(toggle, isDark ? 'Switch to light mode' : 'Switch to dark mode');
}

function setupIcons() {
  updateThemeToggleIcon();
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

let clockIntervalId = null;
let lastRenderedClockTime = '';

function updateClock() {
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const rendered = `${hours}:${minutes}`;
  if (rendered === lastRenderedClockTime) {
    return;
  }
  lastRenderedClockTime = rendered;
  document.getElementById('clock').innerHTML = `
    <span class="clock-part">${hours}</span>
    <span class="clock-separator" aria-hidden="true">:</span>
    <span class="clock-part">${minutes}</span>
  `;
}

function startClock() {
  stopClock();
  updateClock();
  updateDate();
  // Update every second for the clock
  if (document.visibilityState !== 'hidden') {
    clockIntervalId = setInterval(updateClock, 1000);
  }
}

function stopClock() {
  if (clockIntervalId) {
    clearInterval(clockIntervalId);
    clockIntervalId = null;
  }
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
    getLocal('settings'),
    getLocal(['bedtimeReminderEnabled', 'bedtimeReminderTime', 'bedtimeReminderEndTime'])
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
    if (document.visibilityState !== 'visible') {
      return;
    }
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
    1: { icon: isDay ? 'partlyCloudy' : 'partlyCloudyNight', desc: 'Mostly clear' },
    2: { icon: isDay ? 'partlyCloudy' : 'partlyCloudyNight', desc: 'Partly cloudy' },
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
  return withSharedLock('focus-weather-location', async () => {
    // Try cached coordinates first
    const cached = await getLocal(['weatherLat', 'weatherLon', 'weatherLocationRetryAt']);
    if (cached.weatherLat != null && cached.weatherLon != null) {
      return { lat: cached.weatherLat, lon: cached.weatherLon };
    }

    if (cached.weatherLocationRetryAt > Date.now()) {
      throw new Error('Unable to get location');
    }

    if (!isWidgetVisible('newtabShowWeather')) {
      throw new Error('Unable to get location');
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
          try {
            // Cache coordinates
            await setLocal({ weatherLat: lat, weatherLon: lon, weatherLocationRetryAt: 0 });
            resolve({ lat, lon });
          } catch (err) {
            reject(err);
          }
        },
        async (err) => {
          try {
            await setLocal({ weatherLocationRetryAt: Date.now() + 5 * 60 * 1000 });
          } catch {}
          reject(new Error(err.code === 1 ? 'Location permission denied' : 'Unable to get location'));
        },
        { timeout: 10000, maximumAge: 300000 }
      );
    });
  });
}

async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    const error = new Error(`Weather API error: ${res.status}`);
    error.status = res.status;
    const retryAfter = res.headers.get('Retry-After');
    if (retryAfter) {
      const seconds = Number(retryAfter);
      error.retryAfterMs = Number.isFinite(seconds)
        ? seconds * 1000
        : Math.max(0, Date.parse(retryAfter) - Date.now());
    }
    throw error;
  }
  return res.json();
}

function setWeatherStatus(message) {
  const errorEl = document.getElementById('weather-error');
  const errorTextEl = document.getElementById('weather-error-text');
  if (!errorEl || !errorTextEl) return;
  if (message) {
    errorTextEl.textContent = message;
    errorTextEl.title = message;
    errorEl.classList.remove('hidden');
  } else {
    errorTextEl.textContent = '';
    errorTextEl.title = '';
    errorEl.classList.add('hidden');
  }
}

async function renderWeather(data) {
  const loadingEl = document.getElementById('weather-loading');
  const contentEl = document.getElementById('weather-content');

  // Parse data
  const current = data.current;
  const daily = data.daily;
  const weatherCode = current.weather_code;
  const isDay = current.is_day === 1;
  const info = getWeatherInfo(weatherCode, isDay);

  // Get temp unit preference
  const unitResult = await getLocal('newtabTempUnit');
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
  setWeatherStatus(null);
}

function isValidWeatherData(data) {
  return Number.isFinite(data?.current?.temperature_2m) &&
    Number.isFinite(data?.current?.weather_code) &&
    (data.current.is_day === 0 || data.current.is_day === 1) &&
    Array.isArray(data?.daily?.temperature_2m_max) && Number.isFinite(data.daily.temperature_2m_max[0]) &&
    Array.isArray(data?.daily?.temperature_2m_min) && Number.isFinite(data.daily.temperature_2m_min[0]);
}

async function loadWeather() {
  const loadingEl = document.getElementById('weather-loading');
  const contentEl = document.getElementById('weather-content');
  const errorEl = document.getElementById('weather-error');
  const errorTextEl = document.getElementById('weather-error-text');

  if (!isWidgetVisible('newtabShowWeather')) {
    return;
  }

  try {
    if (!hasExtensionStorage()) {
      loadingEl.classList.add('hidden');
      errorEl.classList.remove('hidden');
      errorTextEl.textContent = 'Enable location to see weather';
      return;
    }

    // Check cache first
    const cache = await getLocal(['weatherCache', 'weatherCacheTime', 'weatherCacheScope', 'weatherLat', 'weatherLon']);
    const now = Date.now();
    const legacyAge = cache.weatherCacheTime ? now - cache.weatherCacheTime : Infinity;
    const legacyScope = JSON.stringify([cache.weatherLat ?? null, cache.weatherLon ?? null, new Date().toDateString()]);

    if (isValidWeatherData(cache.weatherCache) && cache.weatherCacheScope == null &&
        legacyAge >= 0 && legacyAge < WEATHER_CACHE_TTL &&
        new Date(cache.weatherCacheTime).toDateString() === new Date().toDateString()) {
      await setLocal({
        weatherCacheScope: JSON.stringify([cache.weatherLat ?? null, cache.weatherLon ?? null, new Date().toDateString()])
      });
      await renderWeather(cache.weatherCache);
      return;
    }

    if (legacyScope && isValidWeatherData(cache.weatherCache) &&
        cache.weatherCacheScope === legacyScope &&
        legacyAge >= 0 && legacyAge < WEATHER_CACHE_TTL) {
      await renderWeather(cache.weatherCache);
      return;
    }

    const staleCacheUsable = legacyScope && isValidWeatherData(cache.weatherCache) &&
      cache.weatherCacheScope === legacyScope &&
      legacyAge >= 0 && legacyAge < WEATHER_CACHE_TTL + 2 * 60 * 60 * 1000;
    if (staleCacheUsable) {
      await renderWeather(cache.weatherCache);
      setWeatherStatus('Showing saved weather');
    } else {
      contentEl.classList.add('hidden');
    }

    const coords = await getCoordinates();
    const scope = JSON.stringify([coords.lat, coords.lon, new Date().toDateString()]);
    await getCachedResource('focusCache:weather', {
      scope, ttl: WEATHER_CACHE_TTL, maxStale: 2 * 60 * 60 * 1000,
      load: async () => {
        if (!isWidgetVisible('newtabShowWeather')) {
          throw new Error('Unable to get location');
        }
        const fetched = await fetchWeather(coords.lat, coords.lon);
        if (!isValidWeatherData(fetched)) throw new Error('Weather API error: malformed response');
        return fetched;
      },
      isCurrent: async () => {
        const current = await getLocal(['weatherLat', 'weatherLon']);
        return current.weatherLat === coords.lat && current.weatherLon === coords.lon &&
          scope === JSON.stringify([coords.lat, coords.lon, new Date().toDateString()]);
      }
    });

    const record = (await getLocal('focusCache:weather'))['focusCache:weather'];
    const currentCoords = await getLocal(['weatherLat', 'weatherLon']);
    if (!record || record.scope !== scope ||
        currentCoords.weatherLat !== coords.lat || currentCoords.weatherLon !== coords.lon ||
        scope !== JSON.stringify([coords.lat, coords.lon, new Date().toDateString()])) {
      return;
    }
    if (cache.weatherCacheTime !== record.updatedAt || cache.weatherCacheScope !== record.scope) {
      // Cache the result
      await setLocal({ weatherCache: record.value, weatherCacheTime: record.updatedAt, weatherCacheScope: record.scope });
    }
    await renderWeather(record.value);
    if (Date.now() - record.updatedAt >= WEATHER_CACHE_TTL) {
      setWeatherStatus('Showing saved weather');
    }
  } catch (err) {
    console.error('Failed to load weather:', err);
    loadingEl.classList.add('hidden');
    const cache = await getLocal(['weatherCache', 'weatherCacheTime', 'weatherCacheScope', 'weatherLat', 'weatherLon']);
    const age = cache.weatherCacheTime ? Date.now() - cache.weatherCacheTime : Infinity;
    const fallbackScope = JSON.stringify([cache.weatherLat ?? null, cache.weatherLon ?? null, new Date().toDateString()]);
    if (fallbackScope && isValidWeatherData(cache.weatherCache) &&
        cache.weatherCacheScope === fallbackScope && age >= 0 &&
        age < WEATHER_CACHE_TTL + 2 * 60 * 60 * 1000) {
      await renderWeather(cache.weatherCache);
      setWeatherStatus('Showing saved weather');
      return;
    }
    contentEl.classList.add('hidden');
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
    ...(await sendRuntimeMessage({ type: 'GET_SETTINGS' }))
  };

  dashboardSettings = settings;

  // Apply visibility
  applyVisibility(settings);
  applyBackgroundBatterySaver(settings.newtabOceanBatterySaver === true);
  applyBackgroundSpeed(Number.isFinite(settings.newtabOceanWaveSpeed) ? settings.newtabOceanWaveSpeed : 0.8);
  applyBackgroundSetting(resolveNewtabBackground(settings));
  renderBedtimeReminder(settings);

  const bgImageKey = getBgImageStorageKey();
  const bgImage = settings[bgImageKey] || '';
  applyBackgroundAppearance(bgImage);

  return settings;
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

  const settingsUrl = getExtensionUrl('options/options.html?embedded=popup');
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

  window.addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow) return;
    if (event.data?.type !== 'FOCUS_CLOSE_SETTINGS') return;
    closeSettings();
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
  const result = await getLocal(imageKey);
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
      await setLocal({ [imageKey]: imageData });
      applyBackgroundAppearance(imageData);
    } catch (error) {
      console.error('Failed to upload background image:', error);
    } finally {
      input.value = '';
    }
  });

  removeButton.addEventListener('click', async () => {
    const imageKey = getBgImageStorageKey();
    await setLocal({ [imageKey]: '' });
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

  if (!isWidgetVisible('newtabShowCalendar')) {
    return;
  }

  try {
    // Check if calendar is connected
    const status = await sendRuntimeMessage({ type: 'GET_CALENDAR_STATUS' });

    if (!status || !status.connected) {
      connectEl.classList.remove('hidden');
      reconnectEl.classList.add('hidden');
      loadingEl.classList.add('hidden');
      emptyEl.classList.add('hidden');
      listEl.innerHTML = '';
      return;
    }

    // Connected — hide prompts, show loading
    connectEl.classList.add('hidden');
    reconnectEl.classList.add('hidden');
    if (listEl.children.length === 0) {
      loadingEl.classList.remove('hidden');
    }

    // Fetch the new tab display payload so passed events disappear and
    // the card can roll forward to tomorrow when today is done.
    const payload = await getCalendarDisplayPayload();
    const events = payload?.events || [];

    loadingEl.classList.add('hidden');

    // The fetch may have discovered a revoked token and marked the
    // calendar disconnected — re-check so we show the reconnect prompt
    // instead of a misleading "No events today".
    const freshStatus = await sendRuntimeMessage({ type: 'GET_CALENDAR_STATUS' });
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
    if (err.status === 401 || err.status === 403) {
      reconnectEl.classList.remove('hidden');
      emptyEl.classList.add('hidden');
      listEl.innerHTML = '';
      return;
    }
    if (emptyTextEl) {
      emptyTextEl.textContent = listEl.children.length > 0
        ? 'Showing saved schedule'
        : 'Calendar unavailable';
    }
    emptyEl.classList.remove('hidden');
  }
}

async function getCalendarDisplayPayload() {
  try {
    const payload = await sendRuntimeMessage({ type: 'GET_NEWTAB_EVENTS' });
    if (payload?.error) {
      throw Object.assign(new Error(payload.error), { status: payload.status });
    }
    return payload;
  } catch (error) {
    const message = String(error?.message || error || '');
    const shouldFallback =
      message.includes('Unknown message type: GET_NEWTAB_EVENTS') ||
      message.includes('Could not establish connection') ||
      message.includes('Receiving end does not exist');

    if (!shouldFallback) {
      throw error;
    }

    const events = await sendRuntimeMessage({ type: 'GET_TODAY_EVENTS' });
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
    if (!hasExtensionRuntime()) return;

    btn.disabled = true;
    btn.textContent = 'Connecting...';
    try {
      await sendRuntimeMessage({ type: 'CONNECT_GOOGLE_CALENDAR' });
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

  if (!isWidgetVisible('newtabShowTodos')) {
    return;
  }

  try {
    if (!hasExtensionRuntime()) return;

    const authenticated = await todoist.isAuthenticated();
    if (!authenticated) {
      completedToday = [];
      loadingEl.classList.add('hidden');
      renderCompletedSection();
      return;
    }

    loadingEl.classList.remove('hidden');
    emptyEl.classList.add('hidden');

    const tasks = await todoist.getCompletedTasksToday({ limit: 50, staleWhileRevalidate: true });
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

  if (!isWidgetVisible('newtabShowTodos')) {
    return;
  }

  // Reset every state up front — loadTodos re-runs on refresh, and leaving a
  // previously shown connect prompt or empty state visible stacks it behind
  // the freshly rendered list.
  connectEl.classList.add('hidden');
  emptyEl.classList.add('hidden');
  loadingEl.classList.add('hidden');
  showMoreBtn.classList.add('hidden');

  try {
    if (!hasExtensionRuntime()) {
      connectEl.classList.remove('hidden');
      loadingEl.classList.add('hidden');
      emptyEl.classList.remove('hidden');
      allTasks = [];
      listEl.innerHTML = '';
      return;
    }

    // Check if authenticated
    const authenticated = await todoist.isAuthenticated();

    if (!authenticated) {
      connectEl.classList.remove('hidden');
      loadingEl.classList.add('hidden');
      allTasks = [];
      listEl.innerHTML = '';
      return;
    }

    // Authenticated — hide prompt, show loading
    connectEl.classList.add('hidden');
    if (allTasks.length === 0) {
      loadingEl.classList.remove('hidden');
    }

    // Fetch tasks
    const tasks = await todoist.getTasksWithSubtasks({ staleWhileRevalidate: true });

    loadingEl.classList.add('hidden');

    // Sort: priority desc, then due date asc (no due = last)
    allTasks = sortTasks(tasks);

    if (allTasks.length === 0) {
      emptyEl.classList.remove('hidden');
      listEl.innerHTML = '';
      return;
    }

    renderTodos(listEl, showMoreBtn);
  } catch (err) {
    console.error('Failed to load todos:', err);
    loadingEl.classList.add('hidden');

    // If auth expired, show connect prompt
    const stillAuthed = hasExtensionRuntime() ? await todoist.isAuthenticated() : false;
    if (err.status === 401 || err.status === 403 ||
        (err.message && err.message.includes('Authentication expired')) || !stillAuthed) {
      connectEl.classList.remove('hidden');
      allTasks = [];
      listEl.innerHTML = '';
    } else if (allTasks.length === 0) {
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

    const rewardResult = await sendRuntimeMessage({ type: 'ADD_EARNED_TIME', taskCount: 1 });
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
    if (!hasExtensionRuntime()) return;

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

async function loadFocusSnapshot() {
  if (!isWidgetVisible('newtabShowFocusSnapshot')) {
    return;
  }

  try {
    const blockingSummary = await sendRuntimeMessage({ type: 'GET_BLOCKING_SUMMARY' });
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

  // Two number/unit pairs so both units render in the small unit style
  // ("8h 30min"), instead of a giant "8h 30" with only "min" set small.
  return [
    { value: String(hours), unit: 'h' },
    { value: String(remainder), unit: 'min' }
  ];
}

function renderSavedTime(minutes) {
  const savedTimeEl = document.getElementById('focus-snapshot-saved');
  const parts = getSavedTimeParts(minutes);
  savedTimeEl.innerHTML = (Array.isArray(parts) ? parts : [parts])
    .map(({ value, unit }) => (
      `<span class="focus-snapshot-saved-number">${value}</span><span class="focus-snapshot-saved-unit">${unit}</span>`
    ))
    .join('');
}

const DASHBOARD_WIDGETS = {
  calendar: { key: 'newtabShowCalendar', load: loadCalendar },
  weather: { key: 'newtabShowWeather', load: loadWeather },
  todos: { key: 'newtabShowTodos', load: loadTodos },
  completed: { key: 'newtabShowTodos', load: fetchCompletedToday },
  focusSnapshot: { key: 'newtabShowFocusSnapshot', load: loadFocusSnapshot }
};

const widgetStates = {};
let dashboardRefreshIntervalId = null;
let dashboardRefreshStarted = false;
let pendingDashboardStart = null;

function refreshWidget(name) {
  const widget = DASHBOARD_WIDGETS[name];
  if (!widget || !isWidgetVisible(widget.key)) {
    return Promise.resolve();
  }
  const state = widgetStates[name] || (widgetStates[name] = { running: false, queued: false });
  if (state.running) {
    state.queued = true;
    return Promise.resolve();
  }
  state.running = true;
  return Promise.resolve()
    .then(() => widget.load())
    .catch(error => console.error(`Failed to refresh ${name}:`, error))
    .finally(() => {
      state.running = false;
      if (state.queued) {
        state.queued = false;
        refreshWidget(name);
      }
    });
}

function refreshDashboard() {
  return Promise.allSettled(Object.keys(DASHBOARD_WIDGETS).map(refreshWidget));
}

function startDashboardRefresh() {
  dashboardRefreshStarted = true;
  stopDashboardRefresh();
  refreshDashboard();
  dashboardRefreshIntervalId = window.setInterval(() => {
    if (document.visibilityState !== 'visible') {
      return;
    }
    refreshDashboard();
  }, 60000);
}

function stopDashboardRefresh() {
  if (dashboardRefreshIntervalId) {
    clearInterval(dashboardRefreshIntervalId);
    dashboardRefreshIntervalId = null;
  }
}

function clearAuthFailedWidget(name) {
  if (name === 'todos') {
    allTasks = [];
    const listEl = document.getElementById('todo-list');
    if (listEl) listEl.innerHTML = '';
    document.getElementById('todos-connect')?.classList.remove('hidden');
    document.getElementById('todos-empty')?.classList.add('hidden');
    document.getElementById('todos-loading')?.classList.add('hidden');
    document.getElementById('todos-show-more')?.classList.add('hidden');
  } else if (name === 'completed') {
    completedToday = [];
    renderCompletedSection();
    document.getElementById('completed-loading')?.classList.add('hidden');
  } else if (name === 'calendar') {
    const listEl = document.getElementById('event-list');
    if (listEl) listEl.innerHTML = '';
    document.getElementById('calendar-reconnect')?.classList.remove('hidden');
    document.getElementById('calendar-empty')?.classList.add('hidden');
    document.getElementById('calendar-loading')?.classList.add('hidden');
  }
}

function setupVisibilityLifecycle() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      startClock();
      if (dashboardRefreshStarted) {
        startDashboardRefresh();
      }
      if (!pendingBackgroundLoad) {
        applyBackgroundSetting(requestedBackgroundKind);
      }
    } else {
      backgroundGeneration++;
      stopClock();
      stopDashboardRefresh();
    }
  });

  window.addEventListener('pagehide', () => {
    stopClock();
    stopDashboardRefresh();
    if (reminderIntervalId) {
      clearInterval(reminderIntervalId);
      reminderIntervalId = null;
    }
    backgroundGeneration++;
    if (pendingDashboardStart) {
      pendingDashboardStart();
      pendingDashboardStart = null;
    }
    if (pendingBackgroundLoad) {
      pendingBackgroundLoad();
      pendingBackgroundLoad = null;
    }
    teardownActiveBackground();
  });
}

function setupReducedMotionListener() {
  if (!window.matchMedia) return;
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
    applyBackgroundSetting(requestedBackgroundKind);
  });
}

function setupStorageSync() {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;

  const visibilityKeys = [
    'newtabShowWeather',
    'newtabShowQuotes',
    'newtabShowCalendar',
    'newtabShowTodos',
    'newtabShowFocusSnapshot',
    'newtabBackground',
    'newtabShowOceanBackground',
    'newtabOceanBatterySaver',
    'newtabOceanWaveSpeed',
    'bedtimeReminderEnabled',
    'bedtimeReminderTime',
    'bedtimeReminderEndTime',
    'newtabBgImageLight',
    'newtabBgImageDark'
  ];

  const WIDGET_SETTING_KEYS = {
    newtabShowWeather: ['weather'],
    newtabShowCalendar: ['calendar'],
    newtabShowTodos: ['todos', 'completed'],
    newtabShowFocusSnapshot: ['focusSnapshot'],
    newtabTempUnit: ['weather'],
    weatherLat: ['weather'],
    weatherLon: ['weather'],
    todoistToken: ['todos', 'completed'],
    todoistCacheRevision: ['todos', 'completed'],
    calendarSettings: ['calendar']
  };

  const CACHE_WIDGET_KEYS = {
    'focusCache:todoist:tasks': 'todos',
    'focusCache:todoist:completedToday': 'completed',
    'focusCache:calendar:display': 'calendar',
    'focusCache:weather': 'weather'
  };

  let settingsReloadNeeded = false;
  let themeReloadNeeded = false;
  const pendingWidgets = new Set();
  const pendingAuthClears = new Set();
  let flushQueued = false;

  const flush = () => {
    if (flushQueued) return;
    flushQueued = true;
    queueMicrotask(async () => {
      flushQueued = false;
      const reloadSettings = settingsReloadNeeded;
      const reloadTheme = themeReloadNeeded;
      const widgets = [...pendingWidgets];
      const authClears = [...pendingAuthClears];
      settingsReloadNeeded = false;
      themeReloadNeeded = false;
      pendingWidgets.clear();
      pendingAuthClears.clear();

      if (reloadSettings) {
        await loadSettings();
      }
      if (reloadTheme) {
        await loadTheme();
        updateThemeToggleIcon();
        await refreshBgColor();
      }
      for (const name of authClears) {
        clearAuthFailedWidget(name);
      }
      if (document.visibilityState !== 'visible') {
        return;
      }
      for (const name of widgets) {
        refreshWidget(name);
      }
    });
  };

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    const changedKeys = Object.keys(changes);

    if (changedKeys.some(key => visibilityKeys.includes(key))) {
      settingsReloadNeeded = true;
    }

    for (const key of changedKeys) {
      for (const widget of WIDGET_SETTING_KEYS[key] || []) {
        pendingWidgets.add(widget);
      }

      const cacheWidget = CACHE_WIDGET_KEYS[key];
      if (cacheWidget) {
        const change = changes[key];
        if (change?.newValue &&
            (change.newValue.status === 401 || change.newValue.status === 403) &&
            !Object.prototype.hasOwnProperty.call(change.newValue, 'value')) {
          pendingAuthClears.add(cacheWidget);
        } else if (change?.newValue &&
            Object.prototype.hasOwnProperty.call(change.newValue, 'value') &&
            change.newValue.updatedAt !== change.oldValue?.updatedAt) {
          pendingWidgets.add(cacheWidget);
        }
      }
    }

    if (changes.settings) {
      settingsReloadNeeded = true;
      const oldSettings = changes.settings.oldValue || {};
      const newSettings = changes.settings.newValue || {};
      for (const [key, widgets] of Object.entries(WIDGET_SETTING_KEYS)) {
        if (oldSettings[key] !== newSettings[key] && newSettings[key] !== false) {
          widgets.forEach(widget => pendingWidgets.add(widget));
        }
      }
    }

    if (changedKeys.some(key => ['theme', 'themeSyncWithBrowser', 'accentColor'].includes(key))) {
      themeReloadNeeded = true;
    }

    flush();
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
  setupReducedMotionListener();
  setupSettings();
  setupStorageSync();
  setupCalendarConnect();
  setupTodosConnect();
  setupShowMore();
  setupVisibilityLifecycle();

  // Start clock
  startClock();
  startBedtimeReminderRefresh();

  // Load quote
  loadQuote();

  // Load settings and apply visibility
  await loadSettings();

  // Load data (in parallel)
  // Chrome preloads and restores new tabs that are never looked at; both of
  // these hit Todoist, so hold them until the page is actually on screen.
  pendingDashboardStart = runWhenVisible(() => {
    pendingDashboardStart = null;
    startDashboardRefresh();
  });
});
