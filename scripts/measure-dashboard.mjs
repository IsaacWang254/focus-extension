import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const root = new URL('../', import.meta.url);
const todoistSource = await fs.readFile(new URL('lib/todoist.js', root), 'utf8');
const backgroundSource = await fs.readFile(new URL('background.js', root), 'utf8');
const newtabSource = await fs.readFile(new URL('newtab/newtab.js', root), 'utf8');
const fixedNow = new Date(2026, 8, 13, 12).getTime();

function harness() {
  let now = fixedNow;
  const counts = { tasks: 0, completed: 0, calendarList: 0, calendarEvents: 0, weather: 0 };
  const locks = new Map();
  const store = {
    todoistToken: 'fixture-only-token',
    weatherLat: 40,
    weatherLon: -74,
    calendarSettings: {
      connected: true,
      accessToken: 'fixture-only-calendar-token',
      tokenExpiry: fixedNow + 3600000,
      selectedCalendars: ['primary'],
      upcomingEvents: [],
      calendarListCache: [],
      calendarListCacheTime: null,
      lastSync: null
    }
  };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const storage = {
    async get(keys) {
      if (keys == null) return structuredClone(store);
      if (typeof keys === 'string') return structuredClone({ [keys]: store[keys] });
      return structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : Object.keys(keys))
        .map(key => [key, store[key] ?? (Array.isArray(keys) ? undefined : keys[key])])));
    },
    async set(values) { Object.assign(store, structuredClone(values)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key]; }
  };
  const fetchFixture = async (input) => {
    const url = new URL(String(input));
    let body;
    if (url.hostname === 'api.todoist.com' && url.pathname.endsWith('/tasks')) {
      counts.tasks++;
      body = { results: [{ id: 'task-1', content: 'Fixture task', priority: 1 }], next_cursor: null };
    } else if (url.hostname === 'api.todoist.com' && url.pathname.includes('/completed/')) {
      counts.completed++;
      body = { items: [], next_cursor: null };
    } else if (url.hostname === 'www.googleapis.com' && url.pathname.endsWith('/calendarList')) {
      counts.calendarList++;
      body = { items: [{ id: 'primary', summary: 'Fixture calendar' }] };
    } else if (url.hostname === 'www.googleapis.com' && url.pathname.endsWith('/events')) {
      counts.calendarEvents++;
      body = { items: [] };
    } else if (url.hostname === 'api.open-meteo.com') {
      counts.weather++;
      body = { current: { temperature_2m: 20, weather_code: 0, is_day: 1 }, daily: { temperature_2m_max: [22], temperature_2m_min: [15] } };
    } else {
      throw new Error(`Unexpected fixture request: ${url.origin}${url.pathname}`);
    }
    await new Promise(resolve => setTimeout(resolve, 5));
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  };
  const globals = {
    Date: Clock, URL, URLSearchParams, TextEncoder, TextDecoder, Response,
    AbortController, AbortSignal, structuredClone, crypto: webcrypto,
    setTimeout, clearTimeout, queueMicrotask,
    console: { log() {}, warn() {}, error() {} },
    fetch: fetchFixture,
    chrome: { storage: { local: storage, onChanged: { addListener() {} } }, runtime: { id: 'fixture' } },
    navigator: {
      locks: {
        request(name, callback) {
          const result = (locks.get(name) || Promise.resolve()).catch(() => {}).then(callback);
          locks.set(name, result);
          return result.finally(() => { if (locks.get(name) === result) locks.delete(name); });
        }
      }
    }
  };
  function context(extra = {}) { return vm.createContext({ ...globals, ...extra }); }
  async function loadModule(path, ctx, modules = new Map()) {
    const url = new URL(path, root);
    if (modules.has(url.href)) return modules.get(url.href);
    const code = url.pathname.endsWith('/config.js')
      ? "export const TODOIST_CLIENT_ID = 'fixture'; export const TOKEN_PROXY_URL = 'https://fixture.invalid/token';"
      : await fs.readFile(url, 'utf8');
    const mod = new vm.SourceTextModule(code, { context: ctx, identifier: url.href });
    modules.set(url.href, mod);
    await mod.link((specifier, parent) => loadModule(new URL(specifier, parent.identifier), ctx, modules));
    return mod;
  }
  async function todoistPage() {
    const ctx = context();
    const module = await loadModule('lib/todoist.js', ctx);
    await module.evaluate();
    const api = module.namespace;
    await Promise.all([
      api.getTasksWithSubtasks(),
      api.getCompletedTasksToday
        ? api.getCompletedTasksToday({ limit: 50 })
        : api.getCompletedTasks({ since: new Clock(2026, 8, 13).toISOString(), until: new Clock().toISOString(), limit: 50 })
    ]);
  }
  async function calendarPage() {
    const start = backgroundSource.indexOf("const GOOGLE_CALENDAR_API =");
    const end = backgroundSource.indexOf('function scoreKeywordMatch(', start);
    assert.ok(start > 0 && end > start);
    const source = backgroundSource.slice(start, end);
    const imports = [...backgroundSource.matchAll(/^import[\s\S]*?from\s+['"]([^'"]+)['"];?/gm)]
      .map(match => match[0]).join('\n');
    const ctx = context();
    const module = new vm.SourceTextModule(`${imports}\n${source}\nexport { getNewTabEvents };`, {
      context: ctx, identifier: new URL('background.js', root).href
    });
    const modules = new Map();
    await module.link((specifier, parent) => loadModule(new URL(specifier, parent.identifier), ctx, modules));
    await module.evaluate();
    return module.namespace;
  }
  async function weatherPage() {
    const start = newtabSource.indexOf('async function getCoordinates(');
    const end = newtabSource.indexOf('// SETTINGS', start);
    assert.ok(start > 0 && end > start);
    const nodes = new Map();
    const getElementById = id => {
      if (!nodes.has(id)) nodes.set(id, { textContent: '', innerHTML: '', classList: { add() {}, remove() {}, contains() { return false; } } });
      return nodes.get(id);
    };
    const ctx = context({
      getLocal: storage.get, setLocal: storage.set, hasExtensionStorage: () => true,
      isWidgetVisible: () => true, dashboardSettings: { newtabShowWeather: true },
      document: { visibilityState: 'visible', getElementById },
      getWeatherInfo: () => ({ icon: 'sun', desc: 'Clear' }), Icons: { sun: '', cloud: '' },
      WEATHER_CACHE_TTL: 30 * 60 * 1000
    });
    const cacheImport = [...newtabSource.matchAll(/^import[^;]*from\s+['"]([^'"]*request-cache\.js)['"];?/gm)]
      .map(match => match[0]).join('\n');
    const module = new vm.SourceTextModule(`${cacheImport}\n${newtabSource.slice(start, end)}\nexport { loadWeather };`, {
      context: ctx, identifier: new URL('newtab/newtab.js', root).href
    });
    const modules = new Map();
    await module.link((specifier, parent) => loadModule(new URL(specifier, parent.identifier), ctx, modules));
    await module.evaluate();
    await module.namespace.loadWeather();
  }
  return { counts, todoistPage, calendarPage, weatherPage, advance: () => { now += 100; } };
}

const results = { fixture: 'five dashboard opens within one cache window; no live API traffic' };
for (const concurrent of [false, true]) {
  const state = harness();
  const calendar = await state.calendarPage();
  const open = async () => {
    state.advance();
    await Promise.all([state.todoistPage(), calendar.getNewTabEvents(), state.weatherPage()]);
  };
  if (concurrent) await Promise.all(Array.from({ length: 5 }, open));
  else for (let i = 0; i < 5; i++) await open();
  results[concurrent ? 'concurrentColdOpens' : 'oneColdFourWarmOpens'] = state.counts;
}
results.eagerShaderImports = [...newtabSource.matchAll(/^import .* from ['"].*shader\.js['"];$/gm)].length;
console.log(JSON.stringify(results, null, 2));
