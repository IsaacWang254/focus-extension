import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../blocked/blocked.js', import.meta.url), 'utf8');

function sliceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start > 0 && end > start, `could not locate slice ${startMarker}`);
  return source.slice(start, end);
}

const timerSlice = sliceBetween('// Timer Method', '// Math Problem Method')
  .replace('let timerRemainingSeconds = 0;', '')
  .replace('let timerTotalSeconds = 0;', '')
  .replace(/let isPageVisible = [^\n]*\n/, '');
assert.ok(!/let isPageVisible/.test(timerSlice), 'isPageVisible declaration should be provided by the harness');
assert.ok(!/let timerRemainingSeconds/.test(timerSlice), 'timerRemainingSeconds declaration should be provided by the harness');

const readinessSlice = sliceBetween('// Check if unblock is ready', '// Get selected time limit')
  .replace('let unblockEnabled = false;', '');

const setupSlice = sliceBetween('async function setupUnblockMethods', '/**\n * Show the schedule locked');

const clickSlice = sliceBetween(
  "unblockButton.addEventListener('click', async () => {",
  'const whitelistButton'
);

const navigateSlice = sliceBetween('function isInPageBlocker', 'function getExactWhitelistTargetUrl');

function makeEl(id = '') {
  const el = {
    id,
    style: {},
    dataset: {},
    textContent: '',
    value: '',
    disabled: false,
    children: [],
    parent: null,
    listeners: {},
    className: '',
    classList: null,
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    appendChild(child) { child.parent = this; this.children.push(child); return child; },
    remove() {
      if (this.parent) {
        const i = this.parent.children.indexOf(this);
        if (i >= 0) this.parent.children.splice(i, 1);
        this.parent = null;
      }
    },
    querySelector(selector) {
      const match = (c) => selector.startsWith('.')
        ? (c.className || '').split(' ').includes(selector.slice(1))
        : c.id === selector.slice(1);
      for (const child of this.children) {
        if (match(child)) return child;
        const found = child.querySelector(selector);
        if (found) return found;
      }
      return null;
    },
    focus() {},
    click() { return (this.listeners.click || []).map((f) => f()); }
  };
  const classes = new Set();
  el.classList = {
    add(...c) { c.forEach((x) => classes.add(x)); },
    remove(...c) { c.forEach((x) => classes.delete(x)); },
    toggle(c, force) {
      const on = force === undefined ? !classes.has(c) : force;
      on ? classes.add(c) : classes.delete(c);
    },
    contains(c) { return classes.has(c); }
  };
  return el;
}

