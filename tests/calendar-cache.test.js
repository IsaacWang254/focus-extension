import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const backgroundSource = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8');
const start = backgroundSource.indexOf('const GOOGLE_CALENDAR_API =');
assert.ok(start > 0, 'calendar slice anchor moved');
const slice = backgroundSource.slice(start);

const cacheSource = fs.readFileSync(new URL('../lib/request-cache.js', import.meta.url), 'utf8')
  .replace(/^export /gm, '');

const FIXED_NOW = new Date(2026, 8, 13, 12).getTime();
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const PLANNER_CACHE = 'focusCache:calendar:planner:v1';

function harness({ eventItems = [], eventPages = null, failStatus = null, failCalendarIds = [] } = {}) {
  const counts = { calendarList: 0, calendarEvents: 0 };
  const requests = [];
  let now = FIXED_NOW;
  let eventsGate = null;
  let nextItems = eventItems;
  let nextFailStatus = failStatus;

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
      calendarListCache: [],
      calendarListCacheTime: null
    }
  };

  let authFailuresLeft = 0;
  let refreshedToken = null;

  const fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    requests.push({ url: url.toString(), method: (options.method || 'GET').toUpperCase() });
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
      if (nextFailStatus) return new Response('fail', { status: nextFailStatus });
      const page = eventPages?.[calendarId]?.[url.searchParams.get('pageToken') || 'first'];
      return new Response(JSON.stringify(page || { items: nextItems }));
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
      runtime: { id: 'fixture', getManifest: () => ({ oauth2: { client_id: 'x', scopes: [] } }) }
    },
    fetch, Date: Clock, URL, URLSearchParams, Response,
    AbortSignal, structuredClone, crypto, console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, queueMicrotask
  };
  vm.createContext(sandbox);
  vm.runInContext(cacheSource, sandbox);
  vm.runInContext(`${slice}
this.api = { connectGoogleCalendar, disconnectGoogleCalendar,
  getCalendarSettings, saveCalendarSettings, updateCalendarSettings,
  getPlannerEvents, getPlannerDayInfo };`, sandbox);

  return {
    api: sandbox.api, counts, requests, store,
    setAuthFailures(n) { authFailuresLeft = n; },
    setEventItems(items) { nextItems = items; },
    setFailStatus(status) { nextFailStatus = status; },
    advanceMs(ms) { now += ms; },
    nextDay() { now += 24 * 60 * 60 * 1000; },
    holdEvents() { let release; eventsGate = new Promise(r => { release = r; }); return () => { eventsGate = null; release(); }; }
  };
}

{
  const h = harness();
  for (let i = 0; i < 5; i++) {
    const payload = await h.api.getPlannerEvents('2026-09-13');
    assert.equal(payload.events.length, 0);
  }
  assert.equal(h.counts.calendarEvents, 1, 'an empty day must be cached, not refetched per open');
  assert.equal(h.counts.calendarList, 1);
}

{
  const h = harness();
  await Promise.all(Array.from({ length: 5 }, () => h.api.getPlannerEvents('2026-09-13')));
  assert.equal(h.counts.calendarEvents, 1, 'concurrent opens must share one fetch');
}

{
  const h = harness();
  await h.api.getPlannerEvents('2026-09-13');
  assert.ok(h.store[PLANNER_CACHE]);
  await h.api.updateCalendarSettings({ selectedCalendars: ['other-cal'] });
  assert.equal(h.store[PLANNER_CACHE], undefined, 'a selection change must remove the planner cache');
  await h.api.getPlannerEvents('2026-09-13');
  assert.equal(h.counts.calendarEvents, 2, 'a selection change must refetch');
}

{
  const h = harness();
  await h.api.getPlannerEvents('2026-09-13');
  assert.ok(h.store[PLANNER_CACHE]);
  await h.api.disconnectGoogleCalendar();
  assert.equal(h.store[PLANNER_CACHE], undefined, 'disconnect must remove the planner cache');
  const disconnected = await h.api.getPlannerEvents('2026-09-13');
  assert.equal(disconnected.disconnected, true, 'a disconnected calendar must render empty without fetching');
  assert.equal(disconnected.events.length, 0);
  await h.api.connectGoogleCalendar();
  assert.equal(h.store[PLANNER_CACHE], undefined, 'connect must remove any leftover snapshot');
  await h.api.getPlannerEvents('2026-09-13');
  assert.equal(h.counts.calendarEvents, 2, 'reconnect must fetch a fresh snapshot');
}

{
  const h = harness();
  h.setAuthFailures(1);
  const payload = await h.api.getPlannerEvents('2026-09-13');
  assert.equal(payload.events.length, 0);
  assert.equal(h.counts.calendarEvents, 2, 'the 401 must trigger one force-refresh retry');
  assert.equal(h.store.calendarSettings.accessToken, 'fresh-cal-token');
}

