import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../blocked/blocked.js', import.meta.url), 'utf8');

// Scope to the DOMContentLoaded handler. The same helpers are awaited later in
// the task-completion flow, where blocking is exactly what you want.
const initStart = source.indexOf("addEventListener('DOMContentLoaded'");
const initEnd = source.indexOf('showInitializationFallback(error)', initStart);
assert.ok(initStart > 0 && initEnd > initStart, 'could not locate the init block');
const init = source.slice(initStart, initEnd);

// The wait timer starts inside setupUnblockMethods. Anything awaited before it
// silently extends the countdown, so a slow Todoist or usage round trip used to
// make the user wait longer than the setting says.
const setupAt = init.indexOf('await setupUnblockMethods()');
const progressAt = init.indexOf('loadCompleteTodoProgress()');
const dailyLimitAt = init.indexOf('updateDailyLimitInfoCard()');
const earnedTimeAt = init.indexOf('updateEarnedTimeInfoCard()');

assert.ok(setupAt > 0, 'setupUnblockMethods must still be awaited during init');
assert.ok(progressAt > 0, 'loadCompleteTodoProgress must still run');

assert.ok(
  setupAt < progressAt,
  'the wait timer must start before task progress is loaded, not after it'
);

assert.ok(
  setupAt < dailyLimitAt && setupAt < earnedTimeAt,
  'the wait timer must start before the info cards are fetched'
);

assert.doesNotMatch(
  init,
  /await updateDailyLimitInfoCard\(\)/,
  'the daily limit card must not block init — it only adds detail'
);

assert.doesNotMatch(
  init,
  /await updateEarnedTimeInfoCard\(\)/,
  'the earned time card must not block init — it only adds detail'
);

assert.doesNotMatch(
  init,
  /await loadCompleteTodoProgress\(\)/,
  'task progress must not block init; setupUnblockMethods fetches it on the one path that needs it'
);

// That one path: the daily task goal gate reads it, falling back to its own
// fetch when init has not filled it in yet.
assert.match(
  source,
  /completeTodoProgress = completeTodoProgress \|\| await chrome\.runtime\.sendMessage/,
  'setupUnblockMethods must still self-fetch task progress when it needs it'
);

// Background work must not be able to take the unblock flow down with it.
['updateDailyLimitInfoCard', 'updateEarnedTimeInfoCard', 'loadCompleteTodoProgress']
  .forEach((fn) => {
    assert.match(
      init,
      new RegExp(`${fn}\\(\\)[\\s\\S]{0,120}?\\.catch\\(`),
      `${fn} runs unawaited, so it must handle its own rejection`
    );
  });

assert.doesNotMatch(
  init,
  /await loadQuote\(\)/,
  'the quote must not block init — it only adds decoration'
);

assert.match(
  init,
  /loadQuote\(\)[\s\S]{0,120}?\.catch\(/,
  'loadQuote runs unawaited, so it must handle its own rejection'
);

const settingsAt = init.indexOf("settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' })");
const visibilityAt = init.indexOf('applyBlockedPageVisibility();');
const quoteAt = init.indexOf('loadQuote()');
assert.ok(settingsAt > 0 && visibilityAt > settingsAt, 'settings must be applied to page visibility during init');
assert.ok(
  quoteAt > visibilityAt,
  'loadQuote must start after settings are loaded and applied, so it respects stored visibility'
);

const readyAt = init.indexOf('notifyInPageBlockerReady()');
const themeAt = init.indexOf('await loadTheme()');
assert.ok(readyAt > 0, 'embedded blocked page must announce readiness during init');
assert.ok(readyAt < themeAt, 'readiness must be announced before the first awaited init step');
assert.doesNotMatch(init, /await notifyInPageBlockerReady\(\)/, 'readiness signal must not block init');

const setupStart = source.indexOf('async function setupUnblockMethods');
const setupEnd = source.indexOf('Show the schedule locked', setupStart);
assert.ok(setupStart > 0 && setupEnd > setupStart, 'could not locate setupUnblockMethods');
const setup = source.slice(setupStart, setupEnd);

assert.match(
  setup,
  /Promise\.all\(\[[\s\S]*GET_NUCLEAR_STATUS[\s\S]*GET_DAILY_USAGE[\s\S]*GET_EARNED_TIME[\s\S]*\]\)/,
  'the three gate checks must be requested concurrently with Promise.all'
);

['nuclearStatus', 'usageInfo', 'earnedInfo'].forEach((name) => {
  assert.doesNotMatch(
    setup,
    new RegExp(`const ${name} = await chrome\\.runtime\\.sendMessage`),
    `${name} must come from the concurrent Promise.all, not a serial await`
  );
});

console.log('blocked init order tests passed');
