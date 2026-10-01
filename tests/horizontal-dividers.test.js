import assert from 'node:assert/strict';
import fs from 'node:fs';

const dir = new URL('../', import.meta.url);

// Remaining surfaces: the new tab and Settings. Sections and rows separate
// with whitespace — no decorative horizontal rules anywhere.
const files = [
  'lib/modernist.css',
  'lib/common.css',
  'lib/nt-tokens.css',
  'newtab/newtab.css',
  'options/options.css'
];

for (const file of files) {
  const css = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const [, side, value] of body.matchAll(/\bborder-(top|bottom|block|block-start|block-end)\s*:\s*([^;]+);/g)) {
      assert.match(
        value.trim(),
        /^(?:0(?:px)?|none)$/,
        `${file}: ${selectors.trim()} must not draw a horizontal divider`
      );
    }
  }
}

const common = fs.readFileSync(new URL('../lib/common.css', import.meta.url), 'utf8');
const newtab = fs.readFileSync(new URL('../newtab/newtab.css', import.meta.url), 'utf8');
const options = fs.readFileSync(new URL('../options/options.css', import.meta.url), 'utf8');

function ruleBody(css, selector) {
  const match = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\{]*\\{([^{}]*)\\}`));
  assert.ok(match, `missing rule for ${selector}`);
  return match[1];
}

assert.match(common, /\.input,[\s\S]*?border:\s*1px solid var\(--input\);/, 'input keeps full outline');
assert.match(common, /outline:\s*2px solid var\(--ring\)/, 'focus outline preserved');

// Settings controls keep functional outlines: quiet connect button, switch
// focus ring, segmented control border.
assert.match(ruleBody(options, '.st-btn'), /border:\s*1px solid var\(--nt-rule\)/, 'connect button keeps its rule outline');
assert.match(ruleBody(options, '.seg'), /border:\s*1px solid var\(--nt-rule\)/, 'segmented control keeps its outline');
assert.match(options, /\.st-switch:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--nt-ink\)/s, 'switch keeps a 2px ink focus ring');

const dividerBody = ruleBody(common, '.divider,');
assert.match(dividerBody, /height:\s*0;/, 'divider occupies no height');
assert.match(dividerBody, /background-color:\s*transparent;/, 'divider draws nothing');
assert.match(dividerBody, /margin:\s*var\(--space-4\) 0;/, 'divider whitespace spacing kept');
assert.match(dividerBody, /border:\s*none;/, 'divider border stays none');

// The new-tab timeline keeps its structural lines (calendar chart baseline,
// rails) — only decorative separators are banned, which the sweep above covers.
assert.ok(newtab.length > 0);

for (const file of files) {
  const css = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\*\s*\{[^}]*border/, `${file}: no blanket global border reset`);
}

console.log('horizontal-dividers tests passed');
