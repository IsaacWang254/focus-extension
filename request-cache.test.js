import assert from 'node:assert/strict';
import { getCachedResource, cacheScope, withSharedLock } from './lib/request-cache.js';

const store = {};
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        if (keys == null) return structuredClone(store);
        if (typeof keys === 'string') return { [keys]: structuredClone(store[keys]) };
        const list = Array.isArray(keys) ? keys : Object.keys(keys);
        return structuredClone(Object.fromEntries(list.map(k => [k, store[k] ?? (Array.isArray(keys) ? undefined : keys[k])])));
      },
      async set(values) { Object.assign(store, structuredClone(values)); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key]; }
    }
  }
};

let now = 1_000_000;
const realNow = Date.now;
Date.now = () => now;
process.on('exit', () => { Date.now = realNow; });

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

let seq = 0;
const freshKey = () => `test:${seq++}`;

{
  const key = freshKey();
  let calls = 0;
  const results = await Promise.all(Array.from({ length: 5 }, () =>
    getCachedResource(key, {
      ttl: 60_000,
      load: async () => { calls++; await flush(); return [1, 2, 3]; }
    })
  ));
  assert.equal(calls, 1, 'five simultaneous requests must share one load');
  for (const result of results) assert.deepEqual(result, [1, 2, 3]);
}

{
  const key = freshKey();
  let calls = 0;
  const opts = { ttl: 60_000, load: async () => { calls++; return 'v'; } };
  await getCachedResource(key, opts);
  const second = await getCachedResource(key, opts);
  assert.equal(calls, 1, 'a fresh entry must not refetch');
  assert.equal(second, 'v');
}

{
  const key = freshKey();
  let calls = 0;
  const opts = { ttl: 60_000, load: async () => { calls++; return []; } };
  const first = await getCachedResource(key, opts);
  const second = await getCachedResource(key, opts);
  assert.equal(calls, 1, 'an empty array must be cached like any other value');
  assert.deepEqual(first, []);
  assert.deepEqual(second, []);
}

{
  const key = freshKey();
  let calls = 0;
  const opts = { ttl: 60_000, load: async () => { calls++; return calls; } };
  assert.equal(await getCachedResource(key, opts), 1);
  now += 60_001;
  assert.equal(await getCachedResource(key, opts), 2, 'a stale entry past ttl must refetch');
  assert.equal(calls, 2);
}

{
  const key = freshKey();
  const opts = {
    ttl: 60_000,
    load: async () => [{ id: 1, subtasks: [] }]
  };
  const first = await getCachedResource(key, opts);
  first[0].subtasks.push({ id: 2 });
  first.push({ id: 3 });
  const second = await getCachedResource(key, opts);
  assert.deepEqual(second, [{ id: 1, subtasks: [] }], 'mutating a returned value must not corrupt the cache');
}

{
  const key = freshKey();
  let calls = 0;
  let resolveLoad;
  const opts = {
    ttl: 60_000, maxStale: 600_000, staleWhileRevalidate: true,
    load: async () => {
      calls++;
      if (calls === 1) return 'old';
      return new Promise(resolve => { resolveLoad = () => resolve('new'); });
    }
  };
  assert.equal(await getCachedResource(key, opts), 'old');
  now += 120_000;
  const stale = await getCachedResource(key, opts);
  assert.equal(stale, 'old', 'SWR must resolve with the stale value before the load finishes');
  await flush();
  resolveLoad();
  await flush();
  assert.equal(await getCachedResource(key, opts), 'new', 'the background refresh must land in storage');
  assert.equal(calls, 2);
}

{
  const key = freshKey();
  let calls = 0;
  const opts = {
    ttl: 60_000, maxStale: 600_000,
    load: async () => {
      calls++;
      if (calls === 2) { const e = new Error('boom'); e.status = 500; throw e; }
      return 'good';
    }
  };
  assert.equal(await getCachedResource(key, opts), 'good');
  const before = structuredClone(store[key]);
  now += 120_000;
  const value = await getCachedResource(key, opts);
  assert.equal(value, 'good', 'a transient failure must still serve the stale value inside maxStale');
  assert.equal(store[key].updatedAt, before.updatedAt, 'a failed refresh must not advance updatedAt');
}

