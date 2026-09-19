import assert from 'node:assert/strict';
import fs from 'node:fs';

const backgroundSource = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8');
const contentSource = fs.readFileSync(new URL('../content-redirect.js', import.meta.url), 'utf8');

assert.match(
  backgroundSource,
  /case 'IS_ON_FOCUS_BREAK':\s*return await isOnFocusBreak\(\);/,
  'background should expose a side-effect-free focus break check'
);

assert.match(
  contentSource,
  /IS_ON_FOCUS_BREAK/,
  'content script should ask whether Pomodoro is currently on break'
);

assert.match(
  contentSource,
  /type: 'SHOULD_BLOCK_URL'/,
  'top-level block decisions must defer to the authoritative background check'
);

assert.match(
  backgroundSource,
  /case 'SHOULD_BLOCK_URL':\s*return await shouldBlockUrl\(message\.url\);/,
  'background should answer block-decision queries from content scripts'
);

assert.match(
  backgroundSource,
  /async function shouldBlockUrl\(url\) \{[\s\S]*?if \(await isOnFocusBreak\(\)\) return false;/,
  'the shared block decision must release sites while a focus break is running'
);

assert.match(
  contentSource,
  /if \(!hasActiveExtensionContext\(\) \|\| blockedPageHost \|\| isOnFocusBreak\) \{\s*return;\s*\}[\s\S]*?maybeBlockEmbeddedContent/,
  'embedded media blocking must also pause during a focus break'
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
