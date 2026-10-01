import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../lib/todoist.js', import.meta.url), 'utf8');
const transformed = source
  .replace(/^import[^\n]*\n/gm, '')
  .replace(/^export /gm, '');
const cacheSource = fs.readFileSync(new URL('../lib/request-cache.js', import.meta.url), 'utf8')
  .replace(/^export /gm, '');

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function harness({ taskPages = null, projectPages = null } = {}) {
  const counts = { tasks: 0, labels: 0, projects: 0 };
  const requests = [];
  const store = { todoistToken: 'token-a', todoistCacheRevision: 'rev-a' };
  let now = new Date(2026, 8, 13, 12).getTime();

  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }

  let rejectTokenA = false;
  let pendingRelease = null;

  const fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    requests.push({ url: url.toString(), method: (options.method || 'GET').toUpperCase(), body: options.body });
    const auth = options.headers?.Authorization;
    if (rejectTokenA && auth === 'Bearer token-a') {
      if (pendingRelease) await pendingRelease;
      return new Response('Unauthorized', { status: 401 });
    }
    let body;
    if (url.pathname.endsWith('/tasks') && (options.method || 'GET') === 'GET') {
      counts.tasks++;
      body = taskPages?.[url.searchParams.get('cursor') || 'first'] ||
        { results: [{ id: `task:${auth}:${url.search || 'all'}`, content: `task for ${auth}`, priority: 1 }], next_cursor: null };
    } else if (url.pathname.endsWith('/labels')) {
      counts.labels++;
      body = { results: [{ id: 'l1', name: 'Work', color: 'red' }], next_cursor: null };
    } else if (url.pathname.endsWith('/projects')) {
      counts.projects++;
      body = projectPages?.[url.searchParams.get('cursor') || 'first'] ||
        { results: [{ id: 'p1', name: 'Inbox' }], next_cursor: null };
    } else if (/\/tasks\/[^/]+$/.test(url.pathname) && (options.method || 'GET') === 'POST') {
      body = { id: url.pathname.split('/').pop(), ...JSON.parse(options.body) };
    } else if (url.pathname.endsWith('/close') || url.pathname.endsWith('/reopen') || url.pathname.endsWith('/tasks')) {
      body = null;
    } else {
      throw new Error(`Unexpected fixture request: ${url.pathname}`);
    }
    await flush();
    if (body === null) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
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
    TODOIST_CLIENT_ID: 'fixture', TOKEN_PROXY_URL: 'https://fixture.invalid/token',
    chrome: { storage: { local: storage, onChanged: { addListener() {} } } },
    fetch, Date: Clock, URL, URLSearchParams, TextEncoder, Response,
    AbortSignal, structuredClone, crypto, console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, queueMicrotask
  };
  vm.createContext(sandbox);
  vm.runInContext(cacheSource, sandbox);
  vm.runInContext(`${transformed}
this.api = { getToken, isAuthenticated, logout, getTasks, getTasksWithSubtasks, getTask,
  completeTask, reopenTask, createTask,
  updateTask, getProjects, getLabels, getLabelsMap };`, sandbox);

  return {
    api: sandbox.api, counts, requests, store,
    setToken(token, revision) { store.todoistToken = token; store.todoistCacheRevision = revision; },
    rejectTokenA(v, gate) { rejectTokenA = v; pendingRelease = gate; },
    advanceMs(ms) { now += ms; },
    nextDay() { now += 24 * 60 * 60 * 1000; }
  };
}

{
  const h = harness();
  for (let i = 0; i < 2; i++) {
    await h.api.getTasksWithSubtasks();
  }
  assert.equal(h.counts.tasks, 1, 'second open must reuse the tasks cache');
}

{
  const h = harness();
  await h.api.getTasksWithSubtasks();
  h.advanceMs(2 * 60 * 1000 - 1);
  await h.api.getTasksWithSubtasks();
  assert.equal(h.counts.tasks, 1, 'a hit inside the TTL window is still fresh');
  h.advanceMs(2);
  await h.api.getTasksWithSubtasks();
  assert.equal(h.counts.tasks, 2, 'past the TTL the request refetches');
}

{
  const h = harness();
  const first = await h.api.getTasksWithSubtasks();
  first[0].content = 'mutated';
  const second = await h.api.getTasksWithSubtasks();
  assert.equal(second[0].content, 'task for Bearer token-a', 'callers cannot corrupt the cached value');
  assert.notEqual(second[0], first[0]);
}

