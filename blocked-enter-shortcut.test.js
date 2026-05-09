import assert from 'node:assert/strict';
import fs from 'node:fs';

const blockedSource = fs.readFileSync(new URL('./blocked/blocked.js', import.meta.url), 'utf8');

assert.match(
  blockedSource,
  /document\.addEventListener\('keydown', handleEnterToUnblock\);/,
  'blocked page should register a global Enter shortcut for unblocking'
);

assert.match(
  blockedSource,
  /function shouldSubmitUnblockOnEnter\(event\)[\s\S]*event\.key !== 'Enter'/,
  'Enter shortcut should only react to Enter key presses'
);

assert.match(
  blockedSource,
  /target\.closest\('#whitelist-link-action'\)/,
  'Enter shortcut should not intercept whitelist-link text entry'
);

assert.match(
  blockedSource,
  /hint\.textContent = 'Select your time limit and press Enter or click to continue';/,
  'unlock hint should advertise Enter as a shortcut'
);

console.log('blocked enter shortcut tests passed');
