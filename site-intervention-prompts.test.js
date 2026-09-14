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

const interventionSlice = [
  sliceBetween('const SITE_INTERVENTION_ALARM', 'function normalizeBlockedPageSettings'),
  sliceBetween('function normalizeTrackedDomain', 'function isTempUnblockActive'),
  sliceBetween('function ensureSiteInterventionDomainState', 'function buildSiteInterventionNotificationId'),
  sliceBetween('function buildSiteInterventionNotificationId', 'async function sendSiteInterventionPrompt'),
  sliceBetween('async function sendSiteInterventionPrompt', 'async function runSiteInterventionCheck')
].join('\n');

const NOW = Date.now();
const MINUTE = 60 * 1000;

function makeHarness({
  settings = {},
  categoryContext = { category: 'socialMedia', source: 'built-in', confidence: 1 },
  focusSession = { active: false },
  onFocusBreak = false,
  whitelisted = false
} = {}) {
  const notifications = [];
  const calls = [];

  const context = vm.createContext({
    console: { log() {}, error() {}, warn() {}, debug() {} },
    getSiteCategoryOverrides: async () => ({}),
    getSiteCategorySuggestions: async () => ({}),
    getFocusSession: async () => focusSession,
    isOnFocusBreak: async () => onFocusBreak,
    isUrlWhitelistedWithSettings: () => whitelisted,
    doesDomainMatchAny: (domain, domains = []) =>
      domains.includes(domain) || domains.some((d) => domain.endsWith(`.${d}`)),
    extractDomain: (d) => (d || '').replace(/^www\./, ''),
    wouldBlockDomain: (domain, s) => (s.blockedSites || []).includes(domain),
    addBlockedSite: async (d) => calls.push(['addBlockedSite', d]),
    updateBlockingRules: async () => calls.push(['updateBlockingRules']),
    redirectMatchingDomainTabsIfNeeded: async (domains, reason) => calls.push(['redirectMatchingDomainTabsIfNeeded', domains, reason]),
    startFocusSession: async (t) => calls.push(['startFocusSession', t]),
    chrome: {
      notifications: {
        create: async (id, options) => { notifications.push({ id, options }); },
        clear: async () => {}
      }
    }
  });

  context.resolveSiteCategoryContext = () => categoryContext;

  vm.runInContext(interventionSlice, context);

  const settingsWithDefaults = {
    enabled: true,
    mode: 'blocklist',
    blockedSites: [],
    allowedSites: [],
    allowedUrls: [],
    ...settings
  };

  function makeTracking(domainStates = {}) {
    return { date: 'today', domains: domainStates, lastDomain: null, lastTimestamp: null };
  }

  function prompt(domain, { seconds = 31 * 60, visits = 1, tab = null, now = NOW, domainStates = {} } = {}) {
    const tracking = makeTracking(domainStates);
    const state = context.ensureSiteInterventionDomainState(tracking, domain);
    state.seconds = seconds;
    state.visits = visits;
    return context.maybePromptForSiteIntervention({
      domain,
      tab: tab || { url: `https://${domain}/`, title: domain },
      settings: settingsWithDefaults,
      tracking,
      now
    });
  }

  return { context, notifications, calls, prompt, settingsWithDefaults, makeTracking };
}


{
  const { context } = makeHarness();
  for (const domain of [
    'google.com', 'www.google.com', 'news.google.com', 'docs.google.com',
    'google.co.uk', 'google.com.au', 'mail.google.co.uk',
    'bing.com', 'www.bing.com', 'duckduckgo.com', 'search.yahoo.com',
    'search.brave.com', 'ecosia.org', 'www.ecosia.org', 'startpage.com'
  ]) {
    assert.equal(context.isSiteInterventionExcludedDomain(domain), true, `${domain} must be excluded`);
  }
  for (const domain of ['google.com.evil', 'notgoogle.com', 'googleplex.com', 'bing.com.evil', 'x.example']) {
    assert.equal(context.isSiteInterventionExcludedDomain(domain), false, `${domain} must not be excluded`);
  }
}

{
  const { prompt, notifications } = makeHarness({
    categoryContext: { category: 'entertainment', source: 'built-in', confidence: 1 }
  });
  for (const domain of ['google.com', 'www.google.com', 'news.google.com', 'google.co.uk', 'bing.com', 'duckduckgo.com']) {
    assert.equal(await prompt(domain), false, `${domain} must never prompt`);
  }
  assert.equal(notifications.length, 0);
}


{
  const { prompt, notifications } = makeHarness();
  assert.equal(await prompt('x.example', { seconds: 5 * 60, visits: 12 }), false,
    'visits alone must not trigger a prompt');
  assert.equal(notifications.length, 0);

  assert.equal(await prompt('x.example', { seconds: 31 * 60 }), true, '30+ minutes prompts');
  assert.equal(notifications.length, 1);
}