function makeHarness({ hidden = false, focused = true } = {}) {
  const elements = new Map();
  const queried = new Map();
  const documentListeners = {};
  const windowListeners = {};

  const document = {
    hidden,
    _focused: focused,
    hasFocus() { return this._focused; },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeEl(id));
      return elements.get(id);
    },
    querySelector(selector) {
      if (!queried.has(selector)) queried.set(selector, makeEl(selector));
      return queried.get(selector);
    },
    querySelectorAll() { return []; },
    createElement() { return makeEl(); },
    addEventListener(type, fn) {
      const list = (documentListeners[type] ||= []);
      if (!list.includes(fn)) list.push(fn);
    },
    removeEventListener(type, fn) {
      const list = documentListeners[type] || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    }
  };

  const methodTimer = document.getElementById('method-timer');
  methodTimer.appendChild(Object.assign(makeEl('method-content'), { className: 'method-content' }));

  const windowObj = {
    location: { href: '', search: '', replace(u) { this.href = u; } },
    addEventListener(type, fn) {
      const list = (windowListeners[type] ||= []);
      if (!list.includes(fn)) list.push(fn);
    },
    removeEventListener(type, fn) {
      const list = windowListeners[type] || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    }
  };
  windowObj.top = windowObj;

  let now = 0;
  const timers = [];
  let nextId = 1;

  const pushTimer = (fn, ms, interval) => {
    const t = { id: nextId++, fn, at: now + ms, interval };
    timers.push(t);
    return t.id;
  };
  const clearTimer = (id) => {
    const i = timers.findIndex((t) => t.id === id);
    if (i >= 0) timers.splice(i, 1);
  };

  const context = vm.createContext({
    console,
    document,
    window: windowObj,
    URL,
    URLSearchParams,
    performance: { now: () => now },
    setTimeout: (fn, ms) => pushTimer(fn, ms, null),
    clearTimeout: clearTimer,
    setInterval: (fn, ms) => pushTimer(fn, ms, ms),
    clearInterval: clearTimer
  });

  const h = {
    context,
    document,
    window: windowObj,
    documentListeners,
    windowListeners,
    now: () => now,
    setNow(v) { now = v; },
    pendingTimers: () => timers.slice(),
    fire(timer) {
      const i = timers.indexOf(timer);
      assert.ok(i >= 0, 'timer is not pending');
      if (timer.interval) {
        timer.at = now + timer.interval;
      } else {
        timers.splice(i, 1);
      }
      timer.fn();
    },
    runUntil(target) {
      for (;;) {
        const due = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        now = due.at;
        this.fire(due);
      }
      now = target;
    },
    fireDocument(type) { (documentListeners[type] || []).slice().forEach((f) => f()); },
    fireWindow(type) { (windowListeners[type] || []).slice().forEach((f) => f()); },
    eval(code) { return vm.runInContext(code, context); },
    timerDisplay() {
      return document.getElementById('timer-minutes').textContent
        + document.getElementById('timer-seconds').textContent;
    },
    pausedHint() {
      return methodTimer.querySelector('.timer-paused-hint');
    }
  };
  return h;
}

function loadTimer(h, extra = '') {
  const ctx = h.context;
  ctx.timerEndTime = null;
  ctx.timerInterval = null;
  ctx.timerRemainingSeconds = 0;
  ctx.timerTotalSeconds = 0;
  ctx.completedMethods = { timer: false, completeTodo: false, typePhrase: false, typeReason: false, mathProblem: false, password: false };
  ctx._methodStatusCalls = [];
  ctx._unblockReadyCalls = 0;
  ctx.updateMethodStatus = (m, s, done) => ctx._methodStatusCalls.push([m, s, done]);
  ctx.checkUnblockReady = () => { ctx._unblockReadyCalls += 1; };
  h.eval(timerSlice + extra);
  h.eval('isPageVisible = !document.hidden && document.hasFocus();');
  return ctx;
}

{
  const h = makeHarness();
  const ctx = loadTimer(h);

  ctx.startTimer(1);
  assert.equal(h.timerDisplay(), '0001', 'fresh 1s timer should display 00:01');

  h.runUntil(999);
  assert.equal(ctx.completedMethods.timer, false, 'timer must not complete before 1000ms');
  assert.equal(h.timerDisplay(), '0001');

  h.runUntil(1000);
  assert.equal(ctx.completedMethods.timer, true, 'timer must complete at 1000ms');
  assert.equal(h.timerDisplay(), '0000');
  assert.equal(ctx._unblockReadyCalls, 1, 'readiness checked exactly once');

  ctx.timerTick();
  ctx.timerTick();
  assert.equal(ctx._unblockReadyCalls, 1, 'repeated ticks must not re-enable unblock');
}

{
  const h = makeHarness();
  const ctx = loadTimer(h);

  ctx.startTimer(3);
  h.setNow(2500);
  h.fire(h.pendingTimers()[0]);
  assert.ok(Math.abs(ctx.timerRemainingSeconds - 0.5) < 1e-9, 'remaining should be ~0.5s after a 2.5s stall');
  assert.equal(h.timerDisplay(), '0001', 'fractional remainder displays as 1s (ceil)');

  let completedAt = null;
  const origReady = ctx.checkUnblockReady;
  ctx.checkUnblockReady = () => { completedAt = h.now(); origReady(); };
  h.runUntil(3000);
  assert.equal(completedAt, 3000, 'timer completes at the deadline, not after N delivered callbacks');
}

