import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./background.js', import.meta.url), 'utf8');

function sliceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start > 0 && end > start, `could not locate slice ${startMarker}`);
  return source.slice(start, end);
}

const rulesSlice = sliceBetween(
  'async function updateBlockingRules',
  '/**\n * Handle messages from other parts'
);

const incrementSlice = sliceBetween(
  'async function incrementBlockAttempts',
  '/**\n * Check blocking-related achievements'
);

const tempUnblockSlice = sliceBetween(
  'async function temporaryUnblock',
  '/**\n * Handle alarms'
);

const tick = () => new Promise((r) => setImmediate(r));
async function flush(times = 8) {
  for (let i = 0; i < times; i++) await tick();
}

function makeRulesHarness({ settings, tempUnblocks = {}, ...extras } = {}) {
  const store = { tempUnblocks };
  const dnr = { pending: [], applied: [], active: 0, maxActive: 0 };

  const context = vm.createContext({
    ...extras,
    console: { log() {}, error() {}, warn() {} },
    isUpdatingRules: false,
    pendingUpdate: false,
    ruleUpdatePromise: null,
    RULE_ID_START: 1000,
    BLOCKED_RESOURCE_TYPES: ['main_frame'],
    TEMP_UNBLOCK_ALL_KEY: '__all__',
    getSettings: async () => settings,
    getAllBlockedDomains: (s) => s.blockedSites || [],
    extractDomain: (d) => d,
    isInAllowedTimeWindow: () => true,
    isTempUnblockActive: (expiry, now) => expiry > now,
    hasEffectiveGlobalTempUnblock: () => false,
    isOnFocusBreak: async () => false,
    buildAllowedUrlRegex: (url) => `^${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
    chrome: {
      runtime: { getURL: (p) => `chrome-extension://test/${p}` },
      storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, o) } },
      declarativeNetRequest: {
        getDynamicRules: async () => [],
        updateDynamicRules(args) {
          dnr.active += 1;
          dnr.maxActive = Math.max(dnr.maxActive, dnr.active);
          return new Promise((resolve, reject) => {
            dnr.pending.push({
              args,
              resolve: () => { dnr.active -= 1; dnr.applied.push(args); resolve(); },
              reject: (e) => { dnr.active -= 1; reject(e); }
            });
          });
        }
      }
    }
  });

  vm.runInContext(rulesSlice, context);
  return { context, store, dnr };
}

const blocklistSettings = (overrides = {}) => ({
  enabled: true,
  mode: 'blocklist',
  blockedSites: ['x.example'],
  allowedUrls: [],
  blockedKeywords: { enabled: false, keywords: [] },
  allowedSites: [],
  schedule: { enabled: false },
  ...overrides
});

{
  const { context, store, dnr } = makeRulesHarness({ settings: blocklistSettings() });

  const p1 = context.updateBlockingRules();
  await flush();
  assert.equal(dnr.pending.length, 1, 'first pass issues one DNR update');

  store.tempUnblocks = { 'x.example': Date.now() + 60000 };
  const p2 = context.updateBlockingRules();
  assert.equal(typeof p2?.then, 'function', 'concurrent update must return the in-flight promise');

  let p2Settled = false;
  p2.then(() => { p2Settled = true; }, () => { p2Settled = true; });

  dnr.pending.shift().resolve();
  await flush();
  assert.equal(p2Settled, false, 'waiter must not resolve on the stale pass — a follow-up is owed');
  assert.equal(dnr.pending.length, 1, 'follow-up pass issues its own DNR update');

  dnr.pending.shift().resolve();
  await flush();
  assert.equal(p2Settled, true, 'waiter resolves once the latest pass lands');
  await p1;
  await p2;

  const finalRules = dnr.applied.at(-1).addRules;
  assert.ok(
    !finalRules.some((r) => (r.condition.regexFilter || '').includes('x\\.example')),
    'final rules must exclude the temporarily unblocked domain'
  );
}

{
  const { context } = makeRulesHarness({ settings: blocklistSettings(), queueMicrotask });
  let applied = 0;
  let second;
  context.bump = () => { applied += 1; };
  context.getApplied = () => applied;
  context.setSecond = (p) => { second = p; };
  vm.runInContext(`
    applyBlockingRules = () => {
      bump();
      if (getApplied() === 1) {
        queueMicrotask(() => queueMicrotask(() => {
          setSecond(updateBlockingRules());
        }));
      }
      return Promise.resolve();
    };
  `, context);
  await context.updateBlockingRules();
  await flush();
  await second;
  assert.equal(applied, 2, 'a request at queue completion must not be lost between draining and releasing the lock');
}

{
  const { context, dnr } = makeRulesHarness({ settings: blocklistSettings() });

  const p1 = context.updateBlockingRules();
  await flush();
  const p2 = context.updateBlockingRules();
  let p2Settled = false;
  p2.then(() => { p2Settled = true; }, () => { p2Settled = true; });

  dnr.pending.shift().resolve();
  await flush();
  assert.equal(dnr.pending.length, 1, 'follow-up pass in flight');

  const p3 = context.updateBlockingRules();
  let p3Settled = false;
  p3.then(() => { p3Settled = true; }, () => { p3Settled = true; });

  dnr.pending.shift().resolve();
  await flush();
  assert.equal(p2Settled, false, 'waiter still pending until the newest pass lands');
  assert.equal(dnr.pending.length, 1, 'a further pass was scheduled');

  dnr.pending.shift().resolve();
  await flush();
  assert.equal(p2Settled && p3Settled, true, 'all waiters resolve after the final pass');
  await p1; await p2; await p3;
  assert.equal(dnr.maxActive, 1, 'never more than one DNR update in flight');
  assert.equal(dnr.applied.length, 3, 'three passes total');
}

