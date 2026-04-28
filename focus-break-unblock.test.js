import assert from 'node:assert/strict';
import fs from 'node:fs';

const backgroundSource = fs.readFileSync(new URL('./background.js', import.meta.url), 'utf8');
const contentSource = fs.readFileSync(new URL('./content-redirect.js', import.meta.url), 'utf8');

assert.match(
  backgroundSource,
  /case 'IS_ON_FOCUS_BREAK':\s*return await isOnFocusBreak\(\);/,
  'background should expose a side-effect-free focus break check'
);

assert.match(
  contentSource,
  /IS_ON_FOCUS_BREAK/,
  'content redirect fallback should ask whether Pomodoro is currently on break'
);

assert.match(
  contentSource,
  /if \(isOnFocusBreak\) \{[\s\S]*?maybeRunCategoryScan\(settings, currentDomain, currentUrl\)[\s\S]*?return;/,
  'content redirect fallback should skip blocking while focus session is on break'
);

assert.match(
  backgroundSource,
  /async function restoreBlockedTabsForFocusBreak\(\)/,
  'background should restore already-blocked tabs when a focus break starts'
);

assert.match(
  backgroundSource,
  /await updateBlockingRules\(\);\s*\n\s*await restoreBlockedTabsForFocusBreak\(\);/,
  'work-to-break transition should reopen original URLs after suspending blocking rules'
);

console.log('focus break unblock tests passed');