{
  const h = makeHarness();
  const ctx = loadTimer(h);

  ctx.startTimer(1);
  h.runUntil(350);
  h.setNow(400);

  h.fireWindow('blur');
  h.document.hidden = true;
  h.document._focused = false;
  h.fireDocument('visibilitychange');
  assert.ok(Math.abs(ctx.timerRemainingSeconds - 0.6) < 1e-9, 'blur at 400ms leaves 0.6s remaining');

  h.runUntil(10000);
  assert.equal(ctx.completedMethods.timer, false, 'no countdown credit while unfocused');
  assert.ok(Math.abs(ctx.timerRemainingSeconds - 0.6) < 1e-9, 'hidden time must not count down');

  h.document.hidden = false;
  h.document._focused = true;
  h.fireWindow('focus');
  h.fireDocument('visibilitychange');
  assert.ok(Math.abs(ctx.timerRemainingSeconds - 0.6) < 1e-9, 'resume must keep the frozen 0.6s');

  h.runUntil(10599);
  assert.equal(ctx.completedMethods.timer, false, 'still incomplete at 10599ms');
  h.runUntil(10600);
  assert.equal(ctx.completedMethods.timer, true, 'completes 600ms after refocus');
}

{
  const h = makeHarness({ hidden: true, focused: false });
  const ctx = loadTimer(h);

  h.document.hidden = false;
  h.document._focused = true;

  ctx.startTimer(1);
  h.runUntil(1000);
  assert.equal(ctx.completedMethods.timer, true, 'startTimer must use CURRENT focus, not the stale module value');
}

{
  const h = makeHarness({ hidden: true, focused: false });
  const ctx = loadTimer(h);

  ctx.startTimer(5);
  assert.ok(h.pausedHint(), 'paused hint should be shown when the page starts hidden');
  assert.equal(h.pendingTimers().length, 0, 'no timeout should run while hidden');

  h.document.hidden = false;
  h.document._focused = true;
  h.fireWindow('focus');
  h.runUntil(4999);
  assert.equal(ctx.completedMethods.timer, false, 'hidden start must still owe the full duration');
  h.runUntil(5000);
  assert.equal(ctx.completedMethods.timer, true, 'full configured duration counts after becoming active');
}

{
  const h = makeHarness();
  const ctx = loadTimer(h);

  ctx.startTimer(10);
  h.runUntil(3000);
  ctx.startTimer(2);
  assert.equal(h.pendingTimers().length, 1, 'restart must leave exactly one scheduled callback');

  let completedAt = null;
  const origReady = ctx.checkUnblockReady;
  ctx.checkUnblockReady = () => { completedAt = h.now(); origReady(); };
  h.runUntil(5000);
  assert.equal(completedAt, 5000, 'restarted timer completes 2s after restart');
  assert.equal((h.documentListeners.visibilitychange || []).length, 0, 'visibility listener removed on completion');
  assert.equal((h.windowListeners.blur || []).length, 0, 'blur listener removed on completion');
  assert.equal((h.windowListeners.focus || []).length, 0, 'focus listener removed on completion');
}

{
  const h = makeHarness();
  const ctx = loadTimer(h);
  assert.equal(ctx.getTimerDurationSeconds({ unit: 'seconds', value: 1 }), 1);
  assert.equal(ctx.getTimerDurationSeconds({ unit: 'minutes', value: 2 }), 120);
  assert.equal(ctx.getTimerDurationSeconds({ minutes: 3 }), 180);
  assert.equal(ctx.getTimerDurationSeconds({}), 300, 'fallback stays at the legacy 5 minutes');
}

{
  const build = (requireAll) => {
    const h = makeHarness();
    const ctx = loadTimer(h, readinessSlice);
    ctx.unblockEnabled = false;
    ctx.settings = {
      requireAllMethods: requireAll,
      unblockMethods: {
        timer: { enabled: true },
        completeTodo: { enabled: false },
        typePhrase: { enabled: true, phrase: 'x' },
        typeReason: { enabled: false },
        mathProblem: { enabled: false },
        password: { enabled: false }
      }
    };
    h.document.getElementById('unblock-button').disabled = true;
    return { h, ctx };
  };

  {
    const { h, ctx } = build(true);
    ctx.startTimer(1);
    h.runUntil(1000);
    assert.equal(ctx.completedMethods.timer, true);
    assert.equal(h.document.getElementById('unblock-button').disabled, true,
      'require-all mode: timer alone must not enable unblock while phrase is incomplete');
    assert.equal(h.window.location.href, '', 'timer completion must never auto-navigate');
  }

  {
    const { h, ctx } = build(false);
    ctx.startTimer(1);
    h.runUntil(1000);
    assert.equal(h.document.getElementById('unblock-button').disabled, false,
      'any-method mode: completing the timer enables unblock');
    assert.equal(h.window.location.href, '', 'enabling unblock must not auto-navigate');
  }
}

