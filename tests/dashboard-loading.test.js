import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const flush = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

const whenVisibleSource = read('../lib/when-visible.js').replace(/^export /gm, '');
const bgResolverSource = read('../lib/newtab-background.js').replace(/^export /gm, '');
const cacheSource = read('../lib/request-cache.js').replace(/^export /gm, '');
const todoistSource = read('../lib/todoist.js')
  .replace(/^import[^\n]*\n/gm, '')
  .replace(/^export /gm, '');

const newtabSource = read('../newtab/newtab.js')
  .replace(/^import[^;]*;\n/gm, '')
  .replace("import('./ocean-shader.js')", "__importShader('ocean')")
  .replace("import('./dither-shader.js')", "__importShader('dither')")
  .replace('import.meta.url', "'https://fixture.invalid/newtab/newtab.js'");

assert.ok(!/import\s*\(/.test(newtabSource), 'shader imports must be stubbed for the harness');

function makeElement(id) {
  const classes = new Set();
  const el = {
    id,
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      toggle: (c, force) => { const on = force === undefined ? !classes.has(c) : force; on ? classes.add(c) : classes.delete(c); },
      contains: (c) => classes.has(c)
    },
    style: {}, dataset: {}, children: [],
    textContent: '', title: '', className: '',
    disabled: false, value: '', src: '',
    setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, appendChild(c) { this.children.push(c); },
    focus() {}, click() {},
  };
  let html = '';
  Object.defineProperty(el, 'innerHTML', {
    get() { return html; },
    set(v) { html = v; if (v === '') el.children.length = 0; },
    configurable: true
  });
  return el;
}

