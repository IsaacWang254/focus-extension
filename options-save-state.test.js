import assert from 'node:assert/strict';
import fs from 'node:fs';

const optionsSource = fs.readFileSync(new URL('./options/options.js', import.meta.url), 'utf8');

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
