import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const backgroundSource = fs.readFileSync(new URL('./background.js', import.meta.url), 'utf8');
const contentSource = fs.readFileSync(new URL('./content-redirect.js', import.meta.url), 'utf8');

function slice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start > 0 && end > start, `could not locate slice ${startMarker}`);
  return source.slice(start, end);
}


const decisionSlice = [
  slice(backgroundSource, 'function extractDomain', '/**\n * Check if current time is within'),
  slice(backgroundSource, 'function isInAllowedTimeWindow', 'function normalizeCompleteTodoSettings'),
  slice(backgroundSource, 'async function isOnFocusBreak', 'async function shouldBlockUrl'),
  slice(backgroundSource, 'async function shouldBlockUrl', '/**\n * Handle tab activation')
].join('\n');

function makeDecisionHarness({
  settings = {},
  tempUnblocks = {},
  onFocusBreak = false,
  continueAck = true,
  goBackCalls = [],
  sentToTabs = []
} = {}) {
  const store = { tempUnblocks };
  if (onFocusBreak) {
    store.focusSession = { active: true, phase: 'break', endTime: Date.now() + 60000 };
  }

  class FixedDate extends Date {
    constructor(...args) {
      if (args.length === 0) {
        super(2025, 0, 15, 12, 0, 0);
      } else {
        super(...args);
      }
    }
    static now() { return new Date(2025, 0, 15, 12, 0, 0).getTime(); }
  }

  const context = vm.createContext({
    console: { log() {}, error() {}, warn() {}, debug() {} },
    URL,
    Date: FixedDate,
    TEMP_UNBLOCK_ALL_KEY: '__all__',
    getSettings: async () => ({
      enabled: true,
      mode: 'blocklist',
      blockedSites: [],
      categories: [],
      allowedSites: [],
      allowedUrls: [],
      blockedKeywords: { enabled: false, keywords: [] },
      schedule: { enabled: false },
      ...settings
    }),
    chrome: {
      runtime: { id: 'ext-id', getURL: (p) => `chrome-extension://ext-id/${p}` },
      storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, o) } },
      tabs: {
        goBack: async (tabId) => goBackCalls.push(tabId),
        sendMessage: async (tabId, message, options) => {
          sentToTabs.push({ tabId, message, options });
          return { success: continueAck };
        },
        query: async () => []
      },
      scripting: { executeScript: async () => {} }
    }
  });

  vm.runInContext(decisionSlice, context);
  return { context, store, goBackCalls, sentToTabs };
}

const blocklist = (overrides = {}) => ({ mode: 'blocklist', ...overrides });
const FIXED_NOW = new Date(2025, 0, 15, 12, 0, 0).getTime();

{
  const { context } = makeDecisionHarness({ settings: blocklist({ blockedSites: ['x.example'] }) });
  assert.equal(await context.shouldBlockUrl('https://x.example/'), true, 'blocked domain blocks');
  assert.equal(await context.shouldBlockUrl('https://sub.x.example/path'), true, 'subdomain of blocked domain blocks');
  assert.equal(await context.shouldBlockUrl('https://notx.example/'), false, 'lookalike domain does not block');
  assert.equal(await context.shouldBlockUrl('https://ok.example/'), false, 'unrelated domain does not block');
}

{
  const { context } = makeDecisionHarness({
    settings: blocklist({ categories: [{ enabled: true, sites: ['cat.example'] }, { enabled: false, sites: ['off.example'] }] })
  });
  assert.equal(await context.shouldBlockUrl('https://cat.example/'), true, 'enabled category site blocks');
  assert.equal(await context.shouldBlockUrl('https://off.example/'), false, 'disabled category site does not block');
}

{
  const { context } = makeDecisionHarness({
    settings: { mode: 'allowlist', allowedSites: ['ok.example'] }
  });
  assert.equal(await context.shouldBlockUrl('https://ok.example/'), false, 'allowlist member allowed');
  assert.equal(await context.shouldBlockUrl('https://sub.ok.example/'), false, 'allowlist subdomain allowed');
  assert.equal(await context.shouldBlockUrl('https://other.example/'), true, 'non-allowlist domain blocks in allowlist mode');
}

{
  const { context } = makeDecisionHarness({
    settings: blocklist({
      blockedKeywords: {
        enabled: true,
        keywords: [
          { keyword: 'casino', caseSensitive: false },
          { keyword: 'CaseWord', caseSensitive: true },
          { keyword: 'a.b', caseSensitive: false }
        ]
      }
    })
  });
  assert.equal(await context.shouldBlockUrl('https://a.example/Casino-nights'), true, 'case-insensitive keyword matches');
  assert.equal(await context.shouldBlockUrl('https://a.example/xCaseWordy'), true, 'case-sensitive keyword matches exactly');
  assert.equal(await context.shouldBlockUrl('https://a.example/caseword'), false, 'case-sensitive keyword rejects wrong case');
  assert.equal(await context.shouldBlockUrl('https://a.example/path?aXb=1'), false, 'keyword a.b must not act as a regex');
  assert.equal(await context.shouldBlockUrl('https://a.example/rta.b=1'), true, 'keyword a.b matches literally');
}

{
  const { context } = makeDecisionHarness({
    settings: blocklist({
      blockedSites: ['x.example'],
      blockedKeywords: { enabled: false, keywords: [{ keyword: 'casino' }] }
    })
  });
  assert.equal(await context.shouldBlockUrl('https://a.example/casino'), false, 'disabled keyword blocking is inert');
}

{
  const { context } = makeDecisionHarness({
    settings: blocklist({ blockedSites: ['x.example'], allowedUrls: ['https://x.example/allowed/page'] })
  });
  assert.equal(await context.shouldBlockUrl('https://x.example/allowed/page'), false, 'whitelisted URL allowed on blocked domain');
  assert.equal(await context.shouldBlockUrl('https://x.example/allowed/page/sub'), false, 'whitelisted URL prefix covers children');
  assert.equal(await context.shouldBlockUrl('https://x.example/other'), true, 'non-whitelisted URL still blocks');
}

{
  const now = FIXED_NOW;
  const { context } = makeDecisionHarness({
    settings: blocklist({ blockedSites: ['x.example', 'parent.example', 'all.example'] })
  });
  await context.chrome.storage.local.set({ tempUnblocks: { 'x.example': now + 60000 } });
  assert.equal(await context.shouldBlockUrl('https://x.example/'), false, 'live temp unblock allows');
  await context.chrome.storage.local.set({ tempUnblocks: { 'x.example': now - 1000 } });
  assert.equal(await context.shouldBlockUrl('https://x.example/'), true, 'expired temp unblock blocks again');
  await context.chrome.storage.local.set({ tempUnblocks: { 'parent.example': now + 60000 } });
  assert.equal(await context.shouldBlockUrl('https://deep.sub.parent.example/'), false, 'parent unblock covers subdomains');
  await context.chrome.storage.local.set({ tempUnblocks: { '__all__': now + 60000 } });
  assert.equal(await context.shouldBlockUrl('https://x.example/'), false, 'global unblock covers everything');
}

{
  const now = FIXED_NOW;
  const { context } = makeDecisionHarness({
    settings: blocklist({
      blockedSites: ['x.example', 'other.example'],
      unblockAllBlockedSites: true
    }),
    tempUnblocks: { 'other.example': now + 60000 }
  });
  assert.equal(await context.shouldBlockUrl('https://x.example/'), false,
    'shared unblock still allows blocked domains when unblockAllBlockedSites is on');
}