function makeSetupHarness() {
  const h = makeHarness();
  const ctx = loadTimer(h);
  ctx.earnedTimeInfo = null;
  ctx.completeTodoProgress = null;
  ctx._calls = [];
  for (const fn of ['showNuclearModeActive', 'showDailyLimitExceeded', 'showInsufficientEarnedTime',
    'showDailyTaskGoalLocked', 'showScheduleLocked', 'updateCompleteTodoUI']) {
    ctx[fn] = async (...a) => { ctx._calls.push([fn, ...a]); };
  }
  ctx.generateMathProblem = () => {};
  ctx.generateRandomPhrase = () => {};
  ctx.isInAllowedTimeWindow = () => true;
  ctx._startTimerCalls = [];
  ctx.startTimer = (s) => ctx._startTimerCalls.push(s);
  ctx._sent = [];
  const responses = {
    GET_NUCLEAR_STATUS: { active: false },
    GET_DAILY_USAGE: { enabled: true, exceeded: false },
    GET_EARNED_TIME: { enabled: false },
    GET_COMPLETE_TODO_PROGRESS: { satisfied: true, completedCount: 3, requiredCount: 3 }
  };
  ctx._respond = (type, value) => { responses[type] = value; };
  ctx.chrome = {
    runtime: {
      sendMessage(msg) {
        return new Promise((resolve) => {
          ctx._sent.push({ type: msg.type, resolve: () => resolve(responses[msg.type]) });
        });
      }
    }
  };
  h.eval(setupSlice);
  return { h, ctx };
}

const baseSettings = () => ({
  requireAllMethods: false,
  allowUnlimitedTime: false,
  schedule: { enabled: false },
  unblockMethods: {
    timer: { enabled: true, unit: 'minutes', value: 1 },
    completeTodo: { enabled: false, mode: 'single' },
    typePhrase: { enabled: false },
    typeReason: { enabled: false },
    mathProblem: { enabled: false },
    password: { enabled: false }
  }
});

const tick = () => new Promise((r) => setImmediate(r));

async function flushMicro(times = 5) {
  for (let i = 0; i < times; i++) await tick();
}

{
  const { ctx } = makeSetupHarness();
  ctx.settings = baseSettings();
  const p = ctx.setupUnblockMethods();
  await flushMicro();
  const sentTypes = ctx._sent.map((m) => m.type);
  assert.deepEqual(
    sentTypes,
    ['GET_NUCLEAR_STATUS', 'GET_DAILY_USAGE', 'GET_EARNED_TIME'],
    'all three gate checks must be requested concurrently, not serially awaited'
  );

  ctx._sent[0].resolve();
  ctx._sent[1].resolve();
  await flushMicro();
  assert.equal(ctx._startTimerCalls.length, 0, 'timer must not start while a gate is still pending');
  ctx._sent[2].resolve();
  await p;
  assert.deepEqual(ctx._startTimerCalls, [60], 'timer starts once all gates clear');
}

{
  const { ctx } = makeSetupHarness();
  ctx.settings = baseSettings();
  ctx._respond('GET_NUCLEAR_STATUS', { active: true, endsAt: 123 });
  const p = ctx.setupUnblockMethods();
  await flushMicro();
  ctx._sent.forEach((m) => m.resolve());
  await p;
  assert.ok(ctx._calls.some(([f]) => f === 'showNuclearModeActive'), 'nuclear mode still blocks');
  assert.equal(ctx._startTimerCalls.length, 0, 'timer must not start under nuclear mode');
}

