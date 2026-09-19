import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const backgroundSource = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8');
const start = backgroundSource.indexOf('const GOOGLE_CALENDAR_API =');
const end = backgroundSource.indexOf('function scoreKeywordMatch(', start);
assert.ok(start > 0 && end > start, 'calendar slice anchors moved');
const slice = backgroundSource.slice(start, end);

const updateStart = backgroundSource.indexOf('async function updateCalendarSettings(');
const updateEnd = backgroundSource.indexOf('/**\n * Get calendar connection status', updateStart);
assert.ok(updateStart > 0 && updateEnd > updateStart, 'updateCalendarSettings anchors moved');
const updateSlice = backgroundSource.slice(updateStart, updateEnd);

const cacheSource = fs.readFileSync(new URL('../lib/request-cache.js', import.meta.url), 'utf8')
  .replace(/^export /gm, '');

const FIXED_NOW = new Date(2026, 8, 13, 12).getTime();
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function harness({ eventItems = [], failStatus = null, failCalendarIds = [] } = {}) {
  const counts = { calendarList: 0, calendarEvents: 0 };
  let now = FIXED_NOW;
  let eventsGate = null;
  let nextItems = eventItems;

  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }

  const store = {
    calendarSettings: {
      connected: true,
      accessToken: 'cal-token',
      tokenExpiry: now + 3600000,
      email: 'fixture@example.com',
      selectedCalendars: ['primary'],
      cacheRevision: 'cal-rev',
      upcomingEvents: [],
      calendarListCache: [],
      calendarListCacheTime: null,
      lastSync: null
    }
  };

  let authFailuresLeft = 0;
  let refreshedToken = null;

  const fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/calendarList')) {
      counts.calendarList++;
      await flush();
      return new Response(JSON.stringify({ items: [{ id: 'primary', summary: 'Fixture' }] }));
    }
    if (url.pathname.endsWith('/events')) {
      counts.calendarEvents++;
      await flush();
      if (eventsGate) await eventsGate;
      const calendarId = decodeURIComponent(url.pathname.split('/calendars/')[1]?.split('/events')[0] || '');
      if (failCalendarIds.includes(calendarId)) {
        return new Response('fail', { status: 500 });
      }
      if (authFailuresLeft > 0) {
        authFailuresLeft--;
        return new Response('Unauthorized', { status: 401 });
      }
      if (failStatus) return new Response('fail', { status: failStatus });
      return new Response(JSON.stringify({ items: nextItems }));
    }
    if (url.hostname === 'www.googleapis.com' && url.pathname.includes('userinfo')) {
      return new Response(JSON.stringify({ email: 'fixture@example.com' }));
    }
    throw new Error(`Unexpected fixture request: ${url.origin}${url.pathname}`);
  };

  const storage = {
    async get(keys) {
      if (keys == null) return structuredClone(store);
      if (typeof keys === 'string') return { [keys]: structuredClone(store[keys]) };
      const list = Array.isArray(keys) ? keys : Object.keys(keys);
      return structuredClone(Object.fromEntries(list.map(k => [k, store[k] ?? (Array.isArray(keys) ? undefined : keys[k])])));
    },
    async set(values) { Object.assign(store, structuredClone(values)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key]; }
  };

  const sandbox = {
    chrome: {
      storage: { local: storage, onChanged: { addListener() {} } },
      identity: {
        getAuthToken: (opts, cb) => cb(refreshedToken || (refreshedToken = 'fresh-cal-token')),
        removeCachedAuthToken: (opts, cb) => cb(),
        getRedirectURL: () => 'https://fixture.chromiumapp.org/',
        launchWebAuthFlow: (opts, cb) => cb('https://fixture/#access_token=flow-token')
      },
      alarms: { clear: async () => {} },
      runtime: { id: 'fixture', getManifest: () => ({ oauth2: { client_id: 'x', scopes: [] } }) }
    },
    fetch, Date: Clock, URL, URLSearchParams, Response,
    AbortSignal, structuredClone, crypto, console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, queueMicrotask
  };
  vm.createContext(sandbox);
  vm.runInContext(cacheSource, sandbox);
  vm.runInContext(`${slice}\n${updateSlice}
this.api = { getNewTabEvents, connectGoogleCalendar, disconnectGoogleCalendar,
  getCalendarSettings, saveCalendarSettings, updateCalendarSettings, getCachedEvents };`, sandbox);

  return {
    api: sandbox.api, counts, store,
    setAuthFailures(n) { authFailuresLeft = n; },
    setEventItems(items) { nextItems = items; },
    advanceMs(ms) { now += ms; },
    nextDay() { now += 24 * 60 * 60 * 1000; },
    holdEvents() { let release; eventsGate = new Promise(r => { release = r; }); return () => { eventsGate = null; release(); }; }
  };
}

