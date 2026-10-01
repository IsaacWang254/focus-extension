import assert from 'node:assert/strict';

const { runExtensionCleanup, STORAGE_KEEP_KEYS, CLEANUP_VERSION } = await import('../lib/cleanup.js');

function fakeStorage(initial) {
  const store = { ...initial };
  return {
    store,
    removed: [],
    async get(keys) {
      if (keys == null) return { ...store };
      const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      return Object.fromEntries(list.filter(k => k in store).map(k => [k, store[k]]));
    },
    async set(values) { Object.assign(store, values); },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      this.removed.push(...list);
      list.forEach(k => delete store[k]);
    }
  };
}

function fakeDnr(dynamic = [], session = []) {
  return {
    calls: [],
    async getDynamicRules() { return dynamic; },
    async getSessionRules() { return session; },
    async updateDynamicRules(arg) { this.calls.push(['dynamic', arg]); },
    async updateSessionRules(arg) { this.calls.push(['session', arg]); }
  };
}

// A storage snapshot from an old install: blocking data, stats, focus
// sessions, quotes, shaders, background images, bedtime — plus the keys the
// remaining surfaces still need.
const OLD_KEYS = {
  blockedSites: ['x.com'],
  allowedSites: ['github.com'],
  whitelist: ['docs.google.com'],
  xp: 1200,
  level: 4,
  achievements: ['first-block'],
  streakDays: 9,
  productivityHistory: { '2025-01-01': 80 },
  unblockReasons: [{ domain: 'x.com', reason: 'research' }],
  profiles: [{ id: 'work' }],
  activeProfileId: 'work',
  focusSession: { startedAt: 1 },
  focusSessionHistory: [],
  quoteOfDay: { text: 'q' },
  newtabBgImageLight: 'data:image/png;base64,x',
  newtabBgImageDark: 'data:image/png;base64,y',
  newtabBackground: 'ocean',
  newtabShowOceanBackground: true,
  newtabOceanBatterySaver: true,
  newtabOceanWaveSpeed: 0.9,
  bedtimeReminderEnabled: true,
  bedtimeReminderTime: '22:30',
  bedtimeReminderEndTime: '07:00',
  earnedTimeBank: 45,
  dailyUsage: {},
  tempUnblocks: [],
  categories: [],
  blockedKeywords: { keywords: ['shorts'] },
  statsHistory: [],
  // v2 leftover: the removed "current task" pin.
  newtabPlannerState: { taskId: 't1' }
};

const KEEP_KEYS = {
  theme: 'dark',
  themeSyncWithBrowser: false,
  accentColor: '#111111',
  settings: {
    newtabShowTodos: true, newtabShowCalendar: true, newtabShowWeather: false, newtabTempUnit: 'F',
    // Blocking-era fields that must be pruned:
    blockedSites: ['x.com'], blocklistMode: true, schedules: [], unblockMethod: 'phrase',
    pomodoroLength: 25, enableNotifications: true
  },
  todoistToken: 'tok',
  todoistCacheRevision: 'rev',
  'focusCache:todoist:tasks': { entries: {} },
  weatherLat: 40,
  weatherLon: -74,
  weatherCache: { current: {} },
  weatherCacheTime: 1,
  weatherCacheScope: 's',
  'focusCache:weather': { scope: 's' },
  calendarSettings: {
    connected: true,
    accessToken: 'cal-tok',
    email: 'a@b.c',
    selectedCalendars: ['primary'],
    calendarListCache: [{ id: 'primary' }],
    calendarListCacheTime: 123,
    cacheRevision: 'r1',
    // Blocking-era fields that must be pruned:
    profileMapping: { work: ['x.com'] },
    autoSwitchProfiles: true,
    focusEventKeywords: ['focus'],
    breakEventKeywords: ['break'],
    syncEnabled: true,
    upcomingEvents: [{ id: 'e' }],
    lastSync: 999
  }
};

