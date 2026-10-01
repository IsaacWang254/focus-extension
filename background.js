/**
 * Focus Extension - Background Service Worker
 *
 * New tab + Settings only: Google Calendar auth and the planner events feed.
 * All blocking, stats, focus sessions, notifications, and history features
 * were removed in 2.0; runExtensionCleanup() removes their persisted data
 * (including any stale declarativeNetRequest rules) on first run.
 */

import { runExtensionCleanup } from './lib/cleanup.js';
import { withSharedLock } from './lib/request-cache.js';

// =============================================================================
// Toolbar + install
// =============================================================================

// No popup: clicking the toolbar icon opens Settings.
chrome.action?.onClicked.addListener(() => chrome.runtime.openOptionsPage());

const runCleanupOnce = () =>
  runExtensionCleanup({
    storage: chrome.storage.local,
    syncStorage: chrome.storage.sync,
    dnr: chrome.declarativeNetRequest,
    alarms: chrome.alarms,
    notifications: chrome.notifications || null
  }).catch(error => console.error('Extension cleanup failed:', error));

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason !== 'install' && details.reason !== 'update') return;
  runCleanupOnce();
});

// The cleanup marker is only written on success — retry on every startup
// until it sticks (e.g. a DNR call rejecting on update day).
chrome.runtime.onStartup?.addListener(runCleanupOnce);

// =============================================================================
// Messages
// =============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch(error => {
      console.error('Message handler error:', error);
      sendResponse({ error: error.message, ...(error.status ? { status: error.status } : {}) });
    });
  return true;
});

async function handleMessage(message) {
  switch (message.type) {
    case 'GET_SETTINGS': {
      const { settings } = await chrome.storage.local.get('settings');
      return settings || {};
    }
    case 'CONNECT_GOOGLE_CALENDAR':
      return connectGoogleCalendar();
    case 'DISCONNECT_GOOGLE_CALENDAR':
      return disconnectGoogleCalendar();
    case 'GET_CALENDAR_STATUS':
      return getCalendarStatus();
    case 'GET_CALENDAR_LIST': {
      const token = await getValidCalendarToken();
      if (!token) return { error: 'Not connected to Google Calendar', status: 401 };
      return fetchCalendarList(token);
    }
    case 'GET_PLANNER_EVENTS':
      return getPlannerEvents(message.date);
    case 'UPDATE_CALENDAR_SETTINGS':
      return updateCalendarSettings(message.settings);
    default:
      return { error: `Unknown message type: ${message.type}` };
  }
}

// =============================================================================
// Google Calendar
// =============================================================================

/** Google Calendar API base URL. */
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

/**
 * Google Calendar event colorId → hex colour mapping.
 * These are the standard event colours returned by the Calendar API.
 */
const GCAL_EVENT_COLORS = {
  '1': '#7986cb', // Lavender
  '2': '#33b679', // Sage
  '3': '#8e24aa', // Grape
  '4': '#e67c73', // Flamingo
  '5': '#f6bf26', // Banana
  '6': '#f4511e', // Tangerine
  '7': '#039be5', // Peacock
  '8': '#616161', // Graphite
  '9': '#3f51b5', // Blueberry
  '10': '#0b8043', // Basil
  '11': '#d50000', // Tomato
};

/**
 * Default calendar settings
 */
const DEFAULT_CALENDAR_SETTINGS = {
  connected: false,
  accessToken: null,
  refreshToken: null,
  tokenExpiry: null,
  email: null,
  selectedCalendars: [], // calendars shown on the new tab timeline
  calendarListCache: [],
  calendarListCacheTime: null,
  cacheRevision: null
};

const PLANNER_EVENTS_CACHE_KEY = 'focusCache:calendar:planner:v1';
const PLANNER_EVENTS_CACHE_TTL = 5 * 60 * 1000;
const PLANNER_EVENTS_MAX_STALE = 24 * 60 * 60 * 1000;
const PLANNER_EVENTS_CACHE_LIMIT = 14;
const plannerEventRequests = new Map();
async function getCalendarSettings() {
  const result = await chrome.storage.local.get('calendarSettings');
  return { ...DEFAULT_CALENDAR_SETTINGS, ...result.calendarSettings };
}

/**
 * Save calendar settings to storage
 * @param {Object} settings - Settings to save
 */
async function saveCalendarSettings(settings) {
  const current = await getCalendarSettings();
  const updated = { ...current, ...settings };
  await chrome.storage.local.set({ calendarSettings: updated });
  return updated;
}

function getBrowserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
}

function getPlannerDayInfo(dateString) {
  if (typeof dateString !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    throw Object.assign(new Error('date must use YYYY-MM-DD format'), { status: 400 });
  }

  const [year, month, day] = dateString.split('-').map(Number);
  const startOfDay = new Date(year, month - 1, day);
  if (startOfDay.getFullYear() !== year || startOfDay.getMonth() !== month - 1 || startOfDay.getDate() !== day) {
    throw Object.assign(new Error('date must be a real calendar date'), { status: 400 });
  }

  const endOfDay = new Date(startOfDay);
  // setDate keeps this range aligned to browser-local calendar days across DST.
  endOfDay.setDate(endOfDay.getDate() + 1);
  return { dayStr: dateString, startOfDay, endOfDay };
}

function getPlannerEventsScope(settings, dayInfo, timeZone) {
  return JSON.stringify([
    'planner-events-v1',
    settings.cacheRevision || '',
    settings.email || '',
    [...settings.selectedCalendars].sort(),
    timeZone,
    dayInfo.startOfDay.toISOString(),
    dayInfo.endOfDay.toISOString()
  ]);
}

async function getPlannerCacheEntry(scope) {
  const stored = await chrome.storage.local.get(PLANNER_EVENTS_CACHE_KEY);
  return stored[PLANNER_EVENTS_CACHE_KEY]?.entries?.[scope] || null;
}

async function savePlannerCacheEntry(scope, entry) {
  await withSharedLock('planner-events-cache-write', async () => {
    const stored = await chrome.storage.local.get(PLANNER_EVENTS_CACHE_KEY);
    const entries = {
      ...(stored[PLANNER_EVENTS_CACHE_KEY]?.entries || {}),
      [scope]: entry
    };
    const boundedEntries = Object.fromEntries(Object.entries(entries)
      .sort(([, a], [, b]) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, PLANNER_EVENTS_CACHE_LIMIT));
    await chrome.storage.local.set({ [PLANNER_EVENTS_CACHE_KEY]: { entries: boundedEntries } });
  });
}

function buildPlannerEventsPayload(dayInfo, timeZone, entry, { stale = false, partial = false, disconnected = false, error, status } = {}) {
  const updatedAt = entry?.updatedAt || null;
  return {
    date: dayInfo.dayStr,
    timezone: timeZone,
    events: entry?.events || [],
    updatedAt,
    cacheUpdatedAt: updatedAt,
    stale,
    partial,
    disconnected,
    ...(error ? { error } : {}),
    ...(status ? { status } : {})
  };
}

/**
 * Return one complete local calendar day for the planner. Unlike the compact
 * new-tab card this retains earlier, all-day, and overlapping events.
 */
