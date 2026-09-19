import assert from 'node:assert/strict';
import fs from 'node:fs';

const dir = new URL('../', import.meta.url);

const files = [
  'lib/modernist.css',
  'lib/common.css',
  'newtab/newtab.css',
  'blocked/blocked.css',
  'options/options.css',
  'popup/popup.css',
  'stats/stats.css'
];

let chartBaselines = 0;
for (const file of files) {
  const css = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const [, side, value] of body.matchAll(/\bborder-(top|bottom)\s*:\s*([^;]+);/g)) {
      const chartBaseline = file === 'stats/stats.css' && side === 'bottom'
        && /(?:^|\n)\.(hourly-chart|weekly-day-bar-container)\s*$/.test(selectors.trim());
      if (chartBaseline) {
        assert.equal(value.trim(), '1px solid var(--border)');
        chartBaselines += 1;
      } else {
        assert.match(
          value.trim(),
          /^(?:0(?:px)?|none)$/,
          `${file}: ${selectors.trim()} must not draw a horizontal divider`
        );
      }
    }
  }
}
assert.equal(chartBaselines, 2, 'expected exactly the two chart baselines to keep their rule');

const stats = fs.readFileSync(new URL('../stats/stats.css', import.meta.url), 'utf8');
const common = fs.readFileSync(new URL('../lib/common.css', import.meta.url), 'utf8');
const newtab = fs.readFileSync(new URL('../newtab/newtab.css', import.meta.url), 'utf8');
const blocked = fs.readFileSync(new URL('../blocked/blocked.css', import.meta.url), 'utf8');
const popup = fs.readFileSync(new URL('../popup/popup.css', import.meta.url), 'utf8');

function ruleBody(css, selector) {
  const match = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\{]*\\{([^{}]*)\\}`));
  assert.ok(match, `missing rule for ${selector}`);
  return match[1];
}

assert.match(common, /\.input,[\s\S]*?border:\s*1px solid var\(--input\);/, 'input keeps full outline');
assert.match(ruleBody(popup, '.focus-preset-btn'), /border:\s*1px solid/, 'focus preset button keeps full outline');
assert.match(common, /outline:\s*2px solid var\(--ring\)/, 'focus outline preserved');
assert.match(ruleBody(blocked, '.unblock-col'), /border-left:\s*1px solid/, 'vertical unblock rail kept');
assert.match(newtab, /\.side-rail\s*\{[^{}]*border-left:\s*1px solid/, 'vertical side rail kept');

const dividerBody = ruleBody(common, '.divider,');
assert.match(dividerBody, /height:\s*0;/, 'divider occupies no height');
assert.match(dividerBody, /background-color:\s*transparent;/, 'divider draws nothing');
assert.match(dividerBody, /margin:\s*var\(--space-4\) 0;/, 'divider whitespace spacing kept');
assert.match(dividerBody, /border:\s*none;/, 'divider border stays none');

const bedtime = ruleBody(newtab, '.bedtime-reminder-divider');
assert.match(bedtime, /height:\s*0;/, 'bedtime divider occupies no height');
assert.match(bedtime, /background(-color)?:\s*transparent;/, 'bedtime divider draws nothing');
assert.match(bedtime, /width:\s*32px;/, 'bedtime divider width kept');
assert.match(bedtime, /margin:\s*0 auto 20px;/, 'bedtime divider spacing kept');

for (const file of files) {
  const css = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\*\s*\{[^}]*border/, `${file}: no blanket global border reset`);
}

console.log('horizontal-dividers tests passed');