function harness({ settings = {}, visibility = 'visible', summaryDelay = 0, calendarConnected = true,
  calendarEventsPayload = null, tasksItems = [{ id: 't1', content: 'Alpha task', priority: 2 }],
  completedItems = [{ id: 'c1', content: 'Done task' }], geo = 'ok', weatherFail = false,
  authenticated = true, coords = true, taskFailureStatus = 0, seed = {} } = {}) {
  const calls = {
    tasks: 0, completed: 0, weather: 0, geolocation: 0,
    messages: {}, shaderImports: [], shaderInits: []
  };
  let now = new Date(2026, 8, 13, 12, 0, 0).getTime();
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }

  const store = {
    todoistToken: 'tok', todoistCacheRevision: 'rev',
    settings: { ...settings }, ...seed
  };
  if (coords) { store.weatherLat = 40; store.weatherLon = -74; }
  if (!authenticated) delete store.todoistToken;
  let nextTasks = tasksItems;
  let nextCompleted = completedItems;
  let eventsPayload = calendarEventsPayload;
  let taskFailures = taskFailureStatus;
  let weatherGate = null;
  let settingsGate = null;
  let weatherFails = weatherFail;
  const changeListeners = [];
  const fireChange = (values) => {
    const changes = {};
    for (const [key, newValue] of Object.entries(values)) {
      changes[key] = { oldValue: structuredClone(store[key]), newValue: structuredClone(newValue) };
      if (newValue === undefined) delete store[key]; else store[key] = structuredClone(newValue);
    }
    for (const fn of changeListeners) fn(changes, 'local');
  };
  const storage = {
    async get(keys) {
      if (keys == null) return structuredClone(store);
      if (typeof keys === 'string') return { [keys]: structuredClone(store[keys]) };
      const list = Array.isArray(keys) ? keys : Object.keys(keys);
      return structuredClone(Object.fromEntries(list.map(k => [k, store[k] ?? (Array.isArray(keys) ? undefined : keys[k])])));
    },
    async set(values) { fireChange(values); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) fireChange({ [key]: undefined }); }
  };

  const sendMessage = async (message) => {
    calls.messages[message.type] = (calls.messages[message.type] || 0) + 1;
    switch (message.type) {
      case 'GET_SETTINGS':
        if (settingsGate) await settingsGate;
        return { ...store.settings };
      case 'GET_CALENDAR_STATUS': return { connected: calendarConnected };
      case 'GET_NEWTAB_EVENTS':
        if (eventsPayload) return eventsPayload;
        return { title: "Today's Schedule", displayDate: 'x', events: [{ id: 'e1', title: 'Standup', start: new Date(now + 3600000).toISOString(), end: new Date(now + 7200000).toISOString(), isAllDay: false }] };
      case 'GET_TODAY_EVENTS': return [];
      case 'GET_BLOCKING_SUMMARY':
        if (summaryDelay === Infinity) await new Promise(() => {});
        return { totalBlockAttempts: 0 };
      case 'ADD_EARNED_TIME': return { added: 0 };
      default: return null;
    }
  };

  let visibilityState = visibility;
  const docListeners = {};
  const winListeners = {};
  const elements = new Map();
  const clockWrites = { count: 0 };
  const intervals = [];
  let intervalSeq = 0;

  const documentStub = {
    get visibilityState() { return visibilityState; },
    documentElement: { attrs: {}, getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { this.attrs[k] = v; } },
    body: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, style: {} },
    getElementById(id) {
      if (!elements.has(id)) {
        const el = makeElement(id);
        if (id === 'clock') {
          let html = '';
          Object.defineProperty(el, 'innerHTML', {
            get() { return html; },
            set(v) { clockWrites.count++; html = v; },
            configurable: true
          });
        }
        elements.set(id, el);
      }
      return elements.get(id);
    },
    createElement: (tag) => makeElement(tag),
    addEventListener(type, fn) { (docListeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { docListeners[type] = (docListeners[type] || []).filter(f => f !== fn); },
    get activeElement() { return null; }
  };

  const fakeSetInterval = (fn, ms) => { const rec = { fn, ms, active: true, id: ++intervalSeq }; intervals.push(rec); return rec.id; };
  const fakeClearInterval = (id) => { const rec = intervals.find(r => r.id === id); if (rec) rec.active = false; };

  let reducedMotion = false;
  const motionListeners = [];
  const windowStub = {
    setInterval: fakeSetInterval,
    clearInterval: fakeClearInterval,
    setTimeout, clearTimeout,
    devicePixelRatio: 1,
    matchMedia: (q) => ({
      get matches() { return reducedMotion; },
      addEventListener: (t, fn) => motionListeners.push(fn)
    }),
    addEventListener: (type, fn) => { (winListeners[type] ||= []).push(fn); },
    removeEventListener() {},
  };

  const todoistFetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.todoist.com') {
      if (url.pathname.endsWith('/tasks') && (options.method || 'GET') === 'GET') {
        calls.tasks++;
        await flush(1);
        if (taskFailures > 0) {
          taskFailures--;
          return new Response('fail', { status: taskFailureStatus });
        }
        return new Response(JSON.stringify({ results: nextTasks, next_cursor: null }));
      }
      if (url.pathname.includes('/completed/')) {
        calls.completed++;
        await flush(1);
        return new Response(JSON.stringify({ items: nextCompleted, next_cursor: null }));
      }
      if ((options.method || 'GET') !== 'GET') return new Response(null, { status: 204 });
      throw new Error(`Unexpected Todoist fixture request: ${url.pathname}`);
    }
    if (url.hostname === 'api.open-meteo.com') {
      calls.weather++;
      await flush(1);
      if (weatherGate) await weatherGate;
      if (weatherFails) return new Response('down', { status: 503 });
      return new Response(JSON.stringify({
        current: { temperature_2m: 20, weather_code: 0, is_day: 1 },
        daily: { temperature_2m_max: [22], temperature_2m_min: [15] }
      }));
    }
    throw new Error(`Unexpected fixture request: ${url.origin}${url.pathname}`);
  };

  let shaderGate = null;
  const pendingShaderReleases = [];
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    chrome: {
      storage: { local: storage, onChanged: { addListener: fn => changeListeners.push(fn) } },
      runtime: { id: 'fixture', sendMessage, getURL: (p) => p }
    },
    document: documentStub,
    window: windowStub,
    navigator: {
      geolocation: {
        getCurrentPosition: (ok, err) => {
          calls.geolocation++;
          if (geo === 'deny') {
            const e = new Error('denied'); e.code = 1; err(e);
          } else {
            ok({ coords: { latitude: 40, longitude: -74 } });
          }
        }
      }
    },
    MutationObserver: class { observe() {} disconnect() {} },
    fetch: todoistFetch,
    Date: Clock, URL, URLSearchParams, Response, AbortSignal,
    structuredClone, crypto, TextEncoder,
    setTimeout, clearTimeout, setInterval: fakeSetInterval, clearInterval: fakeClearInterval,
    queueMicrotask,
    Icons: new Proxy({}, { get: () => '<svg></svg>' }),
    createRuntimeMessenger: (responder) => async (msg) => sendMessage(msg),
    hasExtensionRuntime: () => true,
    applyAccentColorFromStorage: async () => {},
    getEffectiveThemeBase: (base) => base || 'light',
    isThemeSyncEnabled: () => false,
    loadTheme: async () => {},
    resolveThemeVariant: (b) => b,
    setIconButtonLabel: () => {},
    getDailyQuote: () => ({ text: 'q', author: 'a' }),
    TODOIST_CLIENT_ID: 'fixture', TOKEN_PROXY_URL: 'https://fixture.invalid/token',
    __importShader: (name) => {
      calls.shaderImports.push(name);
      const ready = shaderGate ? new Promise(r => pendingShaderReleases.push(r)) : Promise.resolve();
      return ready.then(() => ({
        [name === 'ocean' ? 'initOceanShader' : 'initDitherShader']: (canvas, opts) => {
          calls.shaderInits.push(name);
          return { start() {}, stop() {}, destroy() { calls.shaderDestroys = (calls.shaderDestroys || 0) + 1; }, setSpeed() {}, setMode() {}, setBatterySaver() {} };
        }
      }));
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(cacheSource, sandbox);
  vm.runInContext(`${todoistSource}
this.todoist = { isAuthenticated, getTasksWithSubtasks, getCompletedTasksToday, getCompletedTasks,
  completeTask, reopenTask, createTask, logout, authenticate, getPriorityClass, formatDueDate };`, sandbox);
  vm.runInContext(whenVisibleSource + '\nthis.runWhenVisible = runWhenVisible;', sandbox);
  vm.runInContext(bgResolverSource + '\nthis.resolveNewtabBackground = resolveNewtabBackground;', sandbox);
  vm.runInContext(`${newtabSource}
this.__test = { loadSettings, loadTodos, loadCalendar, loadWeather, fetchCompletedToday,
  loadFocusSnapshot, refreshWidget, refreshDashboard, startDashboardRefresh,
  applyBackgroundSetting, updateClock, startClock, getCoordinates };`, sandbox);

  return {
    calls, store, elements, intervals, clockWrites, sandbox,
    api: sandbox.__test,
    setVisibility(v) {
      visibilityState = v;
      for (const fn of docListeners.visibilitychange || []) fn();
    },
    fireStorage: fireChange,
    tickIntervals() { for (const rec of intervals) if (rec.active) rec.fn(); },
    releaseShaders() { pendingShaderReleases.forEach(r => r()); shaderGate = null; },
    gateShaders() { shaderGate = true; },
    setReducedMotion(v) { reducedMotion = v; motionListeners.forEach(fn => fn()); },
    advanceMinute() { now += 61000; },
    advanceMs(ms) { now += ms; },
    nextDay() { now += 24 * 60 * 60 * 1000; },
    setTasks(items) { nextTasks = items; },
    setCompleted(items) { nextCompleted = items; },
    setEventsPayload(p) { eventsPayload = p; },
    setTaskFailures(status, n) { taskFailureStatus = status; taskFailures = n; },
    setWeatherFail(v) { weatherFails = v; },
    holdWeather() { let release; weatherGate = new Promise(r => { release = r; }); return () => { weatherGate = null; release(); }; },
    holdSettings() { let release; settingsGate = new Promise(r => { release = r; }); return () => { settingsGate = null; release(); }; },
    pagehide() { for (const fn of winListeners.pagehide || []) fn(); },
    el(id) { return elements.get(id); },
    activeIntervals(ms) { return intervals.filter(r => r.active && (ms === undefined || r.ms === ms)).length; },
    async start() {
      for (const fn of docListeners.DOMContentLoaded || []) await fn();
    }
  };
}

