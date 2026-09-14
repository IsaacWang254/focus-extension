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

const tabsSlice = [
  sliceBetween('function getHistoryTrackableDomain', '/**\n * Check if current time'),
  sliceBetween('async function redirectTabsThatShouldNowBeBlocked', 'function getOriginalUrlFromBlockedPage'),
  sliceBetween('async function redirectTabIfNeeded', '/**\n * Handle tab activation')
].join('\n');

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

function makeRulesHarness({ existingRules = [], reevaluateCalls = [], ...extras } = {}) {
  const dnr = { pending: [], applied: [], active: 0, maxActive: 0 };

  const context = vm.createContext({
    ...extras,
    console: { log() {}, error() {}, warn() {}, debug() {} },
    isUpdatingRules: false,
    pendingUpdate: false,
    ruleUpdatePromise: null,
    redirectTabsThatShouldNowBeBlocked: async (reason) => { reevaluateCalls.push(reason); },
    chrome: {
      runtime: { getURL: (p) => `chrome-extension://test/${p}` },
      declarativeNetRequest: {
        getDynamicRules: async () => existingRules,
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
  return { context, dnr, reevaluateCalls };
}

{
  const { context, dnr, reevaluateCalls } = makeRulesHarness({
    existingRules: [{ id: 1000 }, { id: 1001 }]
  });

  const p1 = context.updateBlockingRules();
  await flush();
  assert.equal(dnr.pending.length, 1, 'first pass issues one DNR update');

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

  const finalUpdate = dnr.applied.at(-1);
  assert.equal(finalUpdate.addRules.length, 0, 'no redirect rules are ever added');
  assert.deepEqual([...finalUpdate.removeRuleIds], [1000, 1001], 'legacy dynamic rules are removed');
  assert.deepEqual(reevaluateCalls, ['settings', 'settings'], 'each pass reevaluates open tabs');
}

{
  const { context } = makeRulesHarness({ queueMicrotask });
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
  const { context, dnr } = makeRulesHarness();

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
  const { context, dnr } = makeRulesHarness();

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
  const { context, dnr, reevaluateCalls } = makeRulesHarness({
    existingRules: [{ id: 7 }, { id: 9 }]
  });
  const p = context.updateBlockingRules();
  await flush();
  dnr.pending.shift().resolve();
  await p;

  assert.equal(dnr.applied.length, 1, 'exactly one DNR write per pass');
  assert.equal(dnr.applied[0].addRules.length, 0, 'applyBlockingRules never adds redirect rules');
  assert.deepEqual([...dnr.applied[0].removeRuleIds], [7, 9], 'all legacy dynamic rules are cleared');
  assert.deepEqual(reevaluateCalls, ['settings'], 'tabs are asked to reevaluate after cleanup');
}

function makeTabsHarness({ tabs, failFirstSend = false, failInjection = false } = {}) {
  const sent = [];
  const injected = [];
  const debugs = [];

  const context = vm.createContext({
    console: { log() {}, error() {}, warn() {}, debug: (...a) => debugs.push(a) },
    URL,
    shouldBlockUrl: async () => true,
    chrome: {
      runtime: { getURL: (p) => `chrome-extension://test/${p}` },
      tabs: {
        query: async () => tabs,
        async sendMessage(tabId, message, options) {
          sent.push({ tabId, message, options });
          if (failFirstSend && sent.length === 1) {
            throw new Error('no content script');
          }
          if (failInjection) {
            throw new Error('no content script');
          }
          return true;
        }
      },
      scripting: {
        async executeScript(details) {
          injected.push(details);
          if (failInjection) {
            throw new Error('cannot inject');
          }
        }
      }
    }
  });

  vm.runInContext(tabsSlice, context);
  return { context, sent, injected, debugs };
}

{
  const { context, sent } = makeTabsHarness({
    tabs: [
      { id: 1, url: 'https://x.example/feed' },
      { id: 2, url: 'chrome://extensions' },
      { id: 3, url: 'chrome-extension://test/blocked/blocked.html' },
      { id: 4, url: 'https://ok.example/' }
    ]
  });

  await context.redirectTabsThatShouldNowBeBlocked('expired');
  const targets = sent.map((s) => s.tabId).sort();
  assert.deepEqual(targets, [1, 4], 'only http(s) tabs are reevaluated');
  assert.ok(sent.every((s) => s.message.type === 'REEVALUATE_BLOCKING'), 'tabs get a reevaluate nudge');
  assert.ok(sent.every((s) => s.message.reason === 'expired'), 'reason is forwarded');
  assert.ok(sent.every((s) => s.options.frameId === 0), 'nudge targets the top frame only');
}

{
  const { context, sent, injected } = makeTabsHarness({
    tabs: [{ id: 5, url: 'https://x.example/' }],
    failFirstSend: true
  });

  await context.redirectTabsThatShouldNowBeBlocked('settings');
  assert.equal(injected.length, 1, 'content script is injected when no listener answers');
  assert.equal(injected[0].target.tabId, 5);
  assert.deepEqual([...injected[0].files], ['content-redirect.js']);
  assert.equal(sent.length, 2, 'the reevaluate nudge is retried after injection');
}

{
  const { context, sent, injected, debugs } = makeTabsHarness({
    tabs: [{ id: 6, url: 'https://x.example/' }],
    failInjection: true
  });

  await context.redirectTabsThatShouldNowBeBlocked('settings');
  assert.equal(injected.length, 1);
  assert.equal(sent.length, 1, 'no retry loop when the tab cannot take the script');
  assert.equal(debugs.length, 1, 'unavailable tabs are logged at debug level');
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
