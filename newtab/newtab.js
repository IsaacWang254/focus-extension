/**
 * New Tab Page
 * Shows clock, weather, Google Calendar events, and Todoist tasks
 */

import { createRuntimeMessenger } from '../lib/runtime.js';
import {
  isThemeSyncEnabled,
  loadTheme
} from '../lib/theme.js';
import { getCachedResource, withSharedLock } from '../lib/request-cache.js';
import { runWhenVisible } from '../lib/when-visible.js';
import {
  handlePlannerStorageChange,
  initPlannerDashboard,
  refreshPlannerDashboard,
  refreshPlannerTime
} from './planner.js';
import { setIconButton, setupPlannerTooltips } from './planner-controls.js';

// =============================================================================
// CONSTANTS
// =============================================================================


const WEATHER_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

const DEFAULTS = {
  newtabShowWeather: true,
  newtabShowCalendar: true,
  newtabShowTodos: true,
  newtabTempUnit: 'C', // 'C' or 'F'
};

let dashboardSettings = { ...DEFAULTS };

function isWidgetVisible(key) {
  return document.visibilityState === 'visible' && dashboardSettings[key] !== false;
}

const previewStorage = {};

function getPreviewResponse(message) {
  switch (message.type) {
    case 'GET_SETTINGS':
      return { ...DEFAULTS };
    case 'GET_CALENDAR_STATUS':
      return { connected: false };
    case 'GET_PLANNER_EVENTS':
      return { date: message.date, events: [] };
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

function setupBrowserThemeSyncListener() {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', async () => {
    const result = await getLocal('themeSyncWithBrowser');
    if (!isThemeSyncEnabled(result.themeSyncWithBrowser)) return;
    await loadTheme();
  });
}

// =============================================================================
// ICONS
// =============================================================================

function setupIcons() {
  const modKey = /mac/i.test(navigator.platform || navigator.userAgent || '') ? '⌘K' : 'Ctrl+K';
  setIconButton('add-task-btn', { icon: Icons.plus, label: `Add task (${modKey})` });
  setIconButton('view-tasks-btn', { icon: Icons.externalLink });
  setIconButton('view-schedule-btn', { icon: Icons.calendarDot });
  setIconButton('back-to-now-btn', { icon: Icons.chevronUp, label: 'Back to now' });
  setIconButton('edit-modal-close', { icon: Icons.x, label: 'Close' });
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
  const clock = document.getElementById('clock');
  clock.dataset.leadingDigit = hours[0];
  clock.innerHTML = `
    <span class="clock-part">${hours}</span>
    <span class="clock-separator" aria-hidden="true">:</span>
    <span class="clock-part">${minutes}</span>
  `;
  refreshPlannerTime();
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

function updateDate() {
  const now = new Date();
  const formatted = now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const dateEl = document.getElementById('full-date');
  if (dateEl) {
    dateEl.textContent = formatted;
  }
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
  document.getElementById('weather-highlow').textContent = `· H ${high}° · L ${low}°`;

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

async function loadSettings() {
  const settings = {
    ...DEFAULTS,
    ...(await sendRuntimeMessage({ type: 'GET_SETTINGS' }))
  };

  dashboardSettings = settings;

  // Apply visibility
  applyVisibility(settings);

  return settings;
}

function applyVisibility(settings) {
  const weatherSection = document.getElementById('weather-section');
  weatherSection?.classList.toggle('hidden', !settings.newtabShowWeather);
  document.getElementById('tasks-section')?.classList.toggle('hidden', !settings.newtabShowTodos);
  document.getElementById('today-timeline-section')?.classList.toggle('hidden', !settings.newtabShowCalendar);
}

const DASHBOARD_WIDGETS = {
  weather: { key: 'newtabShowWeather', load: loadWeather },
  planner: { key: 'planner', load: refreshPlannerDashboard }
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
  if (name === 'planner') refreshPlannerDashboard();
}

function setupVisibilityLifecycle() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      startClock();
      refreshPlannerTime({ recenter: true });
      if (dashboardRefreshStarted) {
        startDashboardRefresh();
      }
    } else {
      stopClock();
      stopDashboardRefresh();
    }
  });

  window.addEventListener('pagehide', () => {
    stopClock();
    stopDashboardRefresh();
    if (pendingDashboardStart) {
      pendingDashboardStart();
      pendingDashboardStart = null;
    }
  });
}

function setupStorageSync() {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;

  const visibilityKeys = [
    'newtabShowWeather',
    'newtabShowCalendar',
    'newtabShowTodos'
  ];

  const WIDGET_SETTING_KEYS = {
    newtabShowWeather: ['weather'],
    newtabShowCalendar: ['planner'],
    newtabShowTodos: ['planner'],
    newtabTempUnit: ['weather'],
    weatherLat: ['weather'],
    weatherLon: ['weather'],
    todoistToken: ['planner'],
    todoistCacheRevision: ['planner'],
    calendarSettings: ['planner'],
    newtabPlannerState: ['planner']
  };

  const CACHE_WIDGET_KEYS = {
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
    handlePlannerStorageChange(changes);

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
  setupPlannerTooltips();

  // Setup interactions
  setupBrowserThemeSyncListener();
  setupStorageSync();
  setupVisibilityLifecycle();
  initPlannerDashboard({
    sendRuntimeMessage,
    getLocal,
    setLocal,
    isVisible: isWidgetVisible
  });

  // Start clock
  startClock();

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