{
  const h = harness({ visibility: 'hidden', settings: { newtabBackground: 'none' } });
  await h.start();
  await flush(10);
  assert.equal(h.calls.tasks, 0, 'hidden tab must not fetch tasks');
  assert.equal(h.calls.completed, 0, 'hidden tab must not fetch completed tasks');
  assert.equal(h.calls.weather, 0, 'hidden tab must not fetch weather');
  assert.equal(h.calls.geolocation, 0, 'hidden tab must not request geolocation');
  assert.equal(h.calls.messages.GET_NEWTAB_EVENTS || 0, 0, 'hidden tab must not fetch calendar events');
  assert.equal(h.calls.shaderImports.length, 0, 'hidden tab must not import shaders');
}

{
  const h = harness({
    visibility: 'visible',
    settings: {
      newtabShowWeather: false, newtabShowCalendar: false, newtabShowTodos: false,
      newtabShowFocusSnapshot: false, newtabBackground: 'none'
    }
  });
  await h.start();
  await flush(10);
  assert.equal(h.calls.tasks + h.calls.completed + h.calls.weather + h.calls.geolocation, 0,
    'disabled widgets must make no API calls');
  assert.equal(h.calls.messages.GET_CALENDAR_STATUS || 0, 0, 'disabled calendar must not even check status');
  assert.equal(h.calls.messages.GET_BLOCKING_SUMMARY || 0, 0);
}