{
  const fixedDay = new Date(FIXED_NOW).getDay();
  const { context } = makeDecisionHarness({
    settings: blocklist({
      blockedSites: ['x.example'],
      schedule: { enabled: true, activeDays: [fixedDay], allowedTimes: [{ start: '09:00', end: '11:00' }] }
    }),
    tempUnblocks: { 'x.example': FIXED_NOW + 60000 }
  });
  assert.equal(await context.shouldBlockUrl('https://x.example/'), true,
    'schedule-disallowed unblocks must not bypass blocking');
}

{
  const { context } = makeDecisionHarness({
    settings: blocklist({ blockedSites: ['x.example'] }),
    onFocusBreak: true
  });
  assert.equal(await context.shouldBlockUrl('https://x.example/'), false, 'focus break releases all sites');
}

{
  const { context } = makeDecisionHarness({ settings: blocklist({ blockedSites: ['x.example'] }) });
  for (const url of ['chrome://extensions', 'about:blank', 'ftp://x.example/', 'chrome-extension://ext-id/blocked/blocked.html', '', null]) {
    assert.equal(await context.shouldBlockUrl(url), false, `non-http(s) URL never blocks: ${url}`);
  }
}

{
  const { context } = makeDecisionHarness({ settings: blocklist({ blockedSites: ['x.example'], enabled: false }) });
  assert.equal(await context.shouldBlockUrl('https://x.example/'), false,
    'a disabled extension blocks nothing');
}


const blockedPageUrl = 'chrome-extension://ext-id/blocked/blocked.html';
const embedSender = (overrides = {}) => ({
  id: 'ext-id',
  frameId: 3,
  url: `${blockedPageUrl}?url=${encodeURIComponent('https://x.example/')}&embedded=1&reason=navigation&renderId=r1`,
  tab: { id: 7, url: 'https://x.example/' },
  ...overrides
});

{
  const { context, goBackCalls } = makeDecisionHarness({ settings: blocklist() });
  const nav = (message, sender) => context.navigateFromBlockedPage(message, sender);

  assert.equal((await nav({ action: 'back' }, embedSender({ id: 'evil-ext' }))).success, false,
    'foreign extension sender rejected');
  assert.equal((await nav({ action: 'back' }, embedSender({ frameId: 0 }))).success, false,
    'top frame sender rejected - only the embedded frame may ask');
  assert.equal((await nav({ action: 'back' }, embedSender({ url: 'https://x.example/?embedded=1' }))).success, false,
    'non-extension sender URL rejected');
  assert.equal((await nav({ action: 'back' }, embedSender({
    url: `https://ext-id/blocked/blocked.html?url=${encodeURIComponent('https://x.example/')}&embedded=1`
  }))).success, false, 'sender protocol mismatch rejected even though origin is null');
  assert.equal((await nav({ action: 'back' }, embedSender({
    url: `chrome-extension://other-id/blocked/blocked.html?url=${encodeURIComponent('https://x.example/')}&embedded=1`
  }))).success, false, 'sender host mismatch rejected even though origin is null');
  assert.equal((await nav({ action: 'back' }, embedSender({
    url: `chrome-extension://ext-id/blocked/fake.html?url=${encodeURIComponent('https://x.example/')}&embedded=1`
  }))).success, false, 'sender path mismatch rejected');
  assert.equal((await nav({ action: 'back' }, embedSender({
    url: `${blockedPageUrl}?url=${encodeURIComponent('https://x.example/')}`
  }))).success, false, 'missing embedded=1 rejected');
  assert.equal((await nav({ action: 'back' }, embedSender({
    url: `${blockedPageUrl}?url=${encodeURIComponent('https://other.example/')}&embedded=1`
  }))).success, false, 'url query not matching the real tab URL rejected');
  assert.equal((await nav({ action: 'teleport' }, embedSender())).success, false, 'unknown action rejected');
  assert.equal(goBackCalls.length, 0, 'no navigation happened for rejected senders');
}

{
  const { context, goBackCalls } = makeDecisionHarness({ settings: blocklist() });
  const result = await context.navigateFromBlockedPage({ action: 'back' }, embedSender());
  assert.equal(result.success, true, 'valid back request succeeds');
  assert.deepEqual(goBackCalls, [7], 'back goes through chrome.tabs.goBack on the sender tab');
}

{
  const { context, sentToTabs } = makeDecisionHarness({ settings: blocklist() });
  const ok = await context.navigateFromBlockedPage(
    { action: 'continue', url: 'https://x.example/path' },
    embedSender()
  );
  assert.equal(ok.success, true, 'continue to an unblocked URL succeeds');
  assert.equal(sentToTabs.length, 1);
  assert.equal(sentToTabs[0].tabId, 7);
  assert.equal(sentToTabs[0].options.frameId, 0, 'continue goes to the top frame only');
  assert.equal(sentToTabs[0].message.type, 'CONTINUE_BLOCKED_PAGE');
  assert.equal(sentToTabs[0].message.url, 'https://x.example/path');
  assert.equal(sentToTabs[0].message.blockedUrl, 'https://x.example/', 'continue carries the blocked top URL');
}

{
  const { context, sentToTabs } = makeDecisionHarness({ settings: blocklist(), continueAck: false });
  const refused = await context.navigateFromBlockedPage(
    { action: 'continue', url: 'https://x.example/path' },
    embedSender()
  );
  assert.equal(refused.success, false, 'a false ACK from the handler means failure');
  assert.equal(sentToTabs.length, 1, 'the continue message was still sent to the top frame');
}

{
  const { context, sentToTabs } = makeDecisionHarness({ settings: blocklist() });
  const ready = await context.navigateFromBlockedPage({ action: 'ready' }, embedSender());
  assert.equal(ready.success, true, 'ready relay returns the top frame ACK');
  assert.equal(sentToTabs.length, 1);
  assert.equal(sentToTabs[0].tabId, 7);
  assert.equal(sentToTabs[0].options.frameId, 0, 'ready is relayed to the top frame only');
  assert.equal(sentToTabs[0].message.type, 'BLOCKED_PAGE_READY');
  assert.equal(sentToTabs[0].message.blockedUrl, 'https://x.example/');
  assert.equal(sentToTabs[0].message.renderId, 'r1', 'ready relays the frame render id');
}

{
  const { context, sentToTabs } = makeDecisionHarness({ settings: blocklist(), continueAck: false });
  const notReady = await context.navigateFromBlockedPage({ action: 'ready' }, embedSender());
  assert.equal(notReady.success, false, 'a false ready ACK is reported as failure');
  assert.equal(sentToTabs.length, 1);
}

{
  const { context, sentToTabs } = makeDecisionHarness({ settings: blocklist() });
  await context.navigateFromBlockedPage({ action: 'ready' }, embedSender({ id: 'evil-ext' }));
  await context.navigateFromBlockedPage({ action: 'ready' }, embedSender({ frameId: 0 }));
  await context.navigateFromBlockedPage({ action: 'ready' }, embedSender({
    url: `chrome-extension://other-id/blocked/blocked.html?url=${encodeURIComponent('https://x.example/')}&embedded=1`
  }));
  await context.navigateFromBlockedPage({ action: 'ready' }, embedSender({
    url: `${blockedPageUrl}?url=${encodeURIComponent('https://other.example/')}&embedded=1`
  }));
  assert.equal(sentToTabs.length, 0, 'unauthenticated ready signals are never forwarded');
}

