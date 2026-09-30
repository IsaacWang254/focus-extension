import assert from 'node:assert/strict';
import fs from 'node:fs';

const optionsSource = fs.readFileSync(new URL('../options/options.js', import.meta.url), 'utf8');
const optionsHtml = fs.readFileSync(new URL('../options/options.html', import.meta.url), 'utf8');

for (const retiredControl of [
  'newtab-show-quotes',
  'newtab-show-focus-snapshot'
]) {
  assert.doesNotMatch(
    optionsHtml,
    new RegExp(`id="${retiredControl}"`),
    `${retiredControl} must not remain visible in New Tab settings`
  );
  assert.doesNotMatch(
    optionsSource,
    new RegExp(retiredControl),
    `${retiredControl} must not be initialized, listened to, saved, or included in dirty-state checks`
  );
}

for (const retiredKey of [
  'newtabShowQuotes',
  'newtabShowFocusSnapshot'
]) {
  assert.doesNotMatch(
    optionsSource,
    new RegExp(retiredKey),
    `${retiredKey} must remain inert in the options page`
  );
}

assert.match(
  optionsSource,
  /focusPresets:\s*gatherFocusPresets\(\)/,
  'dirty-state snapshots must include focusPresets so preset edits show the Save button'
);

assert.match(
  optionsSource,
  /el\.addEventListener\('input',\s*\(\)\s*=>\s*\{[^}]*updatePresetCardIcons\(\);[^}]*updateSaveBarVisibility\(\);/s,
  'preset input edits should update the Save button immediately while typing'
);

console.log('options save-state tests passed');