{
  const h = harness({ visibility: 'visible', settings: { newtabBackground: 'none' } });
  await h.start();
  await flush(10);
  assert.equal(h.calls.tasks, 1, 'tasks load once');
  assert.equal(h.calls.completed, 1, 'completed load once');
  assert.equal(h.calls.weather, 1, 'weather loads once');
  assert.equal(h.calls.messages.GET_NEWTAB_EVENTS, 1, 'calendar display loads once');
  assert.equal(h.calls.messages.GET_BLOCKING_SUMMARY, 1, 'focus snapshot loads once');
}

{
  const h = harness({ visibility: 'visible', settings: { newtabBackground: 'none' } });
  await h.start();
  await flush(10);
  const tasksAtStart = h.calls.tasks;
  const eventsAtStart = h.calls.messages.GET_NEWTAB_EVENTS;
  h.advanceMs(2 * 60 * 1000 + 1);
  h.setVisibility('hidden');
  assert.equal(h.activeIntervals(60000), 1, 'only the self-skipping reminder interval remains while hidden');
  h.tickIntervals();
  await flush(10);
  assert.equal(h.calls.tasks, tasksAtStart, 'no polling while hidden');
  assert.equal(h.calls.messages.GET_NEWTAB_EVENTS, eventsAtStart, 'no calendar polling while hidden');
  h.setVisibility('visible');
  await flush(10);
  assert.equal(h.calls.tasks, tasksAtStart + 1, 'visible resume triggers exactly one task refresh');
  assert.equal(h.calls.messages.GET_NEWTAB_EVENTS, eventsAtStart + 1, 'visible resume triggers exactly one calendar refresh');
  assert.equal(h.activeIntervals(60000), 2, 'reminder plus exactly one dashboard interval after resume');
}

{
  const h = harness({ visibility: 'visible', settings: { newtabBackground: 'none' } });
  await h.start();
  await flush(10);
  const snapshot = { ...h.calls, messages: { ...h.calls.messages } };
  h.fireStorage({ unrelatedKey: 'x' });
  await flush(10);
  assert.equal(h.calls.tasks, snapshot.tasks);
  assert.equal(h.calls.weather, snapshot.weather);
  assert.equal(h.calls.messages.GET_NEWTAB_EVENTS, snapshot.messages.GET_NEWTAB_EVENTS);
}

{
  const h = harness({ visibility: 'visible', settings: { newtabBackground: 'none' } });
  await h.start();
  await flush(10);
  const before = h.calls.tasks;
  h.fireStorage({ newtabShowTodos: false, settings: { ...h.store.settings, newtabShowTodos: false } });
  await flush(10);
  assert.equal(h.calls.tasks, before, 'disabling todos must not fetch');
  h.advanceMs(2 * 60 * 1000 + 1);
  h.fireStorage({ newtabShowTodos: true, settings: { ...h.store.settings, newtabShowTodos: true } });
  await flush(10);
  assert.equal(h.calls.tasks, before + 1, 'enabling todos triggers one refresh');
}