const DISPLAY_CACHE = 'focusCache:calendar:display';

{
  const h = harness();
  for (let i = 0; i < 5; i++) {
    const payload = await h.api.getNewTabEvents();
    assert.equal(payload.events.length, 0);
  }
  assert.equal(h.counts.calendarEvents, 1, 'an empty display range must be cached, not refetched per open');
  assert.equal(h.counts.calendarList, 1);
}

{
  const h = harness();
  await Promise.all(Array.from({ length: 5 }, () => h.api.getNewTabEvents()));
  assert.equal(h.counts.calendarEvents, 1, 'concurrent opens must share one range fetch');
}

{
  const v1 = { id: 'v1', summary: 'Old', start: { dateTime: new Date(FIXED_NOW + 3600000).toISOString() }, end: { dateTime: new Date(FIXED_NOW + 7200000).toISOString() } };
  const v2 = { id: 'v2', summary: 'New', start: { dateTime: new Date(FIXED_NOW + 3600000).toISOString() }, end: { dateTime: new Date(FIXED_NOW + 7200000).toISOString() } };
  const h = harness({ eventItems: [v1] });
  const first = await h.api.getNewTabEvents();
  assert.equal(first.events[0].id, 'v1');
  const firstStamp = h.store[DISPLAY_CACHE].updatedAt;

  h.advanceMs(5 * 60 * 1000 + 1);
  const release = h.holdEvents();
  h.setEventItems([v2]);

  const stale = await h.api.getNewTabEvents();
  assert.equal(stale.events[0].id, 'v1', 'SWR must answer with the stale snapshot before the refresh resolves');
  await flush();
  assert.equal(h.counts.calendarEvents, 2, 'the revalidation fetch must be in flight');
  assert.equal(h.store[DISPLAY_CACHE].updatedAt, firstStamp, 'the stale record stays untouched until the refresh lands');

  release();
  await flush(); await flush();
  assert.equal(h.counts.calendarEvents, 2, 'exactly one revalidation fetch');
  const entry = h.store[DISPLAY_CACHE];
  assert.equal(entry.updatedAt, firstStamp + 5 * 60 * 1000 + 1, 'the refreshed record carries the advanced timestamp');
  assert.equal(entry.value[0].id, 'v2', 'the refreshed events are stored');

  const next = await h.api.getNewTabEvents();
  assert.equal(next.events[0].id, 'v2');
  assert.equal(h.counts.calendarEvents, 2, 'the refreshed snapshot is fresh — no further fetch');
}

{
  const h = harness();
  await h.api.getNewTabEvents();
  h.nextDay();
  await h.api.getNewTabEvents();
  assert.equal(h.counts.calendarEvents, 2, 'a new day must fetch a new display range');
}

{
  const h = harness();
  await h.api.getNewTabEvents();
  assert.ok(h.store[DISPLAY_CACHE]);
  await h.api.updateCalendarSettings({ selectedCalendars: ['other-cal'] });
  assert.equal(h.store[DISPLAY_CACHE], undefined, 'a selection change must remove the display cache');
  await h.api.getNewTabEvents();
  assert.equal(h.counts.calendarEvents, 2, 'a selection change must refetch the display range');
}

{
  const h = harness();
  await h.api.getNewTabEvents();
  assert.ok(h.store[DISPLAY_CACHE]);
  await h.api.disconnectGoogleCalendar();
  assert.equal(h.store[DISPLAY_CACHE], undefined, 'disconnect must remove the display cache');
  const disconnected = await h.api.getNewTabEvents();
  assert.equal(disconnected.events.length, 0, 'a disconnected calendar must render empty without fetching');
  await h.api.connectGoogleCalendar();
  assert.equal(h.store[DISPLAY_CACHE], undefined, 'connect must remove any leftover snapshot');
  await h.api.getNewTabEvents();
  assert.equal(h.counts.calendarEvents, 2, 'reconnect must fetch a fresh snapshot');
}