async function getPlannerEvents(dateString) {
  const dayInfo = getPlannerDayInfo(dateString);
  const timeZone = getBrowserTimeZone();
  const settings = await getCalendarSettings();
  if (!settings.connected) {
    return buildPlannerEventsPayload(dayInfo, timeZone, null, {
      disconnected: true,
      error: 'Not connected to Google Calendar'
    });
  }

  const scope = getPlannerEventsScope(settings, dayInfo, timeZone);
  const cached = await getPlannerCacheEntry(scope);
  const cachedAge = cached ? Date.now() - cached.updatedAt : Infinity;
  if (cached && cachedAge >= 0 && cachedAge < PLANNER_EVENTS_CACHE_TTL) {
    return buildPlannerEventsPayload(dayInfo, timeZone, cached, { partial: cached.partial === true });
  }

  if (plannerEventRequests.has(scope)) {
    return plannerEventRequests.get(scope);
  }

  const request = (async () => {
    const token = await getValidCalendarToken();
    if (!token) {
      if (cached && cachedAge >= 0 && cachedAge < PLANNER_EVENTS_MAX_STALE) {
        return buildPlannerEventsPayload(dayInfo, timeZone, cached, {
          stale: true,
          partial: true,
          disconnected: true,
          status: 401
        });
      }
      return buildPlannerEventsPayload(dayInfo, timeZone, null, {
        disconnected: true,
        error: 'Not connected to Google Calendar',
        status: 401
      });
    }

    let result = await fetchEventsForRangeWithToken(token, dayInfo.startOfDay, dayInfo.endOfDay, {
      logLabel: 'planner events',
      emptyTitleFallback: '(No title)'
    });
    if (result.got401 && result.events.length === 0) {
      const freshToken = await forceRefreshCalendarToken();
      if (freshToken && freshToken !== token) {
        result = await fetchEventsForRangeWithToken(freshToken, dayInfo.startOfDay, dayInfo.endOfDay, {
          logLabel: 'planner events',
          emptyTitleFallback: '(No title)'
        });
      }
    }

    const events = filterEventsForDay(result.events, dayInfo.dayStr, dayInfo.startOfDay, dayInfo.endOfDay);
    if (result.failed && events.length === 0) {
      if (cached && cachedAge >= 0 && cachedAge < PLANNER_EVENTS_MAX_STALE) {
        return buildPlannerEventsPayload(dayInfo, timeZone, cached, {
          stale: true,
          partial: true,
          status: result.status
        });
      }
      return buildPlannerEventsPayload(dayInfo, timeZone, null, {
        partial: true,
        error: 'Calendar refresh temporarily unavailable',
        status: result.status
      });
    }

    if (result.failed) {
      const merged = new Map();
      const canUseCached = cached && cachedAge >= 0 && cachedAge < PLANNER_EVENTS_MAX_STALE;
      const savedFailedEvents = canUseCached
        ? (cached.events || []).filter(event => result.failedCalendarIds?.includes(event.calendarId || 'primary'))
        : [];
      for (const event of [...savedFailedEvents, ...events]) {
        const key = event.id || `${event.start || ''}:${event.title || ''}`;
        merged.set(key, event);
      }
      const partialEntry = {
        events: [...merged.values()],
        partial: true,
        updatedAt: cached?.updatedAt || Date.now()
      };
      return buildPlannerEventsPayload(dayInfo, timeZone, partialEntry, {
        stale: Boolean(cached),
        partial: true,
        status: result.status
      });
    }

    const entry = { events, partial: false, updatedAt: Date.now() };
    await savePlannerCacheEntry(scope, entry);
    return buildPlannerEventsPayload(dayInfo, timeZone, entry);
  })();

  plannerEventRequests.set(scope, request);
  try {
    return await request;
  } finally {
    plannerEventRequests.delete(scope);
  }
}

/**
 * Connect to Google Calendar using OAuth2
 * @returns {Promise<Object>}
 */
async function connectGoogleCalendar() {
  try {
    // First try the simpler getAuthToken approach (works if extension is properly configured)
    let token = null;

    try {
      token = await new Promise((resolve, reject) => {
        // Set a timeout to prevent infinite loading
        const timeout = setTimeout(() => {
          reject(new Error('OAuth timeout - please try again'));
        }, 60000); // 60 second timeout

        chrome.identity.getAuthToken({ interactive: true }, (authToken) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (!authToken) {
            reject(new Error('No token received'));
          } else {
            resolve(authToken);
          }
        });
      });
    } catch (authError) {
      console.error('getAuthToken failed:', authError);

      // Fall back to launchWebAuthFlow for development
      token = await launchWebAuthFlowForCalendar();
    }

    if (!token) {
      throw new Error('Failed to obtain access token');
    }

    // Get user info to get email
    let email = null;
    try {
      const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (userInfoResponse.ok) {
        const userInfo = await userInfoResponse.json();
        email = userInfo.email;
      }
    } catch (e) {
      console.warn('Could not fetch user email:', e);
    }

    // Save connection state
    await saveCalendarSettings({
      connected: true,
      accessToken: token,
      tokenExpiry: Date.now() + 3600000, // 1 hour
      email: email,
      cacheRevision: crypto.randomUUID(),
      calendarListCache: [],
      calendarListCacheTime: null
    });
    await chrome.storage.local.remove(PLANNER_EVENTS_CACHE_KEY);

    // Fetch available calendars
    const calendars = await fetchCalendarList(token);

    return {
      success: true,
      email: email,
      calendars: calendars
    };
  } catch (e) {
    console.error('Failed to connect to Google Calendar:', e);
    return { success: false, error: e.message };
  }
}

/**
 * Launch web auth flow as fallback for development
 * @returns {Promise<string>}
 */