{
  const { context, sentToTabs } = makeDecisionHarness({
    settings: blocklist({ blockedSites: ['x.example'] })
  });
  const stillBlocked = await context.navigateFromBlockedPage(
    { action: 'continue', url: 'https://x.example/' },
    embedSender()
  );
  assert.equal(stillBlocked.success, false, 'continue to a still-blocked URL is refused');
  const badScheme = await context.navigateFromBlockedPage(
    { action: 'continue', url: 'javascript:alert(1)' },
    embedSender()
  );
  assert.equal(badScheme.success, false, 'continue to a non-http URL is refused');
  assert.equal(sentToTabs.length, 0, 'no continue message was dispatched');
}


const contentSlice = [
  slice(contentSource, 'function normalizeDomain', 'function isDomainMatch'),
  slice(contentSource, 'let evaluationInFlight', 'const EMBED_SOURCE_SELECTORS'),
  slice(contentSource, 'function shouldSkipEmbeddedMediaHandling', 'function parseCandidateUrl'),
  slice(contentSource, 'async function trackBlockedEmbeddedAttempt', 'function createBlockedEmbedFrame'),
  slice(contentSource, 'function stopInvalidatedContentScript', 'function pauseBlockedPageMedia'),
  slice(contentSource, 'function lockBlockedPageScroll', 'const originalPushState'),
  slice(contentSource, "chrome.runtime.onMessage.addListener", 'startEmbedObserver();')
].join('\n');

function makeStyle() {
  const props = new Map();
  const SHORTHANDS = {
    overflow: ['overflow-x', 'overflow-y'],
    'overscroll-behavior': ['overscroll-behavior-x', 'overscroll-behavior-y']
  };
  const expand = (name, value, priority) => {
    const longhands = SHORTHANDS[name];
    if (longhands) {
      const parts = String(value).trim().split(/\s+/);
      longhands.forEach((longhand, i) => props.set(longhand, { value: parts[i] || parts[0], priority }));
    } else {
      props.set(name, { value: String(value).trim(), priority });
    }
  };
  const parse = (text) => {
    props.clear();
    for (const declaration of String(text || '').split(';')) {
      const trimmed = declaration.trim();
      if (!trimmed) continue;
      const colon = trimmed.indexOf(':');
      if (colon < 0) continue;
      const name = trimmed.slice(0, colon).trim();
      let value = trimmed.slice(colon + 1).trim();
      let priority = '';
      const important = value.match(/!important\s*$/i);
      if (important) {
        priority = 'important';
        value = value.slice(0, important.index).trim();
      }
      expand(name, value, priority);
    }
  };
  return {
    get cssText() {
      return [...props.entries()]
        .map(([name, { value, priority }]) => `${name}: ${value}${priority ? ' !important' : ''};`)
        .join(' ');
    },
    set cssText(text) { parse(text); },
    getPropertyValue(name) { return props.get(name)?.value || ''; },
    getPropertyPriority(name) { return props.get(name)?.priority || ''; },
    setProperty(name, value, priority = '') { expand(name, value, priority || ''); },
    removeProperty(name) { props.delete(name); }
  };
}

function makeFakeElement(tagName = 'div') {
  const el = {
    tagName: tagName.toUpperCase(),
    children: [],
    parentNode: null,
    attrs: {},
    listeners: {},
    style: makeStyle(),
    scrollLeft: 0,
    scrollTop: 0,
    scrollTo(options) {
      this.scrollLeft = options.left ?? this.scrollLeft;
      this.scrollTop = options.top ?? this.scrollTop;
      this._lastScrollTo = options;
    },
    tabIndex: 0,
    autofocus: false,
    _focusCalls: 0,
    setAttribute(k, v) { this.attrs[k] = v; if (k === 'open') this.open = true; },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    remove() {
      if (this.parentNode) {
        const i = this.parentNode.children.indexOf(this);
        if (i >= 0) this.parentNode.children.splice(i, 1);
        this.parentNode = null;
      }
    },
    replaceChildren(...nodes) {
      for (const child of this.children) child.parentNode = null;
      this.children = nodes;
      for (const child of nodes) child.parentNode = this;
    },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    attachShadow() {
      this.shadow = makeFakeElement('shadow-root');
      this.shadow.parentNode = this;
      return this.shadow;
    },
    focus() { this._focusCalls += 1; },
    get isConnected() {
      let node = this;
      while (node.parentNode) node = node.parentNode;
      return node.isDocumentRoot === true;
    }
  };
  if (tagName === 'dialog') {
    el.open = false;
    el._modalCalls = 0;
    el._closeCalls = 0;
    el.showModal = function() { this._modalCalls += 1; this.open = true; };
    el.close = function() {
      this._closeCalls += 1;
      this.open = false;
      (this.listeners.close || []).forEach((f) => f({ target: this }));
    };
  }
  return el;
}