{
  const { context, prompt, notifications } = makeHarness();
  const domainStates = {};
  const tracking = context.ensureSiteInterventionDomainState({ domains: domainStates }, 'x.example');
  assert.equal(await prompt('x.example', { domainStates }), true);
  assert.equal(await prompt('x.example', { domainStates, now: NOW + 6 * 60 * MINUTE }), false,
    'same domain must not prompt twice in a day, even after the cooldown');
  assert.equal(notifications.length, 1);
}

{
  const { context, prompt, notifications } = makeHarness();
  const domainStates = {};
  context.ensureSiteInterventionDomainState({ domains: domainStates }, 'a.example');
  context.ensureSiteInterventionDomainState({ domains: domainStates }, 'b.example');
  context.ensureSiteInterventionDomainState({ domains: domainStates }, 'c.example');

  assert.equal(await prompt('a.example', { domainStates }), true);
  assert.equal(await prompt('b.example', { domainStates, now: NOW + MINUTE }), false,
    'a different domain is still inside the shared 4h cooldown');
  assert.equal(await prompt('b.example', { domainStates, now: NOW + 5 * 60 * MINUTE }), true,
    'a different domain prompts after the shared cooldown');
  assert.equal(await prompt('c.example', { domainStates, now: NOW + 10 * 60 * MINUTE }), false,
    'the global daily cap of two prompts is enforced');
  assert.equal(notifications.length, 2);
}


{
  const { prompt, notifications } = makeHarness({
    categoryContext: { category: 'socialMedia', source: 'content-scan', confidence: 0.9 }
  });
  assert.equal(await prompt('x.example'), false, 'content-scan suggestions must not prompt');

  const heuristic = makeHarness({
    categoryContext: { category: 'socialMedia', source: 'heuristic', confidence: 0.58 }
  });
  assert.equal(await heuristic.prompt('x.example'), false, 'heuristic suggestions must not prompt');

  const override = makeHarness({
    categoryContext: { category: 'socialMedia', source: 'override', confidence: 1 }
  });
  assert.equal(await override.prompt('x.example'), true, 'a manual override on a normal host still prompts');
}


{
  const { prompt } = makeHarness({ whitelisted: true });
  assert.equal(await prompt('x.example'), false, 'whitelisted URLs must never prompt');
}

{
  const { prompt } = makeHarness({ settings: { allowedSites: ['x.example'] } });
  assert.equal(await prompt('x.example'), false, 'allowedSites domains must never prompt');
}

{
  const { prompt } = makeHarness({ focusSession: { active: true } });
  assert.equal(await prompt('x.example'), false, 'no prompt during an active focus session');
}

{
  const { prompt } = makeHarness({ onFocusBreak: true });
  assert.equal(await prompt('x.example'), false, 'no prompt during a focus break');
}


{
  const { context, notifications } = makeHarness();
  await context.sendSiteInterventionPrompt({
    action: 'block',
    domain: 'x.example',
    categoryKey: 'socialMedia',
    entry: { seconds: 33 * 60, visits: 3 }
  });
  const n = notifications[0];
  assert.equal(n.options.priority, 0);
  assert.equal(n.options.requireInteraction, false, 'prompts must auto-dismiss');
  assert.equal(n.options.silent, true);
  assert.equal(n.options.title, 'Take a break from x.example?');
  assert.equal(n.options.message, "You've spent 33 minutes here today. Block this site for fewer distractions?");
  assert.deepEqual(Array.from(n.options.buttons, (b) => b.title), ['Block this site', 'Not today']);

  await context.sendSiteInterventionPrompt({
    action: 'focus',
    domain: 'docs.example',
    categoryKey: 'productivity',
    entry: { seconds: 40 * 60, visits: 2 }
  });
  const f = notifications[1];
  assert.equal(f.options.title, 'Focus on docs.example?');
  assert.equal(f.options.message, "You've spent 40 minutes here today. Start a focus session?");
  assert.deepEqual(Array.from(f.options.buttons, (b) => b.title), ['Start focus session', 'Not today']);
}


{
  const { context, calls, notifications } = makeHarness();
  await context.applySiteInterventionAction({ action: 'block', domain: 'x.example' });
  assert.deepEqual([...calls].map((c) => c[0]), ['addBlockedSite', 'updateBlockingRules', 'redirectMatchingDomainTabsIfNeeded'],
    'block button still adds the site and enforces it immediately');
  assert.equal(notifications.length, 0, 'no second feedback notification after blocking');

  calls.length = 0;
  await context.applySiteInterventionAction({ action: 'focus', domain: 'docs.example' });
  assert.deepEqual([...calls].map((c) => c[0]), ['startFocusSession'], 'focus action starts a session');
}

console.log('site intervention prompt tests passed');