async function launchWebAuthFlowForCalendar() {
  // Get the extension's redirect URL
  const redirectUrl = chrome.identity.getRedirectURL();

  // Get client ID from manifest
  const manifest = chrome.runtime.getManifest();
  const clientId = manifest.oauth2?.client_id;

  if (!clientId) {
    throw new Error('No OAuth2 client_id configured in manifest.json');
  }

  const scopes = (manifest.oauth2?.scopes || []).join(' ');

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUrl);
  authUrl.searchParams.set('response_type', 'token');
  authUrl.searchParams.set('scope', scopes + ' https://www.googleapis.com/auth/userinfo.email');
  authUrl.searchParams.set('prompt', 'consent');

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      {
        url: authUrl.toString(),
        interactive: true
      },
      (responseUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!responseUrl) {
          reject(new Error('No response from auth flow'));
          return;
        }

        // Extract token from URL fragment
        const url = new URL(responseUrl);
        const hashParams = new URLSearchParams(url.hash.substring(1));
        const accessToken = hashParams.get('access_token');

        if (!accessToken) {
          reject(new Error('No access token in response'));
          return;
        }

        resolve(accessToken);
      }
    );
  });
}

/**
 * Disconnect from Google Calendar
 * @returns {Promise<Object>}
 */
async function disconnectGoogleCalendar() {
  try {
    const settings = await getCalendarSettings();

    if (settings.accessToken) {
      // Revoke the token
      await new Promise((resolve) => {
        chrome.identity.removeCachedAuthToken({ token: settings.accessToken }, resolve);
      });
    }

    // Clear all calendar settings
    await saveCalendarSettings({
      connected: false,
      accessToken: null,
      refreshToken: null,
      tokenExpiry: null,
      email: null,
      selectedCalendars: [],
      calendarListCache: [],
      calendarListCacheTime: null,
      cacheRevision: crypto.randomUUID()
    });
    await chrome.storage.local.remove(PLANNER_EVENTS_CACHE_KEY);

    return { success: true };
  } catch (e) {
    console.error('Failed to disconnect from Google Calendar:', e);
    return { success: false, error: e.message };
  }
}

/**
 * Get a valid access token, refreshing if needed
 * @returns {Promise<string|null>}
 */
async function getValidCalendarToken() {
  const settings = await getCalendarSettings();

  if (!settings.connected) {
    return null;
  }

  // Check if token is still valid (with 5 min buffer)
  if (settings.accessToken && settings.tokenExpiry && Date.now() < settings.tokenExpiry - 300000) {
    return settings.accessToken;
  }

  // Token looks expired — clear Chrome's internal cache of the old token
  // first, otherwise getAuthToken may return the same stale token.
  if (settings.accessToken) {
    await new Promise(resolve => {
      chrome.identity.removeCachedAuthToken({ token: settings.accessToken }, resolve);
    });
  }

  // Now request a fresh token
  try {
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: false }, (token) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(token);
        }
      });
    });

    if (token) {
      await saveCalendarSettings({
        accessToken: token,
        tokenExpiry: Date.now() + 3600000
      });
      return token;
    }
  } catch (e) {
    console.error('Failed to refresh calendar token:', e);

    const msg = e.message || '';
    const isRevoked = msg.includes('not granted') || msg.includes('revoked');

    if (isRevoked) {
      // Consent was revoked — mark disconnected so the UI shows
      // the "Connect Calendar" button for re-authentication.
      console.log('Calendar OAuth grant revoked, marking disconnected');
      await saveCalendarSettings({
        connected: false,
        accessToken: null,
        tokenExpiry: null,
      });
      await chrome.storage.local.remove(PLANNER_EVENTS_CACHE_KEY);
      return null;
    }

    // Transient network error — fall back to the cached token; the
    // actual API call will surface a real 401 if it's truly expired.
    if (settings.accessToken) {
      console.log('Using cached calendar token as fallback');
      return settings.accessToken;
    }
  }

  return null;
}

/**
 * Force-invalidate the current token and obtain a fresh one.
 * Called after receiving a 401 from the Google Calendar API.
 * @returns {Promise<string|null>}
 */
async function forceRefreshCalendarToken() {
  const settings = await getCalendarSettings();

  if (settings.accessToken) {
    await new Promise(resolve => {
      chrome.identity.removeCachedAuthToken({ token: settings.accessToken }, resolve);
    });
  }

  // Clear stored expiry so getValidCalendarToken doesn't short-circuit
  await saveCalendarSettings({ accessToken: null, tokenExpiry: null });

  try {
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: false }, (token) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(token);
        }
      });
    });

    if (token) {
      await saveCalendarSettings({
        accessToken: token,
        tokenExpiry: Date.now() + 3600000
      });
      return token;
    }
  } catch (e) {
    console.error('Failed to force-refresh calendar token:', e);

    const msg = e.message || '';
    if (msg.includes('not granted') || msg.includes('revoked')) {
      console.log('Calendar OAuth grant revoked, marking disconnected');
      await saveCalendarSettings({
        connected: false,
        accessToken: null,
        tokenExpiry: null,
      });
      await chrome.storage.local.remove(PLANNER_EVENTS_CACHE_KEY);
    }
  }

  return null;
}