function makeContentHarness({ shouldBlock, runtimeId = 'ext-id', storageGet, sendMessageImpl, cryptoImpl, noBody = false } = {}) {
  const createdIframes = [];
  const createdDialogs = [];
  const replacedUrls = [];
  const hrefAssigns = [];
  const sentMessages = [];
  const storageCalls = [];
  const errorLog = [];
  const observers = [];
  const docListeners = {};
  let messageListener = null;
  let now = 0;
  let nextTimerId = 1;
  const timers = new Map();
  let uuidCounter = 0;
  let liveRuntimeId = runtimeId;

  const fakeSetTimeout = (fn, ms) => {
    const id = nextTimerId++;
    timers.set(id, { fn, at: now + ms });
    return id;
  };
  const fakeClearTimeout = (id) => { timers.delete(id); };

  const documentElement = makeFakeElement('html');
  const head = makeFakeElement('head');
  const body = noBody ? null : makeFakeElement('body');
  head.parentNode = documentElement;
  if (body) body.parentNode = documentElement;
  documentElement.children = noBody ? [head] : [head, body];

  const documentObj = {
    isDocumentRoot: true,
    documentElement,
    hidden: false,
    readyState: 'complete',
    hasFocus: () => true,
    get body() { return documentElement.children.find((c) => c.tagName === 'BODY') || null; },
    get scrollingElement() { return documentElement; },
    createElement(tag) {
      const el = makeFakeElement(tag);
      if (tag === 'iframe') createdIframes.push(el);
      if (tag === 'dialog') createdDialogs.push(el);
      return el;
    },
    querySelectorAll: () => [],
    addEventListener(type, fn) { (docListeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) {
      const list = docListeners[type] || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    }
  };
  documentElement.parentNode = documentObj;

  const windowObj = {
    scrollX: 0,
    scrollY: 0,
    _scrollToCalls: [],
    scrollTo(options) {
      this._scrollToCalls.push(options);
      this.scrollX = options.left ?? this.scrollX;
      this.scrollY = options.top ?? this.scrollY;
    },
    location: {
      _href: 'https://x.example/',
      get href() { return this._href; },
      set href(value) { this._href = value; hrefAssigns.push(value); },
      hostname: 'x.example',
      replace(url) { replacedUrls.push(url); },
      reload() { windowObj._reloads += 1; }
    },
    _reloads: 0,
    _stopped: 0,
    stop() { windowObj._stopped += 1; },
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    addEventListener() {}
  };
  windowObj.top = windowObj;

  const context = vm.createContext({
    console: { log() {}, error(...args) { errorLog.push(args); }, warn() {}, debug() {} },
    URL, URLSearchParams,
    crypto: cryptoImpl || { randomUUID: () => `render-${++uuidCounter}` },
    document: documentObj,
    window: windowObj,
    globalThis: {},
    queueMicrotask,
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    MutationObserver: class {
      constructor(fn) { this.fn = fn; this._disconnects = 0; observers.push(this); }
      observe() {}
      disconnect() { this._disconnects += 1; }
    },
    HTMLMediaElement: class {},
    history: {},
    maybeBlockEmbeddedContent: async () => {},
    showFocusBrowserNotification: () => {},
    chrome: {
      runtime: {
        get id() { return liveRuntimeId; },
        getURL: (p) => `chrome-extension://ext-id/${p}`,
        sendMessage(message) {
          sentMessages.push(message);
          if (sendMessageImpl) return sendMessageImpl(message);
          if (message.type === 'SHOULD_BLOCK_URL') {
            if (typeof shouldBlock === 'function') {
              return Promise.resolve().then(() => shouldBlock(message.url));
            }
            return Promise.resolve(shouldBlock === true);
          }
          if (message.type === 'GET_SETTINGS') {
            return Promise.resolve({ enabled: true, historyAnalysisEnabled: false });
          }
          if (message.type === 'IS_ON_FOCUS_BREAK') {
            return Promise.resolve(false);
          }
          return Promise.resolve(null);
        },
        onMessage: { addListener(fn) { messageListener = fn; } }
      },
      storage: {
        local: {
          get(key) { storageCalls.push(key); return storageGet ? storageGet(key) : Promise.resolve({}); }
        },
        onChanged: { addListener() {} }
      }
    }
  });

  vm.runInContext(contentSlice, context);

  return {
    context,
    window: windowObj,
    document: documentObj,
    documentElement,
    head,
    body,
    createdIframes,
    createdDialogs,
    replacedUrls,
    sentMessages,
    storageCalls,
    errorLog,
    hrefAssigns,
    observers,
    docListeners,
    setRuntimeId(value) { liveRuntimeId = value; },
    blockerHost() {
      const marker = 'data-focus-extension-blocked-page';
      const inBody = (documentObj.body?.children || []).find((c) => c.attrs[marker]);
      return inBody || documentElement.children.find((c) => c.attrs[marker]);
    },
    blockerDialog() { return this.blockerHost()?.shadow?.children.find((c) => c.tagName === 'DIALOG'); },
    loadingLayer() { return this.blockerDialog()?.children.find((c) => c.tagName === 'DIV'); },
    loadingStatus() { return this.loadingLayer()?.children.find((c) => c.attrs.role === 'status'); },
    advanceTime(ms) {
      now += ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        due[1].fn();
      }
    },
    pendingTimers: () => timers.size,
    fireEvent(el, type, props = {}) {
      const event = { target: el, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...props };
      (el.listeners[type] || []).forEach((f) => f(event));
      return event;
    },
    fireObservers() { observers.forEach((o) => o.fn([])); },
    emitMessage(message, sender) {
      let ack;
      let acked = false;
      const returned = messageListener(message, sender || { id: 'ext-id' }, (value) => { acked = true; ack = value; });
      return { returned, ack, acked };
    }
  };
}

const flushMicro = async (times = 10) => { for (let i = 0; i < times; i += 1) await new Promise((r) => setImmediate(r)); };

const snapshotDom = (h) => JSON.stringify({
  rootAttrs: h.documentElement.attrs,
  rootCss: h.documentElement.style.cssText,
  headAttrs: h.head.attrs,
  headCss: h.head.style.cssText,
  bodyAttrs: h.body.attrs,
  bodyCss: h.body.style.cssText,
  bodyChildren: h.body.children.map((c) => c.tagName)
});

{
  const h = makeContentHarness({ shouldBlock: true });
  h.documentElement.setAttribute('data-theme', 'dark');
  h.documentElement.style.cssText = 'opacity: 0.5; transform: scale(0.9);';
  h.body.setAttribute('class', 'app-shell');
  h.body.style.cssText = 'margin: 8px;';
  const pageNode = makeFakeElement('main');
  h.body.appendChild(pageNode);
  const before = snapshotDom(h);

  await h.context.evaluateCurrentUrl();

  assert.equal(h.createdIframes.length, 1, 'blocked URL mounts the blocked-page iframe');
  assert.equal(h.createdDialogs.length, 1, 'blocked URL mounts a dialog');
  assert.equal(h.createdDialogs[0]._modalCalls, 1, 'dialog opens via showModal exactly once');
  const frameUrl = new URL(h.createdIframes[0].src);
  assert.equal(frameUrl.pathname, '/blocked/blocked.html', 'iframe loads the extension blocked page');
  assert.equal(frameUrl.searchParams.get('embedded'), '1');
  assert.equal(frameUrl.searchParams.get('url'), 'https://x.example/');
  assert.ok(frameUrl.searchParams.get('renderId'), 'iframe carries a render id');
  assert.equal(h.createdIframes[0].tabIndex, -1, 'iframe stays out of tab order while loading');
  assert.equal(h.window._stopped, 0, 'the page is never stopped');
  assert.equal(h.body.children.filter((c) => c.attrs['data-focus-extension-blocked-page']).length, 1,
    'only the overlay host is appended');
  assert.equal(h.body.children[0], pageNode, 'original page children stay first and untouched');
  assert.equal(pageNode.parentNode, h.body, 'original node identity preserved');
  const after = JSON.parse(snapshotDom(h));
  const lockedLonghands = ['overflow-x', 'overflow-y', 'overscroll-behavior-x', 'overscroll-behavior-y'];
  for (const key of ['rootAttrs', 'headAttrs', 'headCss', 'bodyAttrs']) {
    assert.deepEqual(after[key], JSON.parse(before)[key], `page ${key} untouched`);
  }
  assert.deepEqual(after.bodyChildren, ['MAIN', 'DIV'], 'existing DOM preserved, only the host appended');
  for (const [cssKey, original] of [['rootCss', JSON.parse(before).rootCss], ['bodyCss', JSON.parse(before).bodyCss]]) {
    const style = makeStyle();
    style.cssText = after[cssKey];
    for (const longhand of lockedLonghands) {
      style.removeProperty(longhand);
    }
    assert.equal(style.cssText, original, `only the scroll-lock longhands differ on ${cssKey}`);
  }
  assert.equal(h.replacedUrls.length, 0, 'mounting the blocker never navigates the tab');
  assert.equal(h.hrefAssigns.length, 0, 'the top URL is never reassigned');

  const loading = h.loadingLayer();
  assert.ok(loading, 'a visible loading surface sits inside the dialog');
  assert.ok(h.loadingStatus(), 'loading layer announces status');
  const retryButton = loading.children.find((c) => c.tagName === 'BUTTON');
  assert.ok(retryButton, 'loading layer offers a retry button');

  const cancel = h.fireEvent(h.blockerDialog(), 'cancel');
  assert.equal(cancel.defaultPrevented, true, 'native cancel cannot dismiss the overlay');
  assert.equal(h.blockerDialog().open, true, 'overlay stays open after cancel');
}

