// planner-calendar-data.test.js — freshness gate, in-flight coalescing,
// bounded-concurrency range loading, scope invalidation, generation guards.

import { createPlannerCalendarData } from '../newtab/planner-calendar-data.js';

const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;

const DATES = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: ms => { t += ms; } };
}

test('getDay fetches once, gate blocks refetch within gateMs, force retries only failed', async () => {
  const clk = clock();
  const calls = [];
  const data = createPlannerCalendarData({
    send: async date => { calls.push(date); return { date, events: [{ id: `${date}-e` }] }; },
    now: clk.now
  });
  const first = await data.getDay('2026-09-30');
  assert.deepEqual(calls, ['2026-09-30']);
  assert.equal(first.events[0].id, '2026-09-30-e');
  assert.equal(first.error, null);

  const again = await data.getDay('2026-09-30');
  assert.equal(calls.length, 1, 'fresh result returned from cache');
  assert.equal(again, first);

  const forced = await data.getDay('2026-09-30', { force: true });
  assert.equal(calls.length, 1, 'force does not refetch a healthy fresh day');
  assert.equal(forced, first);

  clk.advance(5 * 60 * 1000);
  await data.getDay('2026-09-30');
  assert.equal(calls.length, 2, 'gate opened after gateMs');
});

test('errors and empty results respect the gate; force retries only failures', async () => {
  const clk = clock();
  const calls = [];
  const data = createPlannerCalendarData({
    send: async date => {
      calls.push(date);
      if (date === '2026-09-29') throw new Error('offline');
      if (date === '2026-09-30') return { date, events: [], disconnected: true, status: 401, error: 'expired' };
      return { date, events: [] };
    },
    now: clk.now
  });
  const failed = await data.getDay('2026-09-29');
  assert.equal(failed.error, 'offline');
  const empty = await data.getDay('2026-10-01');
  assert.equal(empty.events.length, 0);
  const disconnected = await data.getDay('2026-09-30');
  assert.equal(disconnected.disconnected, true);
  assert.equal(calls.length, 3);

  // Within the gate, plain getDay returns cached failures without resending.
  await data.getDay('2026-09-29');
  await data.getDay('2026-10-01');
  assert.equal(calls.length, 3, 'failed and empty results gate like successes');

  // force retries failed/disconnected but not healthy cached days.
  const range = await data.loadRange(['2026-09-29', '2026-10-01', '2026-09-30'], { force: true });
  await range.promise;
  assert.equal(calls.length, 5, 'force retried only error + disconnected days');
  assert.deepEqual(calls.slice(3).sort(), ['2026-09-29', '2026-09-30']);
});

test('in-flight requests for the same date are coalesced', async () => {
  const d = deferred();
  let sends = 0;
  const data = createPlannerCalendarData({ send: () => { sends += 1; return d.promise; } });
  const [a, b] = await Promise.all([data.getDay('2026-09-30'), data.getDay('2026-09-30')].map((p, i, arr) => (d.resolve({ date: '2026-09-30', events: [{ id: 'x' }] }), p)));
  assert.equal(sends, 1);
  assert.equal(a, b, 'shared promise resolved once');
});

test('loadRange sends only missing dates with bounded concurrency', async () => {
  const clk = clock();
  const started = [];
  let active = 0, maxActive = 0;
  const sends = started;
  const data = createPlannerCalendarData({
    send: async date => {
      sends.push(date); active += 1; maxActive = Math.max(maxActive, active);
      await new Promise(r => setTimeout(r, 1));
      active -= 1;
      return { date, events: [{ id: `${date}-e` }] };
    },
    now: clk.now, concurrency: 2
  });
  await data.getDay(DATES[0]);
  sends.length = 0;

  const seen = [];
  const { promise } = data.loadRange(DATES, { onDay: (d, r) => seen.push(d) });
  const results = await promise;
  assert.equal(sends.length, 6, 'cached day reused, only missing dates sent');
  assert.ok(maxActive <= 2, `concurrency <= 2 (saw ${maxActive})`);
  assert.equal(results.size, 7);
  for (const date of DATES) assert.ok(results.get(date), `result for ${date}`);
  assert.equal(seen.length, 7, 'onDay fired for cached + fetched days');
});

test('day → week reuse: cached day is not refetched by loadRange', async () => {
  const calls = [];
  const data = createPlannerCalendarData({
    send: async date => { calls.push(date); return { date, events: [] }; }
  });
  await data.getDay('2026-09-30');
  const { promise } = data.loadRange(DATES);
  await promise;
  assert.equal(calls.filter(d => d === '2026-09-30').length, 1);
});

test('cancel() drops queued dispatches; running requests still cache', async () => {
  const gates = new Map();
  const data = createPlannerCalendarData({
    send: date => {
      const d = deferred();
      gates.set(date, d);
      return d.promise;
    },
    concurrency: 1
  });
  const onDayCalls = [];
  const { promise } = data.loadRange(DATES.slice(0, 3), { onDay: d => onDayCalls.push(d) });
  await new Promise(r => setTimeout(r, 0));
  data.cancel();
  // Finish the already-dispatched first request; queued dates never dispatch.
  gates.get(DATES[0]).resolve({ date: DATES[0], events: [{ id: 'ran' }] });
  await promise;
  assert.equal(gates.size, 1, 'only the dispatched request sent');
  assert.equal(onDayCalls.length, 0, 'cancelled range fires no onDay');
  const cached = await data.getDay(DATES[0]);
  assert.equal(cached.events[0].id, 'ran', 'running request still populated the cache');
});