{
  const { ctx } = makeSetupHarness();
  ctx.settings = baseSettings();
  ctx._respond('GET_DAILY_USAGE', { enabled: true, exceeded: true });
  const p = ctx.setupUnblockMethods();
  await flushMicro();
  ctx._sent.forEach((m) => m.resolve());
  await p;
  assert.ok(ctx._calls.some(([f]) => f === 'showDailyLimitExceeded'), 'daily limit still blocks');
  assert.equal(ctx._startTimerCalls.length, 0);
}

{
  const { ctx } = makeSetupHarness();
  ctx.settings = baseSettings();
  ctx._respond('GET_EARNED_TIME', { enabled: true, requireTasksToUnlock: true, minutes: 0 });
  const p = ctx.setupUnblockMethods();
  await flushMicro();
  ctx._sent.forEach((m) => m.resolve());
  await p;
  assert.ok(ctx._calls.some(([f]) => f === 'showInsufficientEarnedTime'), 'earned-time gate still blocks');
  assert.equal(ctx._startTimerCalls.length, 0);
  assert.equal(ctx.earnedTimeInfo.minutes, 0, 'earnedTimeInfo assignment preserved');
}

{
  const { ctx } = makeSetupHarness();
  ctx.settings = baseSettings();
  ctx.settings.unblockMethods.completeTodo = { enabled: true, mode: 'daily', requiredCount: 3 };
  ctx._respond('GET_COMPLETE_TODO_PROGRESS', { satisfied: false, completedCount: 1, requiredCount: 3 });
  const p = ctx.setupUnblockMethods();
  await flushMicro();
  ctx._sent.forEach((m) => m.resolve());
  await flushMicro();
  ctx._sent.forEach((m) => m.resolve());
  await p;
  assert.ok(ctx._calls.some(([f]) => f === 'showDailyTaskGoalLocked'), 'daily task goal lock still applies');
  assert.equal(ctx._startTimerCalls.length, 0);
}

{
  const { ctx } = makeSetupHarness();
  ctx.settings = baseSettings();
  ctx.settings.schedule = { enabled: true };
  ctx.isInAllowedTimeWindow = () => false;
  const p = ctx.setupUnblockMethods();
  await flushMicro();
  ctx._sent.forEach((m) => m.resolve());
  await p;
  assert.ok(ctx._calls.some(([f]) => f === 'showScheduleLocked'), 'schedule lock still applies');
  assert.equal(ctx._startTimerCalls.length, 0);
}

function makeClickHarness(sendMessage) {
  const h = makeHarness();
  const ctx = h.context;
  ctx.settings = { unblockMethods: { typeReason: { enabled: false } } };
  ctx.completedMethods = { typeReason: false };
  ctx.currentReason = '';
  ctx.blockedDomain = 'x.example';
  ctx.getSelectedTimeLimit = () => 30;
  ctx.getBlockedPageTargetUrl = () => 'https://x.example/';
  ctx._shown = [];
  for (const fn of ['showDailyLimitExceeded', 'showNuclearModeActive', 'showInsufficientEarnedTime']) {
    ctx[fn] = async () => { ctx._shown.push(fn); };
  }
  ctx.chrome = { runtime: { sendMessage } };
  ctx.unblockButton = h.document.getElementById('unblock-button');
  h.eval(navigateSlice + '\n' + clickSlice);
  return { h, ctx };
}

{
  const deferreds = [];
  const { h, ctx } = makeClickHarness((msg) => new Promise((r) => deferreds.push({ msg, r })));
  const clickPromise = ctx.unblockButton.listeners.click[0]();
  await flushMicro();
  assert.equal(deferreds.length, 1, 'TEMPORARY_UNBLOCK should be sent');
  assert.equal(h.window.location.href, '', 'must not navigate while unblock request is pending');
  const timeoutsBefore = h.pendingTimers().length;
  deferreds[0].r({ success: true });
  await clickPromise;
  assert.equal(h.window.location.href, 'https://x.example/', 'success navigates to the blocked URL');
  assert.equal(h.pendingTimers().length, timeoutsBefore, 'success path must not wait on a fixed timeout');
}

