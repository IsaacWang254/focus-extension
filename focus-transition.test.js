import assert from 'node:assert/strict';
import fs from 'node:fs';

const backgroundSource = fs.readFileSync(new URL('./background.js', import.meta.url), 'utf8');

assert.match(
  backgroundSource,
  /workMinutes,\s*\n\s*customMinutes:/,
  'focus sessions should snapshot the starting work duration'
);

assert.match(
  backgroundSource,
  /const sessionWorkMinutes = getSessionWorkMinutes\(session, preset\);/,
  'phase transitions should use the session work duration instead of rereading the preset'
);

assert.match(
  backgroundSource,
  /session\.endTime = Date\.now\(\) \+ \(sessionWorkMinutes \* 60 \* 1000\);/,
  'break-to-focus transition should preserve the previous focus duration'
);

assert.match(
  backgroundSource,
  /await updateBlockingRules\(\);\s*\n\s*await redirectTabsThatShouldNowBeBlocked\('focus-resumed'\);/,
  'break-to-focus transition should immediately redirect tabs that are now blocked'
);

console.log('focus transition tests passed');