{
  const h = harness({ visibility: 'visible', summaryDelay: Infinity, settings: { newtabBackground: 'none' } });
  await h.start();
  await flush(10);
  assert.equal(h.calls.tasks, 1, 'tasks must not wait on the snapshot');
  assert.equal(h.calls.weather, 1, 'weather must not wait on the snapshot');
  assert.equal(h.calls.messages.GET_NEWTAB_EVENTS, 1, 'calendar must not wait on the snapshot');
}

{
  const h = harness({ visibility: 'visible', settings: { newtabBackground: 'none' } });
  await h.start();
  await flush(10);
  const weatherCalls = h.calls.weather;
  assert.ok(h.store['focusCache:todoist:tasks']?.value, 'the real API path cached the tasks');
  assert.equal(h.calls.tasks, 1, 'the cache write during load must not cause a refetch');
  h.fireStorage({ 'focusCache:todoist:tasks': { scope: 'other', value: [{ id: 'x', content: 'x', priority: 1 }], updatedAt: Date.now() + 1 } });
  await flush(10);
  assert.equal(h.calls.tasks, 2, 'a foreign-scope cache write re-renders through one refetch');
  assert.equal(h.calls.weather, weatherCalls, 'and does not recurse into other loaders');
  h.fireStorage({ 'focusCache:todoist:tasks': { scope: 's', retryAt: Date.now() + 60000, status: 500, error: 'x' } });
  await flush(10);
  assert.equal(h.calls.tasks, 2, 'cooldown bookkeeping writes must not trigger refreshes');
}

{
  const h = harness({ visibility: 'visible', settings: { newtabBackground: 'none' } });
  await h.start();
  await flush(10);
  assert.equal(h.el('todo-list').children.length, 1, 'task rendered');
  h.fireStorage({ 'focusCache:todoist:tasks': { scope: 's', retryAt: Date.now() + 60000, status: 401, error: 'x' } });
  await flush(10);
  assert.equal(h.calls.tasks, 1, 'an auth-failure write must not launch a fetch');
  assert.equal(h.el('todo-list').children.length, 0, 'the stale task list is cleared');
  assert.ok(!h.el('todos-connect').classList.contains('hidden'), 'the reconnect prompt shows');
}

{
  const h = harness({ visibility: 'visible', settings: { newtabBackground: 'none' } });
  await h.start();
  await flush(5);
  const writes = h.clockWrites.count;
  h.tickIntervals();
  h.tickIntervals();
  assert.equal(h.clockWrites.count, writes, 'same-minute ticks must not rewrite the clock DOM');
  h.advanceMinute();
  h.tickIntervals();
  assert.equal(h.clockWrites.count, writes + 1, 'a new minute rewrites exactly once');
}

{
  const h = harness({ visibility: 'visible', settings: { newtabBackground: 'ocean' } });
  h.gateShaders();
  await h.start();
  await flush(5);
  assert.deepEqual(h.calls.shaderImports, ['ocean'], 'only the selected shader imports');
  assert.equal(h.calls.shaderInits.length, 0, 'pending import has not initialized yet');

  await h.api.applyBackgroundSetting('none');
  h.releaseShaders();
  await flush(5);
  assert.equal(h.calls.shaderInits.length, 0, 'a superseded import must never initialize');

  await h.api.applyBackgroundSetting('dither');
  await flush(5);
  assert.deepEqual(h.calls.shaderInits, ['dither'], 'the latest selection initializes once the import lands');
}

{
  const h = harness({ visibility: 'visible', settings: { newtabBackground: 'ocean' } });
  h.gateShaders();
  await h.start();
  await flush(5);
  h.setReducedMotion(true);
  h.releaseShaders();
  await flush(5);
  assert.equal(h.calls.shaderInits.length, 0, 'reduced motion must win over a pending import');
}

{
  const h = harness({ settings: { newtabBackground: 'none' } });
  await h.start();
  await flush(10);
  const listEl = h.el('todo-list');
  assert.equal(listEl.children.length, 1, 'the task row rendered');
  h.setTasks([]);
  h.advanceMs(2 * 60 * 1000 + 1);
  await h.api.loadTodos();
  await flush(10);
  assert.equal(listEl.children.length, 0, 'a fresh empty response must remove the old rows');
  assert.equal(listEl.innerHTML, '');
  assert.ok(!h.el('todos-empty').classList.contains('hidden'), 'the empty state shows');
  assert.ok(h.el('todos-show-more').classList.contains('hidden'));
}

