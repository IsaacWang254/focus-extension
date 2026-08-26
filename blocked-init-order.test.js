import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./blocked/blocked.js', import.meta.url), 'utf8');

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

console.log('blocked init order tests passed');
