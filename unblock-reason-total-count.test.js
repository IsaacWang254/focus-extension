import assert from 'node:assert/strict';
import fs from 'node:fs';

const backgroundSource = fs.readFileSync(new URL('./background.js', import.meta.url), 'utf8');
const optionsSource = fs.readFileSync(new URL('./options/options.js', import.meta.url), 'utf8');

assert.match(
  backgroundSource,
  /await chrome\.storage\.local\.set\(\{\s*unblockReasons: trimmedReasons,\s*unblockReasonTotalCount: nextTotalCount\s*\}\);/s,
  'saving an unblock reason should persist a cumulative unblockReasonTotalCount'
);

assert.match(
  backgroundSource,
  /const totalCount = Math\.max\(storedTotalCount, reasons\.length\);/,
  'GET_UNBLOCK_REASONS should expose a totalCount that can exceed stored reason entries'
);

assert.match(
  optionsSource,
  /const \{ reasons = \[\], stats = \{\}, categoryStats = \{\}, totalCount = reasons\.length \} = result;/,
  'options reason history should read totalCount from the background response'
);

assert.match(
  optionsSource,
  /document\.getElementById\('total-reasons'\)\.textContent = totalCount;/,
  'options total reasons metric should display totalCount rather than capped reason array length'
);

console.log('unblock reason total count tests passed');