{
  const h = harness({ settings: { newtabBackground: 'none' } });
  await h.start();
  await flush(10);
  assert.equal(h.el('todo-list').children.length, 1);
  await h.sandbox.todoist.logout();
  await h.api.loadTodos();
  assert.equal(h.el('todo-list').children.length, 0, 'logout must remove the rendered rows');
  assert.equal(h.el('todo-list').innerHTML, '');
  assert.ok(!h.el('todos-connect').classList.contains('hidden'), 'the connect prompt shows');
  assert.ok(h.el('todos-show-more').classList.contains('hidden'));
}

{
  const h = harness({ settings: { newtabBackground: 'none' } });
  await h.start();
  await flush(10);
  assert.equal(h.el('todo-list').children[0].dataset.taskId, 't1');
  h.store.todoistToken = 'tok-b';
  h.store.todoistCacheRevision = 'rev-b';
  h.setTasks([{ id: 'b1', content: 'Beta task', priority: 1 }]);
  await h.api.loadTodos();
  assert.equal(h.calls.tasks, 2, 'the account switch refetches');
  assert.equal(h.el('todo-list').children.length, 1);
  assert.equal(h.el('todo-list').children[0].dataset.taskId, 'b1', 'only the new account\'s task renders');
}

{
  const h = harness({ settings: { newtabBackground: 'none' } });
  await h.start();
  await flush(10);
  h.setTaskFailures(401, 1);
  h.fireStorage({ 'focusCache:todoist:tasks': undefined });
  await h.api.loadTodos();
  await flush(10);
  assert.equal(h.el('todo-list').children.length, 0, 'an expired session clears rendered tasks');
  assert.ok(!h.el('todos-connect').classList.contains('hidden'), 'the connect prompt shows');
}
{
  const h = harness({ settings: { newtabBackground: 'none' } });
  await h.start();
  await flush(10);
  h.setTaskFailures(503, 1);
  h.fireStorage({ 'focusCache:todoist:tasks': undefined });
  await h.api.loadTodos();
  await flush(10);
  assert.equal(h.el('todo-list').children.length, 1, 'a transient failure keeps the rendered list');
  assert.ok(h.el('todos-empty').classList.contains('hidden'), 'the empty state must not stack on top');
}

{
  const h = harness({ authenticated: false, settings: { newtabBackground: 'none' } });
  await h.api.fetchCompletedToday();
  assert.ok(h.el('completed-loading').classList.contains('hidden'), 'no spinner when logged out');
  assert.equal(h.el('completed-count').textContent, 0);
}

{
  const h = harness({ settings: { newtabBackground: 'none' },
    calendarEventsPayload: { error: 'Calendar events fetch failed: 401', status: 401 } });
  await h.start();
  await flush(10);
  assert.ok(!h.el('calendar-reconnect').classList.contains('hidden'), 'a 401 error object shows reconnect');
  assert.equal(h.el('event-list').children.length, 0, 'the event list is cleared');
}
{
  const h = harness({ settings: { newtabBackground: 'none' },
    calendarEventsPayload: { error: 'Calendar events fetch failed: 503', status: 503 } });
  await h.start();
  await flush(10);
  assert.equal(h.el('calendar-empty-text').textContent, 'Calendar unavailable');
  assert.ok(h.el('calendar-reconnect').classList.contains('hidden'), 'a transient failure must not show reconnect');
}
{
  const h = harness({ settings: { newtabBackground: 'none' } });
  await h.start();
  await flush(10);
  assert.equal(h.el('event-list').children.length, 1, 'the event rendered');
  h.setEventsPayload({ error: 'Calendar events fetch failed: 503', status: 503 });
  await h.api.loadCalendar();
  assert.equal(h.el('event-list').children.length, 1, 'a transient failure keeps the rendered schedule');
  assert.equal(h.el('calendar-empty-text').textContent, 'Showing saved schedule');
}

{
  const h = harness({ settings: { newtabBackground: 'none' } });
  await h.start();
  await flush(10);
  assert.equal(h.calls.weather, 1);
  assert.ok(h.store.weatherCacheScope, 'the legacy mirror stores a scope');
  await h.api.loadWeather();
  assert.equal(h.calls.weather, 1, 'a fresh same-scope entry must not refetch');
  assert.ok(h.el('weather-error').classList.contains('hidden'));
}