{
  const h = makeContentHarness({ shouldBlock: true });
  await h.context.evaluateCurrentUrl();
  const ready = h.emitMessage({ type: 'BLOCKED_PAGE_READY', blockedUrl: 'https://x.example/', renderId: 'render-1' });
  assert.equal(ready.ack.success, true, 'ready for the live render is ACKed');
  assert.equal(h.loadingLayer(), undefined, 'ready removes the loading layer');
  assert.equal(h.createdIframes[0].tabIndex, 0, 'iframe becomes focusable once ready');
  assert.equal(h.createdIframes[0]._focusCalls, 1, 'iframe is focused on ready');
  const again = h.emitMessage({ type: 'BLOCKED_PAGE_READY', blockedUrl: 'https://x.example/', renderId: 'render-1' });
  assert.equal(again.ack.success, true, 'repeated ready stays a success ACK');
  assert.equal(h.createdIframes[0]._focusCalls, 1, 'repeated ready does not refocus');
  h.advanceTime(10000);
  assert.equal(h.replacedUrls.length, 0, 'ready cancels the loading timeout with no navigation');
}

{
  const h = makeContentHarness({ shouldBlock: true });
  await h.context.evaluateCurrentUrl();
  const firstRenderId = new URL(h.createdIframes[0].src).searchParams.get('renderId');

  h.emitMessage({ type: 'REEVALUATE_BLOCKING' });
  await flushMicro();
  assert.equal(h.createdIframes.length, 1, 'same-URL reevaluation mounts no second frame');
  assert.equal(h.createdDialogs.length, 1);
  assert.equal(new URL(h.createdIframes[0].src).searchParams.get('renderId'), firstRenderId,
    'same-URL reevaluation keeps the live render');
}

{
  let decision = true;
  const h = makeContentHarness({ shouldBlock: () => decision });
  await h.context.evaluateCurrentUrl();
  assert.equal(h.createdDialogs.length, 1, 'site is blocked');

  decision = { error: 'worker unavailable' };
  h.emitMessage({ type: 'REEVALUATE_BLOCKING' });
  await flushMicro();
  assert.equal(h.createdDialogs.length, 1, 'an error verdict keeps the mounted overlay');
  assert.equal(h.window._reloads, 0);

  decision = undefined;
  h.emitMessage({ type: 'REEVALUATE_BLOCKING' });
  await flushMicro();
  assert.equal(h.createdDialogs.length, 1, 'an empty verdict keeps the mounted overlay');
  assert.equal(h.window._reloads, 0);
}

{
  const h = makeContentHarness({ shouldBlock: () => { throw new Error('worker exploded'); } });
  await h.context.evaluateCurrentUrl();
  const first = h.createdDialogs.length;
  h.emitMessage({ type: 'REEVALUATE_BLOCKING' });
  await flushMicro();
  assert.equal(h.createdDialogs.length, first, 'a rejected check must not remount or tear down');
  assert.equal(h.window._reloads, 0);
}

{
  const h = makeContentHarness({ shouldBlock: () => ({ error: 'boom' }) });
  await h.context.evaluateCurrentUrl();
  assert.equal(h.createdDialogs.length, 0, 'a truthy error object must not count as a block verdict');
  assert.ok(!h.sentMessages.some((m) => m.type === 'GET_SETTINGS'), 'no settings fetch after a non-boolean verdict');
}

{
  const h = makeContentHarness({ shouldBlock: (url) => url.includes('blocked.example') });
  h.window.location.href = 'https://blocked.example/';
  h.window.location.hostname = 'blocked.example';
  const evaluation = h.context.evaluateCurrentUrl();
  h.window.location.href = 'https://allowed.example/';
  h.window.location.hostname = 'allowed.example';
  await evaluation;
  await flushMicro();
  assert.equal(h.createdDialogs.length, 0, 'stale block verdict is not applied to the new URL');
}

{
  let decision = true;
  const h = makeContentHarness({ shouldBlock: () => decision });
  await h.context.evaluateCurrentUrl();
  assert.equal(h.createdDialogs.length, 1);
  assert.equal((h.docListeners.play || []).length, 1, 'media guard listens while blocked');

  decision = false;
  h.emitMessage({ type: 'REEVALUATE_BLOCKING' });
  await flushMicro();
  assert.equal(h.blockerHost(), undefined, 'allowed verdict removes the overlay');
  assert.equal(h.createdDialogs[0].open, false, 'dialog is closed on release');
  assert.equal((h.docListeners.play || []).length, 0, 'media guard listener is removed on release');
  assert.equal(h.window._reloads, 0, 'release never reloads the page');
  assert.equal(h.replacedUrls.length, 0, 'release never navigates');
  assert.equal(h.body.children.filter((c) => c.attrs['data-focus-extension-blocked-page']).length, 0,
    'no overlay remnants stay in the page');

  decision = true;
  h.emitMessage({ type: 'REEVALUATE_BLOCKING' });
  await flushMicro();
  assert.equal(h.createdDialogs.length, 2, 'reblocking mounts a fresh overlay on the preserved page');
  assert.equal(h.createdDialogs[1]._modalCalls, 1);
  assert.equal(h.window._reloads, 0);
}

{
  const h = makeContentHarness({ shouldBlock: true });
  await h.context.evaluateCurrentUrl();

  const foreign = h.emitMessage({ type: 'CONTINUE_BLOCKED_PAGE', url: 'https://x.example/', blockedUrl: 'https://x.example/' }, { id: 'other-extension' });
  assert.equal(foreign.returned, false, 'foreign sender ignored');
  assert.equal(foreign.acked, false, 'foreign sender gets no ACK');
  assert.equal(h.createdDialogs[0].open, true);

  const noBlockedUrl = h.emitMessage({ type: 'CONTINUE_BLOCKED_PAGE', url: 'https://x.example/' });
  assert.equal(noBlockedUrl.ack.success, false, 'missing blockedUrl rejected');
  assert.equal(h.createdDialogs[0].open, true);

  const badScheme = h.emitMessage({ type: 'CONTINUE_BLOCKED_PAGE', url: 'javascript:alert(1)', blockedUrl: 'https://x.example/' });
  assert.equal(badScheme.ack.success, false, 'non-http continue ignored');

  const same = h.emitMessage({ type: 'CONTINUE_BLOCKED_PAGE', url: 'https://x.example/', blockedUrl: 'https://x.example/' });
  assert.equal(same.ack.success, true, 'same-URL continue is ACKed');
  assert.equal(h.blockerHost(), undefined, 'same-URL continue lifts the overlay');
  assert.equal(h.replacedUrls.length, 0, 'same-URL continue performs no navigation');
  assert.equal(h.window._reloads, 0, 'same-URL continue performs no reload');
}

{
  const h = makeContentHarness({ shouldBlock: true });
  await h.context.evaluateCurrentUrl();
  const other = h.emitMessage({ type: 'CONTINUE_BLOCKED_PAGE', url: 'https://other.example/', blockedUrl: 'https://x.example/' });
  assert.equal(other.ack.success, true);
  assert.equal(h.blockerHost(), undefined, 'overlay removed before navigating');
  assert.deepEqual(h.replacedUrls, ['https://other.example/'], 'a different continue target replaces once');
}