{
  const h = harness();
  const byProject = await h.api.getTasks({ projectId: 'p1' });
  assert.match(byProject[0].id, /project_id=p1/, 'the project query must get its own response');
  const byFilter = await h.api.getTasks({ filter: 'today' });
  assert.match(byFilter[0].id, /filter=today/, 'the filter query must not be served the project entry');
  const again = await h.api.getTasks({ projectId: 'p1' });
  assert.match(again[0].id, /project_id=p1/);
  assert.equal(h.counts.tasks, 3, 'a repeated query after an intervening scope must refetch, not cross data');
}

for (const mutate of ['completeTask', 'reopenTask', 'createTask', 'updateTask']) {
  const h = harness();
  await h.api.getTasksWithSubtasks();
  if (mutate === 'createTask') await h.api.createTask({ content: 'x' });
  else if (mutate === 'updateTask') await h.api.updateTask('t1', { priority: 4 });
  else await h.api[mutate]('t1');
  await h.api.getTasksWithSubtasks();
  assert.equal(h.counts.tasks, 2, `${mutate} must invalidate the tasks cache`);
}

{
  const h = harness({
    taskPages: {
      first: { results: [{ id: 'parent', content: 'Parent', priority: 1 }], next_cursor: 'page-2' },
      'page-2': { results: [
        { id: 'child', parent_id: 'parent', content: 'Child', priority: 1, order: 1 },
        { id: 'child', parent_id: 'parent', content: 'Duplicate child', priority: 1, order: 1 },
        { id: 'grandchild', parent_id: 'child', content: 'Grandchild', priority: 1, order: 1 }
      ], next_cursor: null }
    }
  });
  const tasks = await h.api.getTasksWithSubtasks();
  assert.equal(h.counts.tasks, 2, 'task reads must exhaust every cursor page');
  assert.equal(tasks.length, 1, 'the parent remains the sole top-level task');
  assert.equal(tasks[0].subtasks.length, 1, 'a child repeated across pages is not duplicated');
  assert.equal(tasks[0].subtasks[0].subtasks[0].id, 'grandchild', 'nested ancestry survives pagination');
  await h.api.getTasksWithSubtasks();
  assert.equal(h.counts.tasks, 2, 'the complete paginated task result is cached as one list');
}

{
  const h = harness({
    projectPages: {
      first: { results: [{ id: 'p1', name: 'Inbox' }], next_cursor: 'page-2' },
      'page-2': { results: [{ id: 'p2', name: 'Work' }], next_cursor: null }
    }
  });
  const projects = await h.api.getProjects();
  assert.deepEqual(projects.map(project => project.id), ['p1', 'p2'], 'project reads must exhaust every cursor page');
  assert.equal(h.counts.projects, 2);
}

{
  const h = harness();
  const updated = await h.api.updateTask('t1', { due_date: '2026-09-14', priority: 4 });
  assert.equal(updated.priority, 4);
  assert.equal(h.requests.at(-1).method, 'POST', 'task updates use Todoist\'s mutation path');
  assert.match(h.requests.at(-1).url, /\/tasks\/t1$/);
}


{
  const h = harness();
  let release;
  h.rejectTokenA(true, new Promise(r => { release = r; }));
  const pending = h.api.getTasks({ forceRefresh: true });
  await flush();
  h.setToken('token-b', 'rev-b');
  release();
  await assert.rejects(pending);
  assert.equal(h.store.todoistToken, 'token-b', 'an in-flight 401 from the old token must not clear the new one');
}

{
  const h = harness();
  await h.api.getTasksWithSubtasks();
  await h.api.logout();
  assert.equal(h.store['focusCache:todoist:tasks'], undefined, 'logout must drop cached tasks');
  h.setToken('token-b', 'rev-b');
  const tasks = await h.api.getTasksWithSubtasks();
  assert.equal(h.counts.tasks, 2, 'the new account must refetch rather than reuse the old cache');
  assert.match(tasks[0].id, /token-b/, 'the new account sees its own payload, not a leftover');
}

{
  const h = harness();
  const first = await h.api.getLabelsMap();
  assert.equal(first.get('work').id, 'l1');
  h.setToken('token-b', 'rev-b');
  const second = await h.api.getLabelsMap();
  assert.equal(h.counts.labels, 2, 'labels must be refetched for a different token');
  assert.equal(second.get('work').id, 'l1');
}

{
  const h = harness();
  await h.api.getLabels();
  await h.api.getLabels();
  await h.api.getProjects();
  await h.api.getProjects();
  assert.equal(h.counts.labels, 1, 'labels reads must share the cache');
  assert.equal(h.counts.projects, 1, 'projects reads must share the cache');
}

console.log('todoist-cache tests passed');
