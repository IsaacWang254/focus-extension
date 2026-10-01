/**
 * One-time clean-up for the 2.0 strip-down.
 *
 * The blocking feature, stats, popup, shaders, background images, focus
 * sessions, and the bedtime reminder were removed. Old installs still carry
 * their data — including declarativeNetRequest rules that persist across
 * updates and would keep sites blocked forever with no UI left to unblock.
 * This module runs once (guarded by a `cleanupVersion` marker in storage)
 * and removes everything the remaining surfaces do not read or write.
 */

/**
 * Storage keys the remaining surfaces (new tab + Settings + worker) use.
 * Everything else in chrome.storage.local is deleted. chrome.storage.sync
 * is cleared entirely — nothing remaining reads or writes it.
 */
export const STORAGE_KEEP_KEYS = new Set([
  // The marker itself.
  'cleanupVersion',
  // Shared settings object: new-tab visibility toggles live here
  // (newtabShowWeather / newtabShowTodos / newtabShowCalendar).
  'settings',
  // Theme (read by lib/theme.js on every surface).
  'theme',
  'themeSyncWithBrowser',
  'accentColor',
  // Todoist: token + cache revision + task/metadata caches.
  'todoistToken',
  'todoistCacheRevision',
  'focusCache:todoist:tasks',
  'focusCache:todoist:labels',
  'focusCache:todoist:projects',
  // Weather: last-known coordinates and payload caches.
  'weatherLat',
  'weatherLon',
  'weatherLocationRetryAt',
  'weatherCache',
  'weatherCacheTime',
  'weatherCacheScope',
  'focusCache:weather',
  // Temperature unit toggle.
  'newtabTempUnit',
  // Google Calendar: connection + selection + planner event cache.
  'calendarSettings',
  'focusCache:calendar:planner:v1'
]);

export const CLEANUP_VERSION = '3';

/**
 * calendarSettings used to carry blocking-only fields (profile mapping,
 * event keywords, auto-switch flags, sync bookkeeping, upcomingEvents). Keep
 * exactly the fields the remaining code reads.
 */
export const CALENDAR_SETTINGS_FIELDS = [
  'connected', 'accessToken', 'refreshToken', 'tokenExpiry', 'email',
  'selectedCalendars', 'calendarListCache', 'calendarListCacheTime',
  'cacheRevision'
];

/**
 * The shared `settings` object used to carry the whole blocking configuration
 * (site lists, modes, schedules, unblock rules, profiles). Keep exactly the
 * fields the remaining code reads — the new-tab visibility toggles and the
 * temperature unit.
 */
export const SETTINGS_FIELDS = [
  'newtabShowWeather', 'newtabShowTodos', 'newtabShowCalendar', 'newtabTempUnit'
];

export function keepStorageKey(key) {
  return STORAGE_KEEP_KEYS.has(key);
}

function pickFields(value, fields) {
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    fields.filter(field => field in value)
      .map(field => [field, value[field]])
  );
}

/**
 * Run the clean-up. Dependencies are injected so tests can drive it with
 * fakes; background.js passes the real chrome.* APIs.
 * @returns {Promise<{removedKeys: string[], prunedKeys: string[]}>}
 */
export async function runExtensionCleanup({
  storage,      // chrome.storage.local-compatible {get,set,remove}
  syncStorage,  // chrome.storage.sync-compatible, may be null
  dnr,          // chrome.declarativeNetRequest-compatible, may be null
  alarms,       // chrome.alarms-compatible, may be null
  notifications // chrome.notifications-compatible, may be null
}) {
  const { cleanupVersion } = await storage.get('cleanupVersion');
  if (cleanupVersion === CLEANUP_VERSION) return { removedKeys: [], prunedKeys: [] };

  // Blocking rules persist across updates — remove every dynamic and
  // session rule before anything else.
  if (dnr) {
    const dynamic = await dnr.getDynamicRules?.() || [];
    if (dynamic.length) {
      await dnr.updateDynamicRules({ removeRuleIds: dynamic.map(rule => rule.id) });
    }
    const session = await dnr.getSessionRules?.() || [];
    if (session.length) {
      await dnr.updateSessionRules({ removeRuleIds: session.map(rule => rule.id) });
    }
  }

  // Nothing left recreates alarms or notifications.
  if (alarms?.clear) {
    for (const alarm of await alarms.getAll?.() || []) await alarms.clear(alarm.name);
  }
  if (notifications?.clear) {
    for (const id of Object.keys(await notifications.getAll?.() || {})) {
      await notifications.clear(id);
    }
  }

  // Storage: remove everything not on the keep-list; prune nested settings.
  const all = await storage.get(null);
  const removedKeys = Object.keys(all).filter(key => !keepStorageKey(key));
  if (removedKeys.length) await storage.remove(removedKeys);
  const prunedKeys = [];
  for (const [key, fields] of [
    ['calendarSettings', CALENDAR_SETTINGS_FIELDS],
    ['settings', SETTINGS_FIELDS]
  ]) {
    const value = all[key];
    if (!value || typeof value !== 'object') continue;
    const pruned = pickFields(value, fields);
    if (JSON.stringify(pruned) !== JSON.stringify(value)) {
      await storage.set({ [key]: pruned });
      prunedKeys.push(key);
    }
  }
  if (syncStorage) {
    const syncAll = await syncStorage.get(null);
    const syncKeys = Object.keys(syncAll);
    if (syncKeys.length) await syncStorage.remove(syncKeys);
  }

  // Marker goes last: if anything above throws, the next startup retries.
  await storage.set({ cleanupVersion: CLEANUP_VERSION });
  return { removedKeys, prunedKeys };
}