{
  const h = makeContentHarness({ shouldBlock: () => true });
  await h.context.evaluateCurrentUrl();
  assert.equal(h.createdDialogs.length, 1);

  h.window.location._href = 'https://x.example/other';
  h.emitMessage({ type: 'REEVALUATE_BLOCKING' });
  await flushMicro();
  assert.equal(h.createdDialogs.length, 2, 'SPA navigation to another blocked URL rebuilds the overlay');
  assert.equal(h.window._reloads, 0, 'no reload on SPA change');
  assert.equal(h.replacedUrls.length, 0);
  assert.equal(new URL(h.createdIframes[1].src).searchParams.get('url'), 'https://x.example/other',
    'new overlay targets the live URL');
}

{
  const h = makeContentHarness({ shouldBlock: true });
  h.window.location._href = 'https://x.example/path?q=1#frag';
  await h.context.evaluateCurrentUrl();
  assert.equal(new URL(h.createdIframes[0].src).searchParams.get('url'), 'https://x.example/path?q=1#frag',
    'iframe preserves the full original URL including query and hash');
}

{
  const h = makeContentHarness({ shouldBlock: true });
  await h.context.evaluateCurrentUrl();
  const statusText = h.loadingStatus().textContent;
  h.fireEvent(h.createdIframes[0], 'load');
  h.advanceTime(2999);
  assert.equal(h.loadingStatus().textContent, statusText, 'iframe load alone does not mark ready');
  h.advanceTime(1);
  assert.equal(h.loadingStatus().textContent, 'The focus screen is taking longer to load. Try again.',
    'timeout only updates the inline status');
  h.advanceTime(10000);
  assert.equal(h.replacedUrls.length, 0, 'no automatic navigation after the timeout');
  assert.equal(h.window._reloads, 0);
  assert.equal(h.blockerDialog().open, true, 'overlay stays up after the timeout');

  const retry = h.loadingLayer().children.find((c) => c.tagName === 'BUTTON');
  h.fireEvent(retry, 'click');
  assert.equal(h.createdDialogs.length, 2, 'manual retry mounts a fresh dialog');
  assert.equal(h.createdDialogs[0].open, false, 'the stale dialog is closed');
  assert.equal(h.replacedUrls.length, 0, 'retry never navigates the page');
  const newRenderId = new URL(h.createdIframes[1].src).searchParams.get('renderId');
  assert.notEqual(newRenderId, new URL(h.createdIframes[0].src).searchParams.get('renderId'),
    'retry gets a fresh render id');

  const stale = h.emitMessage({ type: 'BLOCKED_PAGE_READY', blockedUrl: 'https://x.example/', renderId: 'render-1' });
  assert.equal(stale.ack.success, false, 'a stale render id cannot reveal the new frame');
  assert.ok(h.loadingLayer(), 'loading still visible after stale ready');
  const fresh = h.emitMessage({ type: 'BLOCKED_PAGE_READY', blockedUrl: 'https://x.example/', renderId: newRenderId });
  assert.equal(fresh.ack.success, true, 'ready for the live render id succeeds');
  assert.equal(h.loadingLayer(), undefined);
}

{
  const h = makeContentHarness({ shouldBlock: true });
  await h.context.evaluateCurrentUrl();
  const wrongUrl = h.emitMessage({ type: 'BLOCKED_PAGE_READY', blockedUrl: 'https://other.example/', renderId: 'render-1' });
  assert.equal(wrongUrl.ack.success, false, 'ready for a different URL is rejected');
  const wrongRender = h.emitMessage({ type: 'BLOCKED_PAGE_READY', blockedUrl: 'https://x.example/', renderId: 'bogus' });
  assert.equal(wrongRender.ack.success, false, 'ready for a different render is rejected');
  const foreign = h.emitMessage({ type: 'BLOCKED_PAGE_READY', blockedUrl: 'https://x.example/', renderId: 'render-1' }, { id: 'other-ext' });
  assert.equal(foreign.acked, false, 'foreign ready gets no ACK');
  assert.ok(h.loadingLayer(), 'loading remains until authenticated ready');
  h.advanceTime(3000);
  assert.equal(h.blockerDialog().open, true, 'overlay survives unauthenticated ready signals');
}

{
  const h = makeContentHarness({ shouldBlock: true });
  await h.context.evaluateCurrentUrl();
  h.window.location._href = 'https://x.example/elsewhere';
  h.advanceTime(10000);
  assert.equal(h.replacedUrls.length, 0, 'a changed top URL disables the loading timeout');
}

{
  const h = makeContentHarness({ shouldBlock: true });
  await h.context.evaluateCurrentUrl();

  const injected = makeFakeElement('div');
  h.body.appendChild(injected);
  h.fireObservers();
  assert.equal(injected.parentNode, h.body, 'page-added nodes are left alone by the observer');
  assert.equal(h.blockerDialog().open, true, 'overlay unaffected by ordinary page mutations');

  const newBody = makeFakeElement('body');
  const survivingNode = makeFakeElement('section');
  newBody.appendChild(survivingNode);
  h.documentElement.replaceChildren(h.head, newBody);
  h.fireObservers();
  assert.equal(h.blockerHost()?.parentNode, newBody, 'a detached overlay is recreated in the page new body');
  assert.equal(h.createdDialogs.length, 2, 'recovery mounts a fresh dialog');
  assert.equal(h.window._reloads, 0, 'recovery never reloads');
  assert.equal(h.replacedUrls.length, 0, 'recovery never redirects');
  assert.equal(survivingNode.parentNode, newBody, 'page-provided body contents survive recovery');
}

{
  const h = makeContentHarness({ shouldBlock: false });
  await h.context.evaluateCurrentUrl();
  assert.equal(h.createdDialogs.length, 0, 'allowed URL mounts nothing');
  assert.ok(h.sentMessages.some((m) => m.type === 'SHOULD_BLOCK_URL'), 'the authoritative check is consulted');
}

{
  const h = makeContentHarness({ shouldBlock: true, runtimeId: null });
  await h.context.evaluateCurrentUrl();
  assert.equal(h.sentMessages.length, 0, 'an invalidated context makes no runtime calls');
  assert.equal(h.pendingTimers(), 0, 'an invalidated context schedules nothing');
  assert.equal(h.createdDialogs.length, 0, 'an invalidated context mounts nothing');
  h.emitMessage({ type: 'REEVALUATE_BLOCKING' });
  await flushMicro();
  assert.equal(h.sentMessages.length, 0, 'late nudges stay inert after invalidation');
}

{
  const h = makeContentHarness({
    shouldBlock: true,
    storageGet: () => Promise.reject(new Error('Extension context invalidated.'))
  });
  h.context.startEmbedObserver();
  assert.equal(h.observers.length, 1, 'embed observer starts while the context is alive');

  h.context.scheduleEmbedScan();
  h.advanceTime(60);
  await flushMicro();
  assert.equal(h.storageCalls.length, 1, 'the in-flight scan attempted exactly one storage read');
  assert.equal(h.errorLog.length, 0, 'context invalidation is not logged as an error');
  assert.equal(h.observers[0]._disconnects, 1, 'invalidation disconnects the embed observer');

  const sentAtStop = h.sentMessages.length;
  h.fireObservers();
  h.emitMessage({ type: 'REEVALUATE_BLOCKING' });
  h.context.scheduleEmbedScan();
  h.advanceTime(10000);
  await flushMicro();
  assert.equal(h.sentMessages.length, sentAtStop, 'no further extension calls after invalidation');
  assert.equal(h.storageCalls.length, 1, 'no further storage reads after invalidation');
  assert.equal(h.pendingTimers(), 0, 'no timers survive invalidation');
}