{
  const h = harness({
    eventPages: {
      primary: {
        first: {
          items: [
            { id: 'all-day', summary: 'Away', start: { date: '2026-09-13' }, end: { date: '2026-09-14' } },
            { id: 'overlap', summary: 'Night shift', start: { dateTime: '2026-09-12T23:00:00.000Z' }, end: { dateTime: '2026-09-13T01:00:00.000Z' } }
          ],
          nextPageToken: 'next-page'
        },
        'next-page': {
          items: [{
            id: 'meeting', summary: 'Planning', location: 'Room 4', colorId: '11',
            htmlLink: 'https://calendar.google.com/calendar/event?eid=fixture',
            conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/fixture' }] },
            start: { dateTime: '2026-09-13T14:00:00.000Z' }, end: { dateTime: '2026-09-13T15:00:00.000Z' }
          }]
        }
      }
    }
  });
  const payload = await h.api.getPlannerEvents('2026-09-13');
  assert.equal(h.counts.calendarEvents, 2, 'planner reads exhaust Google page tokens');
  assert.deepEqual(new Set(payload.events.map(event => event.id)), new Set(['all-day', 'overlap', 'meeting']));
  assert.equal(payload.events.find(event => event.id === 'all-day').isAllDay, true, 'all-day events remain in the planner response');
  const meeting = payload.events.find(event => event.id === 'meeting');
  assert.equal(meeting.calendarName, 'Fixture');
  assert.equal(meeting.location, 'Room 4');
  assert.equal(meeting.meetingLink, 'https://meet.google.com/fixture');
  assert.equal(meeting.htmlLink, 'https://calendar.google.com/calendar/event?eid=fixture');
  assert.equal(payload.partial, false, 'a complete empty/non-empty response is not partial');
  assert.equal(payload.stale, false);
  assert.equal(payload.cacheUpdatedAt, payload.updatedAt);
  const firstEventRequest = new URL(h.requests.find(request => request.url.includes('/events?')).url);
  assert.equal(firstEventRequest.searchParams.get('timeMin'), new Date(2026, 8, 13).toISOString(), 'range starts at browser-local midnight');
  assert.equal(firstEventRequest.searchParams.get('timeMax'), new Date(2026, 8, 14).toISOString(), 'range ends at the next local midnight');
  assert.ok(h.requests.every(request => request.method === 'GET'), 'planner calendar reads never issue write requests');
  await h.api.getPlannerEvents('2026-09-13');
  assert.equal(h.counts.calendarEvents, 2, 'a fresh planner date is served from its per-date cache');
}

{
  const h = harness();
  await assert.rejects(() => h.api.getPlannerEvents('2026-02-30'), err => err.status === 400);
  await assert.rejects(() => h.api.getPlannerEvents('2026-2-03'), err => err.status === 400);
}

{
  const h = harness({ eventItems: [{
    id: 'saved', summary: 'Saved event',
    start: { dateTime: '2026-09-13T14:00:00.000Z' }, end: { dateTime: '2026-09-13T15:00:00.000Z' }
  }] });
  const first = await h.api.getPlannerEvents('2026-09-13');
  h.advanceMs(5 * 60 * 1000 + 1);
  h.setFailStatus(503);
  const stale = await h.api.getPlannerEvents('2026-09-13');
  assert.equal(stale.events[0].id, first.events[0].id, 'a temporary failure preserves valid planner data');
  assert.equal(stale.stale, true);
  assert.equal(stale.partial, true);
  assert.equal(stale.error, undefined, 'usable saved data is returned without a fatal error');
}

{
  const h = harness({
    failCalendarIds: ['broken'],
    eventItems: [{
      id: 'available', summary: 'Available',
      start: { dateTime: '2026-09-13T14:00:00.000Z' }, end: { dateTime: '2026-09-13T15:00:00.000Z' }
    }]
  });
  await h.api.saveCalendarSettings({ selectedCalendars: ['primary', 'broken'], cacheRevision: 'two-calendars' });
  const payload = await h.api.getPlannerEvents('2026-09-13');
  assert.equal(payload.events[0].id, 'available');
  assert.equal(payload.partial, true, 'a failed selected calendar is distinguishable from an empty day');
}

{
  const h = harness();
  for (let day = 1; day <= 15; day++) {
    await h.api.getPlannerEvents(`2026-09-${String(day).padStart(2, '0')}`);
  }
  const entries = h.store[PLANNER_CACHE].entries;
  assert.equal(Object.keys(entries).length, 14, 'planner cache retains a bounded number of date entries');
}

console.log('calendar-cache tests passed');