{
  const h = harness({ settings: { newtabBackground: 'none' } });
  await h.start();
  await flush(10);
  h.nextDay();
  await h.api.loadWeather();
  assert.equal(h.calls.weather, 2, 'a new day refetches weather');
}
{
  const h = harness({ settings: { newtabBackground: 'none' } });
  await h.start();
  await flush(10);
  h.store.weatherLat = 50;
  h.store.weatherLon = -70;
  await h.api.loadWeather();
  assert.equal(h.calls.weather, 2, 'a location change must refetch even a fresh entry');
  assert.equal(h.store.weatherCacheScope,
    JSON.stringify([50, -70, new Date(2026, 8, 13, 12, 0, 0).toDateString()]));
}

{
  const stamp = new Date(2026, 8, 13, 12, 0, 0).getTime();
  const h = harness({ settings: { newtabBackground: 'none' }, seed: {
    weatherCache: { current: { temperature_2m: 20, weather_code: 0, is_day: 1 }, daily: { temperature_2m_max: [22], temperature_2m_min: [15] } },
    weatherCacheTime: stamp
  } });
  await h.api.loadWeather();
  assert.equal(h.calls.weather, 0, 'a fresh unscoped legacy entry migrates without fetching');
  assert.equal(h.store.weatherCacheScope, JSON.stringify([40, -74, new Date(2026, 8, 13, 12, 0, 0).toDateString()]),
    'the migration stamps the current scope');
}

{
  const h = harness({ settings: { newtabBackground: 'none' } });
  const release = h.holdWeather();
  const pending = h.api.loadWeather();
  await flush(5);
  h.store.weatherLat = 50;
  h.store.weatherLon = -70;
  release();
  await pending;
  assert.equal(h.store.weatherCache, undefined, 'the old location must not poison the legacy cache');
  assert.equal(h.store['focusCache:weather'], undefined, 'or the shared record');
  assert.equal(h.calls.weather, 1);
}

{
  const stamp = new Date(2026, 8, 13, 12, 0, 0).getTime() - 40 * 60 * 1000;
  const scope = JSON.stringify([40, -74, new Date(2026, 8, 13, 12, 0, 0).toDateString()]);
  const h = harness({ settings: { newtabBackground: 'none' }, weatherFail: true, seed: {
    weatherCache: { current: { temperature_2m: 20, weather_code: 0, is_day: 1 }, daily: { temperature_2m_max: [22], temperature_2m_min: [15] } },
    weatherCacheTime: stamp, weatherCacheScope: scope
  } });
  await h.api.loadWeather();
  assert.equal(h.calls.weather, 1, 'the failed refresh attempted one fetch');
  assert.equal(h.store.weatherCacheTime, stamp, 'the saved timestamp is preserved on failure');
  assert.equal(h.el('weather-error-text').textContent, 'Showing saved weather');
  assert.ok(!h.el('weather-error').classList.contains('hidden'), 'the saved-data status is visible');
}

{
  const h = harness({ settings: { newtabBackground: 'none' }, coords: false, geo: 'deny' });
  for (let i = 0; i < 5; i++) await h.api.loadWeather();
  assert.equal(h.calls.geolocation, 1, 'repeat loads inside the cooldown must not re-prompt');
  h.advanceMs(5 * 60 * 1000 + 1);
  await h.api.loadWeather();
  assert.equal(h.calls.geolocation, 2, 'after the cooldown a new prompt is allowed');
}

{
  const h = harness({ settings: { newtabBackground: 'none' } });
  const releaseSettings = h.holdSettings();
  const started = h.start();
  await flush(5);
  h.setVisibility('hidden');
  h.fireStorage({ newtabShowTodos: false, settings: { ...h.store.settings, newtabShowTodos: false } });
  releaseSettings();
  await started;
  await flush(10);
  assert.equal(h.calls.tasks, 0, 'no task fetch after hiding during the settings load');
  assert.equal(h.calls.messages.GET_NEWTAB_EVENTS || 0, 0);
  h.setVisibility('visible');
  await flush(10);
  assert.equal(h.calls.tasks, 0, 'the widget stayed disabled through the hidden window');
}