{
  const { context, dnr } = makeRulesHarness({ settings: blocklistSettings() });

  const p1 = context.updateBlockingRules();
  await flush();
  const p2 = context.updateBlockingRules();

  const err = new Error('dnr exploded');
  const r1 = p1.then(() => 'ok', (e) => e);
  const r2 = Promise.resolve(p2).then(() => 'ok', (e) => e);
  dnr.pending.shift().reject(err);
  const [v1, v2] = await Promise.all([r1, r2]);
  assert.equal(v1, err, 'first caller rejects with the real error');
  assert.equal(v2, err, 'queued caller rejects too — no fake success');

  const p3 = context.updateBlockingRules();
  await flush();
  assert.equal(dnr.pending.length, 1, 'lock released: a later explicit update runs');
  dnr.pending.shift().resolve();
  await p3;
}

{
  const { context, dnr } = makeRulesHarness({ settings: blocklistSettings() });
  const p = context.updateBlockingRules();
  await flush();
  dnr.pending.shift().resolve();
  await p;

  const rules = dnr.applied.at(-1).addRules;
  assert.ok(
    rules.some((r) => r.action.type === 'allow' && r.condition.regexFilter.includes('blocked/blocked\\.html')),
    'blocklist mode still allows the blocked page itself'
  );
  assert.ok(
    rules.some((r) =>
      r.action.type === 'redirect'
      && r.condition.regexFilter === '^https?://(www\\.)?x\\.example.*'
      && r.action.redirect.regexSubstitution.includes('?url=')),
    'blocklist mode still redirects the blocked domain to the blocked page'
  );
}

{
  const { context, dnr } = makeRulesHarness({
    settings: blocklistSettings({ mode: 'allowlist', allowedSites: ['ok.example'] })
  });
  const p = context.updateBlockingRules();
  await flush();
  dnr.pending.shift().resolve();
  await p;

  const rules = dnr.applied.at(-1).addRules;
  assert.ok(
    rules.some((r) => r.action.type === 'redirect' && r.condition.regexFilter === '^https?://.*'),
    'allowlist mode still blocks everything'
  );
  assert.ok(
    rules.some((r) => r.action.type === 'allow' && r.condition.urlFilter === '||ok.example^'),
    'allowlist mode still allows the allowed domain'
  );
}

{
  const context = vm.createContext({
    console: { log() {}, error(...a) { context._errors.push(a); }, warn() {} },
    _errors: [],
    getTotalBlockAttempts: async () => 41,
    incrementBlockedPageCounter: async () => { context._counterIncremented = true; },
    checkBlockingAchievements: () => new Promise((resolve) => { context._achievementsResolve = resolve; }),
    chrome: { storage: { local: { set: async (o) => { context._written = o; } } } }
  });
  vm.runInContext(incrementSlice, context);

  let settled = false;
  let value;
  context.incrementBlockAttempts().then((v) => { settled = true; value = v; });
  await flush();
  assert.equal(settled, true, 'response must not wait for the achievement check');
  assert.equal(value, 42, 'returns the new total');
  assert.equal(context._written?.totalBlockAttempts, 42, 'counter write is still awaited');
  assert.equal(context._counterIncremented, true, 'page counter is still awaited');
}

{
  const context = vm.createContext({
    console: { log() {}, error() {}, warn() {} },
    getTotalBlockAttempts: async () => 0,
    incrementBlockedPageCounter: async () => {},
    checkBlockingAchievements: async () => { throw new Error('achievements exploded'); },
    chrome: { storage: { local: { set: async () => {} } } }
  });
  vm.runInContext(incrementSlice, context);
  const value = await context.incrementBlockAttempts();
  assert.equal(value, 1, 'achievement failure must not reject the counter increment');
}

{
  let fakeNow = 1_000_000;
  class FakeDate extends Date {
    static now() { return fakeNow; }
  }

  const alarms = [];
  const store = { tempUnblocks: {} };
  const context = vm.createContext({
    console: { log() {}, error() {}, warn() {} },
    Date: FakeDate,
    TEMP_UNBLOCK_ALL_KEY: '__all__',
    extractDomain: (d) => d,
    getSettings: async () => ({
      unblockAllBlockedSites: false,
      earnedTime: { enabled: false, requireTasksToUnlock: false },
      schedule: { enabled: false }
    }),
    isNuclearModeActive: async () => false,
    isDailyLimitExceeded: async () => false,
    getEarnedTimeBank: async () => ({ minutes: 0 }),
    getRemainingDailyTime: async () => null,
    getCurrentWindowEndTime: () => null,
    useEarnedTime: async () => {},
    updateBlockingRules: async () => { fakeNow += 5000; },
    updateBadgeTimer: async () => {},
    scheduleWindowEndAlarm: async () => {},
    recordUnblockForStreak: async () => {},
    decrementBlockedPageCounter: async () => {},
    chrome: {
      storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, o) } },
      alarms: {
        create: (name, info) => alarms.push({ name, ...info }),
        clear: () => {}
      }
    }
  });
  vm.runInContext(tempUnblockSlice, context);

  const result = await context.temporaryUnblock('x.example', 1);
  assert.equal(result.success, true);
  const storedExpiry = store.tempUnblocks['x.example'];
  const reblock = alarms.find((a) => a.name === 'reblock_x.example');
  assert.ok(reblock, 'reblock alarm scheduled');
  assert.equal(
    reblock.when,
    storedExpiry,
    'reblock alarm must target the authoritative expiry, not now+minutes measured after the rule update'
  );
}

console.log('blocking rules update tests passed');