for (const [label, result] of [
  ['generic error', { success: false, error: 'nope' }],
  ['undefined result', undefined]
]) {
  const { h, ctx } = makeClickHarness(async () => result);
  await ctx.unblockButton.listeners.click[0]();
  assert.equal(h.window.location.href, '', `${label}: must not navigate on failure`);
  assert.equal(ctx.unblockButton.dataset.navigating, 'false', `${label}: button restored`);
  assert.equal(ctx.unblockButton.textContent, 'Continue to Site', `${label}: button label restored`);
}

{
  const { h, ctx } = makeClickHarness(async () => { throw new Error('sendMessage failed'); });
  await ctx.unblockButton.listeners.click[0]();
  assert.equal(h.window.location.href, '', 'rejection: must not navigate');
  assert.equal(ctx.unblockButton.dataset.navigating, 'false', 'rejection: button restored');
}

{
  const { h, ctx } = makeClickHarness(async () => ({ error: 'daily_limit_exceeded' }));
  await ctx.unblockButton.listeners.click[0]();
  assert.deepEqual(ctx._shown, ['showDailyLimitExceeded'], 'daily limit branch still renders');
  assert.equal(h.window.location.href, '', 'daily limit branch must not navigate');
  assert.equal(ctx.unblockButton.dataset.navigating, 'false');
}

{
  const { h, ctx } = makeClickHarness(async () => ({ error: 'insufficient_earned_time' }));
  await ctx.unblockButton.listeners.click[0]();
  assert.deepEqual(ctx._shown, ['showInsufficientEarnedTime'], 'earned-time branch still renders');
  assert.equal(h.window.location.href, '', 'earned-time branch must not navigate');
  assert.equal(ctx.unblockButton.dataset.navigating, 'false');
}

{
  const { h, ctx } = makeClickHarness((msg) => Promise.resolve(
    msg.type === 'GET_NUCLEAR_STATUS' ? { active: true } : { error: 'nuclear_mode_active' }
  ));
  await ctx.unblockButton.listeners.click[0]();
  assert.deepEqual(ctx._shown, ['showNuclearModeActive'], 'nuclear branch still renders');
  assert.equal(h.window.location.href, '', 'nuclear branch must not navigate');
  assert.equal(ctx.unblockButton.dataset.navigating, 'false');
}

{
  const sent = [];
  const { h, ctx } = makeClickHarness(async (msg) => {
    sent.push(msg);
    if (msg.type === 'TEMPORARY_UNBLOCK') return { success: true };
    if (msg.type === 'BLOCKED_PAGE_NAVIGATE') return { success: true };
    return {};
  });
  h.window.top = {};
  h.window.location.search = '?embedded=1';
  await ctx.unblockButton.listeners.click[0]();
  const nav = sent.find((m) => m.type === 'BLOCKED_PAGE_NAVIGATE');
  assert.ok(nav, 'embedded continue must go through the runtime bridge');
  assert.equal(nav.type, 'BLOCKED_PAGE_NAVIGATE');
  assert.equal(nav.action, 'continue');
  assert.equal(nav.url, 'https://x.example/');
  assert.equal(h.window.location.href, '', 'embedded continue must never navigate the iframe itself');
  assert.equal(ctx.unblockButton.dataset.navigating, 'true', 'embedded continue keeps the button held');
}

{
  const { h, ctx } = makeClickHarness(async (msg) => (
    msg.type === 'TEMPORARY_UNBLOCK' ? { success: true } : { success: false }
  ));
  h.window.top = {};
  h.window.location.search = '?embedded=1';
  await assert.rejects(() => ctx.continueToBlockedTarget('https://x.example/'),
    /Unable to continue/, 'a false bridge result surfaces as a rejection');
  await ctx.unblockButton.listeners.click[0]();
  assert.equal(h.window.location.href, '', 'a refused bridge continue must not navigate the iframe');
  assert.equal(ctx.unblockButton.dataset.navigating, 'false', 'button restored after bridge refusal');
}

console.log('blocked timer tests passed');