{
  const h = harness({ visibility: 'visible', settings: { newtabBackground: 'ocean' } });
  h.gateShaders();
  await h.start();
  await flush(5);
  assert.deepEqual(h.calls.shaderImports, ['ocean']);
  h.setVisibility('hidden');
  h.releaseShaders();
  await flush(5);
  assert.equal(h.calls.shaderInits.length, 0, 'a hidden page never initializes the shader');
  h.setVisibility('visible');
  await flush(5);
  assert.equal(h.calls.shaderInits.length, 1, 'reveal initializes the background exactly once');
  assert.equal(h.calls.shaderInits[0], 'ocean');
}

{
  const h = harness({ visibility: 'visible', settings: { newtabBackground: 'ocean' } });
  await h.start();
  await flush(5);
  assert.equal(h.calls.shaderInits.length, 1);
  h.pagehide();
  assert.equal(h.calls.shaderDestroys, 1, 'pagehide destroys the active background');
  assert.equal(h.activeIntervals(60000), 0, 'pagehide stops the refresh and reminder intervals');
}

{
  const h = harness({ settings: { newtabBackground: 'none' } });
  await h.start();
  await flush(10);
  assert.ok(!h.el('weather-content').classList.contains('hidden'), 'weather rendered warm');
  h.store.weatherLat = 50;
  h.store.weatherLon = -70;
  h.setWeatherFail(true);
  await h.api.loadWeather();
  assert.equal(h.calls.weather, 2, 'the new location attempted a fetch');
  assert.ok(h.el('weather-content').classList.contains('hidden'),
    'old-location temperatures must not sit next to the error');
  assert.equal(h.el('weather-error-text').textContent, 'Weather unavailable');
}
{
  const stamp = new Date(2026, 8, 13, 12, 0, 0).getTime() - (2 * 60 + 15) * 60 * 1000;
  const scope = JSON.stringify([40, -74, new Date(2026, 8, 13, 12, 0, 0).toDateString()]);
  const h = harness({ settings: { newtabBackground: 'none' }, weatherFail: true, seed: {
    weatherCache: { current: { temperature_2m: 20, weather_code: 0, is_day: 1 }, daily: { temperature_2m_max: [22], temperature_2m_min: [15] } },
    weatherCacheTime: stamp, weatherCacheScope: scope
  } });
  await h.api.loadWeather();
  assert.equal(h.store.weatherCacheTime, stamp, 'a 2h15m same-scope entry keeps its timestamp');
  assert.equal(h.el('weather-error-text').textContent, 'Showing saved weather');
  assert.ok(!h.el('weather-content').classList.contains('hidden'), 'saved data stays visible inside the bound');
}
{
  const stamp = new Date(2026, 8, 13, 12, 0, 0).getTime() - (2 * 60 + 31) * 60 * 1000;
  const scope = JSON.stringify([40, -74, new Date(2026, 8, 13, 12, 0, 0).toDateString()]);
  const h = harness({ settings: { newtabBackground: 'none' }, weatherFail: true, seed: {
    weatherCache: { current: { temperature_2m: 20, weather_code: 0, is_day: 1 }, daily: { temperature_2m_max: [22], temperature_2m_min: [15] } },
    weatherCacheTime: stamp, weatherCacheScope: scope
  } });
  await h.api.loadWeather();
  assert.ok(h.el('weather-content').classList.contains('hidden'), 'data past the 2.5h bound is not shown');
  assert.equal(h.el('weather-error-text').textContent, 'Weather unavailable');
}
{
  const h = harness({ settings: { newtabBackground: 'none' } });
  h.setTaskFailures(403, 1);
  h.fireStorage({ 'focusCache:todoist:tasks': undefined });
  await h.api.loadTodos();
  assert.ok(!h.el('todos-connect').classList.contains('hidden'), 'a 403 shows the connect prompt');
  assert.equal(h.el('todo-list').children.length, 0);
  await h.api.loadTodos();
  await flush(10);
  assert.equal(h.calls.tasks, 1, 'the 403 cooldown suppresses a second API call');
  assert.ok(!h.el('todos-connect').classList.contains('hidden'), 'the cooldown still shows connect, not empty');
  assert.ok(h.el('todos-empty').classList.contains('hidden'));
}

console.log('dashboard-loading tests passed');