test('superseded generation late results do not invoke the newer range onDay', async () => {
  const gates = new Map();
  const data = createPlannerCalendarData({
    send: date => { const d = deferred(); gates.set(date, d); return d.promise; },
    concurrency: 1
  });
  const oldSeen = [], newSeen = [];
  data.loadRange([DATES[0], DATES[1]], { onDay: d => oldSeen.push(d) });
  await new Promise(r => setTimeout(r, 0));
  data.cancel();
  const range2 = data.loadRange([DATES[0]], { onDay: d => newSeen.push(d) });
  // The old in-flight request is shared/coalesced into range 2.
  gates.get(DATES[0]).resolve({ date: DATES[0], events: [{ id: 'shared' }] });
  await range2.promise;
  assert.equal(oldSeen.length, 0, 'old generation onDay never fired');
  assert.ok(newSeen.includes(DATES[0]), 'new range saw the shared result');
  assert.equal(gates.has(DATES[1]), false, 'queued date from dead range never sent');
});

test('setScope change clears cache and rejects stale responses', async () => {
  const clk = clock();
  const calls = [];
  const deferreds = [];
  const data = createPlannerCalendarData({
    send: date => { calls.push(date); const d = deferred(); deferreds.push(d); return d.promise; },
    now: clk.now
  });
  const p1 = data.getDay('2026-09-30');
  await new Promise(r => setTimeout(r, 0));
  data.setScope('acct@x|cal:1|tz:UTC');
  // Late response from the old scope is not cached.
  deferreds[0].resolve({ date: '2026-09-30', events: [{ id: 'stale-scope' }] });
  const r1 = await p1;
  assert.equal(r1.events.length, 0, 'cross-scope response not stored');
  assert.ok(r1.error);
  const r2 = data.getDay('2026-09-30', { force: true });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(calls.length, 2, 'scope change cleared the gated day');
  deferreds[1].resolve({ date: '2026-09-30', events: [{ id: 'fresh' }] });
  assert.equal((await r2).events[0].id, 'fresh');
  assert.equal(data.peek('2026-09-30').events[0].id, 'fresh');
});

test('setScope with the same key is a no-op', async () => {
  const calls = [];
  const data = createPlannerCalendarData({
    send: async date => { calls.push(date); return { date, events: [] }; }
  });
  data.setScope('a');
  await data.getDay('2026-09-30');
  data.setScope('a');
  await data.getDay('2026-09-30');
  assert.equal(calls.length, 1, 'unchanged scope keeps cache');
});

test('payload.date mismatch is rejected and not cached as success', async () => {
  const data = createPlannerCalendarData({
    send: async date => ({ date: '1999-01-01', events: [{ id: 'wrong' }] })
  });
  const result = await data.getDay('2026-09-30');
  assert.equal(result.events.length, 0);
  assert.ok(result.error, 'mismatch surfaces as error');
  assert.equal(data.peek('2026-09-30'), null, 'mismatched payload not cached');
});

test('cache is bounded: oldest dates evicted, today and in-flight never evicted', async () => {
  // now() must map to a real local date for "today" protection; pin it to a
  // Tuesday morning and fetch a run of dates around it.
  const base = new Date(2026, 8, 30, 10, 0).getTime(); // 2026-09-30 local
  const clk = clock(base);
  const calls = [];
  const data = createPlannerCalendarData({
    send: async date => { calls.push(date); return { date, events: [{ id: date }] }; },
    now: clk.now,
    maxDates: 3
  });
  // Fill the bound: today + two older days + one newer, all within the gate.
  await data.getDay('2026-09-30'); // today — protected
  await data.getDay('2026-09-28');
  await data.getDay('2026-09-29');
  await data.getDay('2026-10-01'); // exceeds the cap: evicts oldest (09-28)
  assert.equal(data.peek('2026-09-30') !== null, true, 'today never evicted');
  assert.equal(data.peek('2026-09-28'), null, 'oldest attemptedAt evicted');
  assert.equal(data.peek('2026-09-29') !== null, true);
  assert.equal(data.peek('2026-10-01') !== null, true);

  // A cached day that is being refetched (in-flight) is never evicted.
  const d2 = deferred();
  const clk2 = clock(base);
  let slow = false;
  const keep = createPlannerCalendarData({
    send: date => (date === '2026-09-29' && slow) ? d2.promise : Promise.resolve({ date, events: [] }),
    now: clk2.now, maxDates: 2
  });
  await keep.getDay('2026-09-29');
  clk2.advance(6 * 60 * 1000);           // open the gate
  slow = true;
  const refreshing = keep.getDay('2026-09-29'); // stale entry + in-flight refetch
  await keep.getDay('2026-10-02');
  await keep.getDay('2026-10-03');       // overflow → eviction pass
  assert.ok(keep.peek('2026-09-29'), 'in-flight date survives eviction');
  assert.equal(keep.peek('2026-10-02'), null, 'oldest non-protected date evicted');
  d2.resolve({ date: '2026-09-29', events: [] });
  await refreshing;

  // A range that re-reads every date should only resend evicted/missing ones.
  calls.length = 0;
  const { promise } = data.loadRange(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01']);
  await promise;
  assert.deepEqual(calls, ['2026-09-28'], 'only the evicted date refetched');
});

test('per-day status flags are preserved (partial/stale/disconnected)', async () => {
  const data = createPlannerCalendarData({
    send: async date => date === '2026-09-30'
      ? { date, events: [{ id: 'e' }], stale: true, partial: true }
      : { date, events: [], disconnected: true, error: 'expired' }
  });
  const stale = await data.getDay('2026-09-30');
  assert.equal(stale.stale, true);
  assert.equal(stale.partial, true);
  assert.equal(stale.status ?? null, null);
  const disc = await data.getDay('2026-10-01');
  assert.equal(disc.disconnected, true);
  assert.equal(disc.error, 'expired');
});
