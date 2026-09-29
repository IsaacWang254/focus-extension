/**
 * New Tab Page
 * Shows clock, motivational quote, Google Calendar events, and Todoist tasks
 */

import { createRuntimeMessenger, hasExtensionRuntime } from '../lib/runtime.js';
import {
  applyAccentColorFromStorage,
  getEffectiveThemeBase,
  isThemeSyncEnabled,
  loadTheme,
  resolveThemeVariant
} from '../lib/theme.js';
import { setIconButtonLabel } from '../lib/design-theme.js';
import { resolveNewtabBackground } from '../lib/newtab-background.js';
import { getCachedResource, withSharedLock } from '../lib/request-cache.js';
import { runWhenVisible } from '../lib/when-visible.js';
import {
  handlePlannerStorageChange,
  initPlannerDashboard,
  refreshPlannerDashboard
} from './planner.js';

// =============================================================================
// CONSTANTS
// =============================================================================


const WEATHER_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

const DEFAULTS = {
  newtabShowWeather: true,
  newtabShowCalendar: true,
  newtabShowTodos: true,
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
    case 'GET_PLANNER_EVENTS':
      return { date: message.date, events: [] };
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
  const icons = {
    'settings-icon': Icons.settings,
    'settings-close-icon': Icons.x,
    'bedtime-reminder-icon': Icons.moon
  };
  for (const [id, markup] of Object.entries(icons)) {
    const target = document.getElementById(id);
    if (target) target.innerHTML = markup;
  }
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
  weatherSection?.classList.toggle('hidden', !settings.newtabShowWeather);
  document.getElementById('brief-now')?.classList.toggle('hidden', !settings.newtabShowTodos);
  document.getElementById('tasks-preview')?.classList.toggle('hidden', !settings.newtabShowTodos);
  document.getElementById('brief-next')?.classList.toggle('hidden', !settings.newtabShowCalendar);
  document.getElementById('agenda-preview')?.classList.toggle('hidden', !settings.newtabShowCalendar);
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
    'newtabShowCalendar',
    'newtabShowTodos',
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

  // Setup interactions
  setupThemeToggle();
  setupBrowserThemeSyncListener();
  setupReducedMotionListener();
  setupSettings();
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
  startBedtimeReminderRefresh();

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
