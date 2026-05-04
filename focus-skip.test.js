import assert from 'node:assert/strict';
import fs from 'node:fs';

const backgroundSource = fs.readFileSync(new URL('./background.js', import.meta.url), 'utf8');
const popupSource = fs.readFileSync(new URL('./popup/radix.jsx', import.meta.url), 'utf8');

assert.match(
  backgroundSource,
  /if \(session\.phase === 'work'\) \{\s*\n\s*return \{ success: false, error: 'Focus periods cannot be skipped' \};\s*\n\s*\}/,
  'runtime focus skip requests should be rejected during work phases'
);

assert.match(
  popupSource,
  /\{focusSession\.phase !== 'work' && \(\s*\n\s*<button className="btn btn-secondary" type="button" onClick=\{skipFocusBreak\}>Skip<\/button>\s*\n\s*\)\}/,
  'popup should hide the skip button during focus work phases'
);

console.log('focus skip tests passed');