{
  const key = freshKey();
  let calls = 0;
  const opts = {
    ttl: 60_000,
    load: async () => { calls++; const e = new Error('down'); e.status = 500; throw e; }
  };
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => getCachedResource(key, opts)));
  assert.equal(calls, 1, 'requests inside the failure cooldown must not retry');
  for (const r of results) assert.equal(r.status, 'rejected');
}

{
  const key = freshKey();
  let calls = 0;
  const opts = {
    ttl: 60_000,
    load: async () => {
      calls++;
      const e = new Error('slow down');
      e.status = 429;
      e.retryAfterMs = 300_000;
      throw e;
    }
  };
  await assert.rejects(() => getCachedResource(key, opts));
  await assert.rejects(
    () => getCachedResource(key, { ...opts, force: true }),
    /unavailable|slow down/,
    'force must not bypass a 429 cooldown'
  );
  assert.equal(calls, 1);
}

for (const status of [401, 403]) {
  const key = freshKey();
  let calls = 0;
  let failing = false;
  const opts = {
    ttl: 60_000, maxStale: 600_000,
    load: async () => {
      calls++;
      if (failing) { const e = new Error('denied'); e.status = status; throw e; }
      return 'secret';
    }
  };
  assert.equal(await getCachedResource(key, opts), 'secret');
  now += 120_000;
  failing = true;
  await assert.rejects(() => getCachedResource(key, opts));
  const entry = store[key];
  assert.ok(entry, `a ${status} must leave an error record`);
  assert.equal(entry.status, status);
  assert.ok(!Object.prototype.hasOwnProperty.call(entry, 'value'), `a ${status} record must never carry a value`);
  await assert.rejects(() => getCachedResource(key, opts));
  await assert.rejects(() => getCachedResource(key, { ...opts, force: true }));
  assert.equal(calls, 2, `a ${status} cooldown must suppress retries — including force`);
  now += 60_001;
  failing = false;
  assert.equal(await getCachedResource(key, opts), 'secret', 'after the cooldown a fresh attempt runs');
  assert.equal(calls, 3);
}

{
  const key = freshKey();
  let context = 'account-a';
  let resolveLoad;
  const isCurrent = async () => context === 'account-a';
  const pending = getCachedResource(key, {
    scope: 'a', ttl: 60_000, isCurrent,
    load: () => new Promise(resolve => { resolveLoad = () => resolve('a-data'); })
  });
  await flush();
  context = 'account-b';
  resolveLoad();
  await assert.rejects(pending, /context changed/);
  assert.equal(store[key], undefined, 'a scope change mid-flight must not persist the old data');
}

{
  const key = freshKey();
  let calls = 0;
  const load = async () => { calls++; return calls; };
  assert.equal(await getCachedResource(key, { scope: 'one', ttl: 60_000, load }), 1);
  assert.equal(await getCachedResource(key, { scope: 'two', ttl: 60_000, load }), 2,
    'a different scope must not be served the first scope\'s value');
}

{
  const a = await cacheScope(['token-secret', 'rev', '/tasks']);
  const b = await cacheScope(['token-secret', 'rev', '/tasks']);
  const c = await cacheScope(['other', 'rev', '/tasks']);
  assert.equal(a, b, 'cacheScope must be deterministic');
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.ok(!a.includes('token-secret'), 'the scope must not contain plaintext secrets');
}

{
  let active = 0;
  let maxActive = 0;
  await Promise.all(Array.from({ length: 4 }, () =>
    withSharedLock('test-lock', async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await flush();
      active--;
    })
  ));
  assert.equal(maxActive, 1, 'the shared lock must serialize callbacks');
}

{
  const key = freshKey();
  let calls = 0;
  const opts = {
    ttl: 60_000,
    load: async () => {
      calls++;
      const e = new Error('slow down');
      e.status = 429;
      e.retryAfterMs = 7200000;
      throw e;
    }
  };
  await assert.rejects(() => getCachedResource(key, opts));
  assert.equal(store[key].retryAt, now + 7200000, 'Retry-After is honored without a cap');
  now += 3600001;
  await assert.rejects(() => getCachedResource(key, opts));
  assert.equal(calls, 1, 'mid-cooldown requests do not retry');
  now += 3600000;
  await assert.rejects(() => getCachedResource(key, opts));
  assert.equal(calls, 2, 'a fresh attempt runs once the cooldown elapses');
}

console.log('request-cache tests passed');