{
  const local = fakeStorage({ ...OLD_KEYS, ...KEEP_KEYS });
  const sync = fakeStorage({ blockedSites: ['x.com'], theme: 'dark' });
  const dnr = fakeDnr([{ id: 1 }, { id: 7 }, { id: 42 }], [{ id: 3 }]);
  const clearedAlarms = [];
  const alarms = { async getAll() { return [{ name: 'bedtime-check' }, { name: 'calendar-sync' }]; }, async clear(n) { clearedAlarms.push(n); } };

  const result = await runExtensionCleanup({
    storage: local, syncStorage: sync, dnr, alarms, notifications: null
  });

  // Every old key removed, every keep key intact.
  for (const key of Object.keys(OLD_KEYS)) {
    assert.ok(!(key in local.store), `old key ${key} must be removed`);
  }
  for (const [key, value] of Object.entries(KEEP_KEYS)) {
    if (key === 'calendarSettings' || key === 'settings') continue;
    assert.deepEqual(local.store[key], value, `kept key ${key} must be intact`);
  }
  assert.ok(result.removedKeys.includes('xp') && result.removedKeys.includes('profiles'));

  // The settings object is pruned to the new-tab fields only.
  const st = local.store.settings;
  assert.deepEqual(Object.keys(st).sort(),
    ['newtabShowCalendar', 'newtabShowTodos', 'newtabShowWeather', 'newtabTempUnit'].sort(),
    'blocking-era settings fields pruned');
  assert.equal(st.newtabTempUnit, 'F');

  // calendarSettings pruned to the whitelisted fields.
  assert.ok(result.prunedKeys.includes('calendarSettings') && result.prunedKeys.includes('settings'));
  const cs = local.store.calendarSettings;
  assert.equal(cs.connected, true);
  assert.equal(cs.selectedCalendars[0], 'primary');
  assert.ok(!('profileMapping' in cs) && !('focusEventKeywords' in cs) && !('syncEnabled' in cs),
    'blocking-era calendarSettings fields pruned');

  // All DNR rule ids removed — dynamic and session.
  assert.deepEqual(dnr.calls[0][1].removeRuleIds.sort((a, b) => a - b), [1, 7, 42]);
  assert.deepEqual(dnr.calls[1][1].removeRuleIds, [3]);

  // Alarms cleared; sync storage emptied; marker written.
  assert.deepEqual(clearedAlarms.sort(), ['bedtime-check', 'calendar-sync']);
  assert.deepEqual(Object.keys(sync.store), []);
  assert.equal(local.store.cleanupVersion, CLEANUP_VERSION);

  // Runs once: a second call is a no-op.
  const dnr2 = fakeDnr([{ id: 99 }], []);
  const again = await runExtensionCleanup({ storage: local, syncStorage: sync, dnr: dnr2, alarms, notifications: null });
  assert.deepEqual(again.removedKeys, []);
  assert.equal(dnr2.calls.length, 0, 'second run must not touch DNR');
}

{
  // A failing step (e.g. DNR rejection) must leave the marker unset so the
  // next startup retries — and the retry must complete.
  const local = fakeStorage({ ...OLD_KEYS, theme: 'light' });
  const failingDnr = {
    async getDynamicRules() { return [{ id: 1 }]; },
    async getSessionRules() { return []; },
    async updateDynamicRules() { throw new Error('DNR unavailable'); },
    async updateSessionRules() {}
  };
  await assert.rejects(() => runExtensionCleanup({
    storage: local, syncStorage: null, dnr: failingDnr, alarms: null, notifications: null
  }), /DNR unavailable/);
  assert.equal(local.store.cleanupVersion, undefined, 'marker must not be set on failure');
  assert.equal(local.store.blockedSites !== undefined, true, 'storage untouched when DNR fails');

  const ok = fakeDnr([{ id: 1 }], []);
  const retry = await runExtensionCleanup({ storage: local, syncStorage: null, dnr: ok, alarms: null, notifications: null });
  assert.ok(retry.removedKeys.length > 0, 'retry removes the old keys');
  assert.equal(local.store.cleanupVersion, CLEANUP_VERSION, 'retry completes and sets the marker');
  assert.equal(local.store.blockedSites, undefined);
}

{
  // First run with no legacy data still writes the marker and doesn't crash
  // with missing dnr/alarms/notifications.
  const local = fakeStorage({ theme: 'light' });
  const result = await runExtensionCleanup({ storage: local, syncStorage: null, dnr: null, alarms: null, notifications: null });
  assert.equal(local.store.cleanupVersion, CLEANUP_VERSION);
  assert.equal(local.store.theme, 'light');
  assert.deepEqual(result.removedKeys, []);
}

{
  // An install already cleaned to '2' re-runs under '3' and drops the
  // leftover newtabPlannerState pin; everything else stays intact.
  const local = fakeStorage({ cleanupVersion: '2', newtabPlannerState: { taskId: 't1' }, theme: 'dark', newtabTempUnit: 'F' });
  const dnr = fakeDnr([], []);
  const result = await runExtensionCleanup({ storage: local, syncStorage: null, dnr, alarms: null, notifications: null });
  assert.ok(!('newtabPlannerState' in local.store), 'newtabPlannerState removed on the v3 run');
  assert.equal(local.store.cleanupVersion, '3');
  assert.equal(local.store.theme, 'dark');
  assert.equal(local.store.newtabTempUnit, 'F');
  assert.deepEqual(result.removedKeys, ['newtabPlannerState']);
}

// The keep-list is the single source of truth — every key the remaining code
// touches must be in it.
assert.ok(STORAGE_KEEP_KEYS.has('settings') && STORAGE_KEEP_KEYS.has('todoistToken')
  && STORAGE_KEEP_KEYS.has('calendarSettings') && STORAGE_KEEP_KEYS.has('focusCache:calendar:planner:v1'));

console.log('extension-cleanup tests passed');