async function fetchWithRetry(url, options, maxRetries = 2) {
  let attempts = 0;
  while (attempts < maxRetries) {
    attempts++;
    try {
      const response = await fetch(url, {
        ...options,
        signal: options?.signal || AbortSignal.timeout(15000)
      });
      return response;
    } catch (e) {
      if (attempts >= maxRetries) throw e;
      await new Promise(resolve => setTimeout(resolve, 500 * attempts));
    }
  }
}
/**
 * Fetch list of user's calendars
 * @param {string} token - Access token
 * @returns {Promise<Array>}
 */
async function fetchCalendarList(token, forceRefresh = false) {
  const settings = await getCalendarSettings();
  if (!forceRefresh && settings.calendarListCache.length > 0 && Date.now() - settings.calendarListCacheTime < 3600000) {
    return settings.calendarListCache;
  }
  try {
    const items = [];
    const seenPageTokens = new Set();
    let pageToken = null;
    do {
      const params = new URLSearchParams();
      if (pageToken) params.set('pageToken', pageToken);
      const response = await fetchWithRetry(`${GOOGLE_CALENDAR_API}/users/me/calendarList${params.toString() ? `?${params}` : ''}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        throw new Error(`Calendar API error: ${response.status}`);
      }

      const data = await response.json();
      items.push(...(data.items || []));
      pageToken = data.nextPageToken || null;
    } while (pageToken && !seenPageTokens.has(pageToken) && seenPageTokens.add(pageToken));

    const calendars = items.map(cal => ({
      id: cal.id,
      name: cal.summary,
      description: cal.description || '',
      color: cal.backgroundColor || '#4285f4',
      primary: cal.primary || false,
      accessRole: cal.accessRole
    }));
    await saveCalendarSettings({
      calendarListCache: calendars,
      calendarListCacheTime: Date.now()
    });
    return calendars;
  } catch (e) {
    console.error('Failed to fetch calendar list:', e);
    return [];
  }
}

function getSafeHttpsUrl(value) {
  if (!value || typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function getSafeCalendarEventLink(value) {
  const link = getSafeHttpsUrl(value);
  if (!link) return '';
  const host = new URL(link).hostname.toLowerCase();
  return host === 'calendar.google.com' || host === 'www.google.com' ? link : '';
}

function getSafeMeetingLink(event) {
  const entryPoint = event.conferenceData?.entryPoints?.find(point => point.entryPointType === 'video' && point.uri);
  return getSafeHttpsUrl(entryPoint?.uri);
}

async function fetchCalendarEventPages(token, calendarId, baseParams) {
  const items = [];
  const seenPageTokens = new Set();
  let pageToken = null;

  do {
    const params = new URLSearchParams(baseParams);
    if (pageToken) params.set('pageToken', pageToken);
    const response = await fetchWithRetry(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!response.ok) return { response, items };

    const data = await response.json();
    items.push(...(data.items || []));
    pageToken = data.nextPageToken || null;
  } while (pageToken && !seenPageTokens.has(pageToken) && seenPageTokens.add(pageToken));

  return { response: null, items };
}

/**
 * Fetch upcoming events from selected calendars
 * @param {number} days - Number of days ahead to fetch
 * @returns {Promise<Array>}
 */
async function fetchEventsForRangeWithToken(token, startOfRange, endOfRange, { logLabel, emptyTitleFallback }) {
  const settings = await getCalendarSettings();
  const calendarsToFetch = settings.selectedCalendars.length > 0
    ? settings.selectedCalendars
    : ['primary'];

  // Build calendar-id → color map from stored calendar list
  const calList = await fetchCalendarList(token);
  const calColorMap = {};
  const calNameMap = {};
  for (const cal of calList) {
    calColorMap[cal.id] = cal.color;
    calNameMap[cal.id] = cal.name;
  }

  const timeMin = startOfRange.toISOString();
  const timeMax = endOfRange.toISOString();

  const allEvents = [];
  let fetchFailed = false;
  let got401 = false;
  const failureStatuses = [];
  const failedCalendarIds = [];
  let failureRetryAfterMs = 0;
  await Promise.allSettled(calendarsToFetch.map(async (calendarId) => {
    try {
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '100'
      });

      const { response, items } = await fetchCalendarEventPages(token, calendarId, params);

      if (response?.status === 401) {
        got401 = true;
        fetchFailed = true;
        failedCalendarIds.push(calendarId);
        failureStatuses.push(401);
        return;
      }

      if (response) {
        console.error(`Failed to fetch ${logLabel} from calendar ${calendarId}:`, response.status);
        fetchFailed = true;
        failedCalendarIds.push(calendarId);
        failureStatuses.push(response.status);
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          if (retryAfter) {
            const seconds = Number(retryAfter);
            const retryMs = Number.isFinite(seconds)
              ? seconds * 1000
              : Math.max(0, Date.parse(retryAfter) - Date.now());
            failureRetryAfterMs = Math.max(failureRetryAfterMs, retryMs);
          }
        }
        return;
      }

      const calColor = calColorMap[calendarId] || '#4285f4';

      for (const event of items) {
        const startTime = event.start?.dateTime || event.start?.date;
        const endTime = event.end?.dateTime || event.end?.date;

        if (!startTime || !endTime) continue;

        const title = (event.summary || '').trim();
        if (isCompletedCalendarEventTitle(title)) continue;

        // Per-event colorId overrides the calendar color
        const eventColor = event.colorId
          ? (GCAL_EVENT_COLORS[event.colorId] || calColor)
          : calColor;

        allEvents.push({
          id: event.id,
          calendarId: calendarId,
          calendarName: calNameMap[calendarId] || calendarId,
          title: title || emptyTitleFallback,
          description: event.description || '',
          start: startTime,
          end: endTime,
          isAllDay: !event.start?.dateTime,
          location: event.location || '',
          status: event.status,
          htmlLink: getSafeCalendarEventLink(event.htmlLink),
          meetingLink: getSafeMeetingLink(event),
          color: eventColor
        });
      }
    } catch (e) {
      console.error(`Error fetching ${logLabel} from calendar ${calendarId}:`, e);
      fetchFailed = true;
      failedCalendarIds.push(calendarId);
    }
  }));

  const status = failureStatuses.includes(401) ? 401
    : failureStatuses.includes(403) ? 403
    : failureStatuses.includes(429) ? 429
    : (failureStatuses[0] || 503);

  return { events: allEvents, failed: fetchFailed, failedCalendarIds, got401, status, retryAfterMs: failureRetryAfterMs };
}

/**
 * Filter a list of events down to those that fall on a given day.
 */
function filterEventsForDay(events, dayStr, startOfDay, endOfDay) {
  const filtered = (events || []).filter(event => {
    const title = (event.title || '').trim();
    if (isCompletedCalendarEventTitle(title)) return false;

    if (event.isAllDay) {
      const eventStartDate = event.start.split('T')[0];
      const eventEndDate = event.end.split('T')[0];
      return eventStartDate <= dayStr && eventEndDate > dayStr;
    }

    const start = new Date(event.start).getTime();
    const end = new Date(event.end).getTime();
    // Include events that overlap with today at all
    return start < endOfDay.getTime() && end > startOfDay.getTime();
  });

  filtered.sort((a, b) => new Date(a.start) - new Date(b.start));
  return filtered;
}

function isCompletedCalendarEventTitle(title) {
  const trimmedTitle = (title || '').trim();
  return trimmedTitle.startsWith('✓') || trimmedTitle.startsWith('✔');
}

async function updateCalendarSettings(updates) {
  const current = await getCalendarSettings();
  const next = { ...updates };
  if (updates.selectedCalendars &&
      JSON.stringify([...updates.selectedCalendars].sort()) !== JSON.stringify([...current.selectedCalendars].sort())) {
    next.cacheRevision = crypto.randomUUID();
  }
  const updated = await saveCalendarSettings(next);
  if (next.cacheRevision) {
    await chrome.storage.local.remove(PLANNER_EVENTS_CACHE_KEY);
  }

  return updated;
}

/**
 * Get calendar connection status and settings
 * @returns {Promise<Object>}
 */
async function getCalendarStatus() {
  const settings = await getCalendarSettings();

  return {
    connected: settings.connected,
    email: settings.email,
    selectedCalendars: settings.selectedCalendars,
    calendars: settings.calendarListCache
  };
}