{
  const h = harness();
  await h.api.getNewTabEvents();
  await h.api.saveCalendarSettings({ upcomingEvents: [{
    id: 'foreign', calendarId: 'primary', title: 'not from display range',
    start: new Date(FIXED_NOW).toISOString(), end: new Date(FIXED_NOW + 3600000).toISOString(),
    isAllDay: false, color: '#fff'
  }], lastSync: FIXED_NOW });
  const payload = await h.api.getNewTabEvents();
  assert.equal(payload.events.length, 0, 'upcomingEvents writes must not leak into the display snapshot');
  assert.equal(h.counts.calendarEvents, 1, 'and must not force a refetch either');
}

for (const status of [500, 503]) {
  const h = harness({ failStatus: status });
  await assert.rejects(() => h.api.getNewTabEvents());
  const entry = h.store[DISPLAY_CACHE];
  assert.ok(!entry || !Object.prototype.hasOwnProperty.call(entry, 'value'),
    `a ${status} failure must not cache an empty events array`);
}

{
  const h = harness();
  h.setAuthFailures(1);
  const payload = await h.api.getNewTabEvents();
  assert.equal(payload.events.length, 0);
  assert.equal(h.counts.calendarEvents, 2, 'the 401 must trigger one force-refresh retry');
  assert.equal(h.store.calendarSettings.accessToken, 'fresh-cal-token');
}

{
  const h = harness();
  h.setAuthFailures(2);
  await assert.rejects(() => h.api.getNewTabEvents(), (err) => err.status === 401);
  const entry = h.store[DISPLAY_CACHE];
  assert.ok(entry, 'the 401 records an auth-failure entry');
  assert.equal(entry.status, 401);
  assert.ok(!Object.prototype.hasOwnProperty.call(entry, 'value'), 'auth failures must never cache a value');
  assert.equal(h.counts.calendarEvents, 2, 'initial fetch plus one token-refresh retry');
  await assert.rejects(() => h.api.getNewTabEvents(), (err) => err.status === 401);
  assert.equal(h.counts.calendarEvents, 2, 'the 401 cooldown suppresses another attempt');
  h.advanceMs(60001);
  await h.api.getNewTabEvents();
  assert.equal(h.counts.calendarEvents, 3, 'after the cooldown a fresh attempt succeeds');
  assert.ok(Object.prototype.hasOwnProperty.call(h.store[DISPLAY_CACHE], 'value'));
}

{
  const h = harness({
    failCalendarIds: ['broken'],
    eventItems: [
      { id: 'ok', summary: 'Upcoming', start: { dateTime: new Date(FIXED_NOW + 3600000).toISOString() }, end: { dateTime: new Date(FIXED_NOW + 7200000).toISOString() } }
    ]
  });
  await h.api.saveCalendarSettings({ selectedCalendars: ['primary', 'broken'], cacheRevision: 'r2' });
  await assert.rejects(() => h.api.getNewTabEvents(), /fetch failed/);
  const entry = h.store[DISPLAY_CACHE];
  assert.ok(!entry || !Object.prototype.hasOwnProperty.call(entry, 'value'),
    'a partially failed range fetch must not be cached as a successful snapshot');
}

{
  const now = new Date(2026, 8, 13, 12);
  const h = harness({
    eventItems: [
      { id: 'past', summary: 'Done', start: { dateTime: new Date(now.getTime() - 7200000).toISOString() }, end: { dateTime: new Date(now.getTime() - 3600000).toISOString() } },
      { id: 'tomorrow', summary: 'Next', start: { dateTime: new Date(now.getTime() + 72000000).toISOString() }, end: { dateTime: new Date(now.getTime() + 75600000).toISOString() } }
    ]
  });
  const payload = await h.api.getNewTabEvents();
  assert.equal(payload.title, "Tomorrow's Schedule", 'with today finished the card must roll forward');
  assert.equal(payload.events[0].id, 'tomorrow');
}

console.log('calendar-cache tests passed');