{
  const pageNode = makeFakeElement('main');
  const h = makeContentHarness({ shouldBlock: true });
  h.body.appendChild(pageNode);
  await h.context.evaluateCurrentUrl();
  assert.equal(h.createdDialogs.length, 1, 'overlay mounts before invalidation');

  h.setRuntimeId(null);
  await h.context.evaluateCurrentUrl();
  assert.equal(h.blockerHost(), undefined, 'invalidation removes the stale overlay');
  assert.deepEqual(h.body.children, [pageNode], 'page DOM is preserved through invalidation cleanup');
  assert.equal(h.window._reloads, 0);
  assert.equal(h.replacedUrls.length, 0);
  assert.equal(h.errorLog.length, 0, 'invalidation cleanup stays quiet');
}

{
  const h = makeContentHarness({
    shouldBlock: true,
    storageGet: () => Promise.reject(new Error('storage failure'))
  });
  h.context.scheduleEmbedScan();
  h.advanceTime(60);
  await flushMicro();
  assert.equal(h.errorLog.length, 1, 'unrelated scan failures are still logged');
  assert.equal(h.errorLog[0][0], 'Focus Extension: embedded content scan error');
  assert.equal(h.context.hasActiveExtensionContext(), true, 'unrelated failures do not stop the script');
}

{
  let resolveVerdict;
  const h = makeContentHarness({ shouldBlock: () => new Promise((r) => { resolveVerdict = r; }) });
  const evaluation = h.context.evaluateCurrentUrl();
  await flushMicro(3);
  h.setRuntimeId(null);
  resolveVerdict(true);
  await evaluation;
  await flushMicro();
  assert.equal(h.createdDialogs.length, 0, 'a verdict landing after invalidation mounts nothing');
  assert.equal(h.context.hasActiveExtensionContext(), false, 'the script marked itself stopped');
}

{
  const h = makeContentHarness({
    shouldBlock: true,
    cryptoImpl: {
      getRandomValues(arr) { arr.fill(0x2a); return arr; }
    }
  });
  await h.context.evaluateCurrentUrl();
  assert.equal(h.createdDialogs.length, 1, 'insecure-context crypto still mounts the overlay');
  const renderId = new URL(h.createdIframes[0].src).searchParams.get('renderId');
  assert.ok(renderId, 'fallback render id is nonempty');
  assert.equal(renderId, '2a-2a-2a-2a');
  const ready = h.emitMessage({ type: 'BLOCKED_PAGE_READY', blockedUrl: 'https://x.example/', renderId });
  assert.equal(ready.ack.success, true, 'ready matches the getRandomValues render id');
  assert.equal(h.errorLog.length, 0);
  assert.equal(h.replacedUrls.length, 0);
}

{
  const h = makeContentHarness({ shouldBlock: true, runtimeId: null });
  await h.context.trackBlockedEmbeddedAttempt('https://x.example/embed');
  assert.equal(h.sentMessages.length, 0, 'an invalidated context never reports embedded attempts');
}

{
  const blockedSource = fs.readFileSync(new URL('./blocked/blocked.js', import.meta.url), 'utf8');
  const notifySlice = slice(blockedSource, 'function isInPageBlocker', 'function getExactWhitelistTargetUrl');
  const makeReadyHarness = (embedded) => {
    const sent = [];
    const windowObj = { location: { search: embedded ? '?embedded=1' : '' } };
    windowObj.top = embedded ? {} : windowObj;
    const context = vm.createContext({
      window: windowObj,
      URLSearchParams,
      chrome: { runtime: { sendMessage: (m) => { sent.push(m); return Promise.resolve({ success: true }); } } }
    });
    vm.runInContext(notifySlice, context);
    return { context, sent };
  };

  const embedded = makeReadyHarness(true);
  embedded.context.notifyInPageBlockerReady();
  assert.deepEqual(
    embedded.sent.map((m) => ({ type: m.type, action: m.action })),
    [{ type: 'BLOCKED_PAGE_NAVIGATE', action: 'ready' }],
    'embedded blocked page announces readiness through the bridge'
  );

  const standalone = makeReadyHarness(false);
  standalone.context.notifyInPageBlockerReady();
  assert.equal(standalone.sent.length, 0, 'standalone blocked page sends no ready signal');
}

{
  const h = makeContentHarness({ shouldBlock: true });
  h.window.scrollY = 1200;
  h.documentElement.style.cssText = 'overflow-y: scroll !important; overflow-x: auto; transform: rotate(1deg); opacity: 0.9;';
  h.documentElement.scrollTop = 50;
  h.body.style.cssText = 'overflow: auto scroll; background: pink; padding: 4px;';
  h.body.scrollTop = 80;
  await h.context.evaluateCurrentUrl();

  for (const el of [h.documentElement, h.body]) {
    assert.equal(el.style.getPropertyValue('overflow-y'), 'hidden', `${el.tagName} overflow-y locked`);
    assert.equal(el.style.getPropertyValue('overflow-x'), 'hidden');
    assert.equal(el.style.getPropertyValue('overscroll-behavior-x'), 'none');
    assert.equal(el.style.getPropertyValue('overscroll-behavior-y'), 'none');
    assert.equal(el.style.getPropertyPriority('overflow-y'), 'important');
  }
  assert.equal(h.documentElement.style.getPropertyValue('transform'), 'rotate(1deg)', 'unrelated root styles untouched');
  assert.equal(h.documentElement.style.getPropertyValue('opacity'), '0.9');
  assert.equal(h.body.style.getPropertyValue('background'), 'pink');
  assert.equal(h.body.style.getPropertyValue('padding'), '4px');
  assert.equal(h.window._stopped, 0);
  assert.equal(h.window._scrollToCalls.length, 0, 'mounting does not move the page scroll');
}

{
  let decision = true;
  const h = makeContentHarness({ shouldBlock: () => decision });
  h.window.scrollY = 1200;
  h.documentElement.style.cssText = 'overflow-y: scroll !important; overflow-x: auto;';
  h.documentElement.scrollTop = 50;
  h.body.style.cssText = 'overflow: auto scroll; background: pink;';
  h.body.scrollTop = 80;
  await h.context.evaluateCurrentUrl();
  h.documentElement.style.setProperty('color', 'red');
  h.window.scrollY = 0;
  h.documentElement.scrollTop = 0;
  h.body.scrollTop = 0;

  decision = false;
  h.emitMessage({ type: 'REEVALUATE_BLOCKING' });
  await flushMicro();

  assert.equal(h.documentElement.style.getPropertyValue('overflow-y'), 'scroll', 'original overflow-y restored');
  assert.equal(h.documentElement.style.getPropertyPriority('overflow-y'), 'important', 'original priority restored');
  assert.equal(h.documentElement.style.getPropertyValue('overflow-x'), 'auto');
  assert.equal(h.documentElement.style.getPropertyValue('overscroll-behavior-x'), '', 'absent properties are removed, not left locked');
  assert.equal(h.body.style.getPropertyValue('overflow-x'), 'auto', 'shorthand longhand restored');
  assert.equal(h.body.style.getPropertyValue('overflow-y'), 'scroll');
  assert.equal(h.documentElement.style.getPropertyValue('color'), 'red', 'site style changes made while blocked survive');
  assert.equal(h.window._scrollToCalls.length, 1);
  assert.deepEqual(
    { left: h.window._scrollToCalls[0].left, top: h.window._scrollToCalls[0].top, behavior: h.window._scrollToCalls[0].behavior },
    { left: 0, top: 1200, behavior: 'instant' },
    'window scroll position restored instantly'
  );
  assert.equal(h.documentElement.scrollTop, 50, 'root scroll position restored');
  assert.equal(h.body.scrollTop, 80, 'nested scroll position restored');
  assert.equal(h.window._reloads, 0);
  assert.equal(h.replacedUrls.length, 0);
}

{
  let decision = true;
  const h = makeContentHarness({ shouldBlock: () => decision });
  h.documentElement.style.cssText = 'overflow-y: scroll;';
  await h.context.evaluateCurrentUrl();
  h.emitMessage({ type: 'REEVALUATE_BLOCKING' });
  await flushMicro();
  h.emitMessage({ type: 'BLOCKED_PAGE_READY', blockedUrl: 'https://x.example/', renderId: 'render-1' });
  decision = false;
  h.emitMessage({ type: 'REEVALUATE_BLOCKING' });
  await flushMicro();
  assert.equal(h.documentElement.style.getPropertyValue('overflow-y'), 'scroll',
    'repeated evaluations never recapture locked values as originals');

  decision = true;
  h.emitMessage({ type: 'REEVALUATE_BLOCKING' });
  await flushMicro();
  assert.equal(h.documentElement.style.getPropertyValue('overflow-y'), 'hidden', 'reblock locks again');
  decision = false;
  h.emitMessage({ type: 'REEVALUATE_BLOCKING' });
  await flushMicro();
  assert.equal(h.documentElement.style.getPropertyValue('overflow-y'), 'scroll', 'second release restores again');
}

{
  const h = makeContentHarness({ shouldBlock: true });
  h.window.scrollY = 700;
  h.documentElement.style.cssText = 'overflow-y: auto;';
  await h.context.evaluateCurrentUrl();
  const retry = h.loadingLayer().children.find((c) => c.tagName === 'BUTTON');
  h.fireEvent(retry, 'click');
  assert.equal(h.createdDialogs.length, 2, 'retry remounts the overlay');
  h.window.scrollY = 0;
  const cont = h.emitMessage({ type: 'CONTINUE_BLOCKED_PAGE', url: 'https://x.example/', blockedUrl: 'https://x.example/' });
  assert.equal(cont.ack.success, true);
  assert.equal(h.documentElement.style.getPropertyValue('overflow-y'), 'auto', 'retry then release restores originals');
  const lastScroll = h.window._scrollToCalls.at(-1);
  assert.deepEqual({ left: lastScroll.left, top: lastScroll.top, behavior: lastScroll.behavior },
    { left: 0, top: 700, behavior: 'instant' });
}

{
  const h = makeContentHarness({ shouldBlock: true, noBody: true });
  await h.context.evaluateCurrentUrl();
  assert.equal(h.blockerHost()?.parentNode, h.documentElement, 'host attaches to the root when body is missing');

  const lateBody = makeFakeElement('body');
  lateBody.style.cssText = 'overflow-y: scroll; padding: 2px;';
  h.documentElement.appendChild(lateBody);
  h.fireObservers();
  assert.equal(lateBody.style.getPropertyValue('overflow-y'), 'hidden', 'a late body gets locked by the observer');
  assert.equal(lateBody.style.getPropertyValue('padding'), '2px');

  const cont = h.emitMessage({ type: 'CONTINUE_BLOCKED_PAGE', url: 'https://x.example/', blockedUrl: 'https://x.example/' });
  assert.equal(cont.ack.success, true);
  assert.equal(lateBody.style.getPropertyValue('overflow-y'), 'scroll', 'late body scroll restored on release');
  assert.equal(h.documentElement.style.getPropertyValue('overflow-y'), '', 'untouched root stays untouched');
}

{
  const h = makeContentHarness({ shouldBlock: true });
  h.documentElement.style.cssText = 'overflow-y: scroll;';
  await h.context.evaluateCurrentUrl();
  h.setRuntimeId(null);
  await h.context.evaluateCurrentUrl();
  assert.equal(h.blockerHost(), undefined, 'invalidation removes the overlay');
  assert.equal(h.documentElement.style.getPropertyValue('overflow-y'), 'scroll', 'invalidation restores page scrolling');
}

{
  const h = makeContentHarness({ shouldBlock: true });
  h.window.scrollY = 900;
  await h.context.evaluateCurrentUrl();
  h.window.location._href = 'https://x.example/new';
  h.window.scrollY = 10;
  h.emitMessage({ type: 'REEVALUATE_BLOCKING' });
  await flushMicro();
  assert.equal(h.window._scrollToCalls.length, 0, 'a same-document URL change does not jump old coordinates');
}

{
  const h = makeContentHarness({ shouldBlock: true });
  h.documentElement.style.cssText = 'overflow-y: scroll; overflow-x: hidden;';
  await h.context.evaluateCurrentUrl();
  h.documentElement.style.setProperty('overflow-x', 'auto', 'important');
  const cont = h.emitMessage({ type: 'CONTINUE_BLOCKED_PAGE', url: 'https://x.example/', blockedUrl: 'https://x.example/' });
  assert.equal(cont.ack.success, true);
  assert.equal(h.documentElement.style.getPropertyValue('overflow-x'), 'auto',
    'a property the site retook while blocked is not overwritten');
  assert.equal(h.documentElement.style.getPropertyValue('overflow-y'), 'scroll', 'other owned properties still restore');
}

{
  const css = fs.readFileSync(new URL('./blocked/blocked.css', import.meta.url), 'utf8');
  const htmlRule = css.match(/html\s*\{[^}]*\}/);
  assert.ok(htmlRule, 'blocked.css gains an html rule');
  assert.match(htmlRule[0], /overflow-y:\s*auto/, 'blocked page keeps its own vertical scrollbar');
  assert.match(htmlRule[0], /overscroll-behavior:\s*none/, 'blocked page contains boundary scrolling');
  assert.doesNotMatch(htmlRule[0], /overflow(-x|-y)?:\s*hidden/, 'blocked UI must not hide its own scroll');
  const bodyRule = css.match(/(?:^|\n)body\s*\{[^}]*\}/);
  assert.match(bodyRule[0], /overscroll-behavior:\s*none/, 'blocked body contains overscroll');
  assert.doesNotMatch(bodyRule[0], /overflow(-x|-y)?:\s*hidden/, 'blocked body still scrolls naturally');
  const layoutRule = css.match(/\.layout\s*\{[^}]*\}/);
  assert.match(layoutRule[0], /minmax\(0, 1\.5fr\)/, 'existing layout sizing untouched');
  const source = fs.readFileSync(new URL('./content-redirect.js', import.meta.url), 'utf8');
  const dialogStyle = source.match(/dialog\.style\.cssText = '[^']*'/);
  assert.match(dialogStyle[0], /overflow: hidden; overscroll-behavior: none/, 'dialog shell confines overscroll');
  const loadingStyle = source.match(/loading\.style\.cssText = '[^']*'/);
  assert.match(loadingStyle[0], /overflow-y: auto/, 'loading surface can scroll on tiny viewports');
  assert.doesNotMatch(source, /addEventListener\('(wheel|scroll|touchmove)'/, 'no listener suppresses page scrolling');
}

console.log('in-page blocking tests passed');
