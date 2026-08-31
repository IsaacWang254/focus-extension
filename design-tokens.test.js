import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

const common = read('./lib/common.css');
const pageStyles = {
  'newtab/newtab.css': read('./newtab/newtab.css'),
  'blocked/blocked.css': read('./blocked/blocked.css'),
  'options/options.css': read('./options/options.css'),
  'popup/popup.css': read('./popup/popup.css'),
  'stats/stats.css': read('./stats/stats.css')
};

// ---------------------------------------------------------------------------
// Monospace interface face
// ---------------------------------------------------------------------------

assert.match(
  common,
  /font-family: "JetBrains Mono";/,
  'JetBrains Mono must be declared as a bundled @font-face'
);

['jetbrains-mono-latin-wght-normal.woff2', 'jetbrains-mono-latin-ext-wght-normal.woff2']
  .forEach((file) => {
    assert.ok(
      fs.existsSync(new URL(`./lib/fonts/${file}`, import.meta.url)),
      `${file} must be bundled — the extension cannot pull fonts from a CDN`
    );
    assert.match(common, new RegExp(file.replace(/\./g, '\\.')), `${file} must be referenced`);
  });

assert.match(
  read('./scripts/copy-fonts.js'),
  /jetbrains-mono-latin-wght-normal\.woff2/,
  'copy-fonts must reproduce the mono files, or a fresh clone loses them'
);

// --font-sans is the interface face, not a fallback: the whole UI is mono.
assert.match(
  common,
  /--font-sans: "JetBrains Mono"/,
  '--font-sans must resolve to JetBrains Mono'
);

// NK57 was tried and reverted; the variable face reads better at these sizes.
assert.doesNotMatch(
  common,
  /NK57/,
  'no NK57 references should remain'
);

// Only the roman weight axis is bundled, so italics would be synthesised.
assert.doesNotMatch(
  pageStyles['newtab/newtab.css'],
  /\.quote-text \{[^}]*font-style: italic/,
  'the quote must not be italic — no italic face is bundled'
);

// ---------------------------------------------------------------------------
// Flat: hairline rules, never depth
// ---------------------------------------------------------------------------

const lightTokens = common.slice(0, common.indexOf('/* Dark Mode */'));

assert.match(lightTokens, /--foreground: #111111;/, 'light ink is #111');
assert.match(lightTokens, /--muted-foreground: #666666;/, 'muted text is #666');
assert.match(lightTokens, /--faint: #999999;/, 'the third text tier is #999');
assert.match(lightTokens, /--border: #cccccc;/, 'hairline rules are #ccc');
assert.match(lightTokens, /--secondary: #f4f4f4;/, 'the wash is #f4f4f4');

['--shadow-sm', '--shadow', '--shadow-md', '--shadow-lg'].forEach((token) => {
  const decls = [...common.matchAll(new RegExp(`\\${token}: ([^;]+);`, 'g'))].map((m) => m[1]);
  assert.ok(decls.length > 0, `${token} should still be defined`);
  decls.forEach((value) => {
    assert.equal(
      value.trim(),
      'none',
      `${token} must be none — separation comes from rules, not depth`
    );
  });
});

assert.match(
  common,
  /\.card \{[^}]*background-color: transparent[^}]*box-shadow: none/s,
  '.card must be a hairline outline with no fill'
);

assert.match(
  common,
  /\.section \{[^}]*background-color: transparent/s,
  '.section must be a hairline outline with no fill'
);

// A higher-specificity theme rule used to put the fill and shadow back on
// every card and section, overriding the per-page flat styling.
assert.doesNotMatch(
  common,
  /\[data-theme="dashboard-(light|dark)"\] \.(card|section),?\n?[^{]*\{[^}]*box-shadow: var\(--shadow\)/s,
  'no theme override may restore card fills or shadows'
);

// Soft-card radii collapse to one 8px step; pills and circles are untouched.
Object.entries(pageStyles).forEach(([name, css]) => {
  const radii = [...css.matchAll(/border-radius: (\d+)px/g)].map((m) => Number(m[1]));
  const oversized = radii.filter((r) => r > 8 && r < 100);
  assert.deepEqual(
    oversized,
    [],
    `${name} still has soft-card radii ${oversized.join(', ')} — collapse them to 8px`
  );
});

// No uppercase labels anywhere — hierarchy comes from size/weight/ink.
Object.entries(pageStyles).forEach(([name, css]) => {
  assert.doesNotMatch(
    css,
    /text-transform: uppercase/,
    `${name} must not use uppercase labels`
  );
});

// No depth shadows in page styles (spread-only focus rings are fine).
Object.entries(pageStyles).forEach(([name, css]) => {
  assert.doesNotMatch(
    css,
    /box-shadow:[^;]*\d+px\s+\d+px/,
    `${name} must not paint depth shadows — separation comes from rules`
  );
});

// The indigo accent went graphite; no page may resurrect the old purple.
[...Object.entries(pageStyles), ['lib/common.css', common]].forEach(([name, css]) => {
  assert.doesNotMatch(
    css,
    /#6366f1|#4f46e5|#818cf8/i,
    `${name} still references the retired indigo accent`
  );
});

// Task priority rings are token-driven so every theme stays coherent.
['newtab/newtab.css', 'blocked/blocked.css'].forEach((name) => {
  const css = pageStyles[name];
  assert.match(
    css,
    /priority-urgent[^{]*\{[^}]*var\(--destructive\)/s,
    `${name}: urgent priority must use var(--destructive)`
  );
  assert.match(
    css,
    /priority-high[^{]*\{[^}]*var\(--warning\)/s,
    `${name}: high priority must use var(--warning)`
  );
});

// ---------------------------------------------------------------------------
// Blocked page: legible rail, single set of quotation marks
// ---------------------------------------------------------------------------

const blockedCss = pageStyles['blocked/blocked.css'];
const blockedJs = read('./blocked/blocked.js');

// The unblock rail was once dimmed to 0.55 opacity — a hidden affordance.
assert.doesNotMatch(
  blockedCss,
  /\.unblock-col \{[^}]*opacity/s,
  'the unblock rail must not be faded at rest'
);

// The stylesheet owns the quotation marks and the author dash; the script
// setting them too is how the page once rendered ""double"" quotes.
assert.match(blockedCss, /\.quote-text::before \{[^}]*\\201C/s, 'CSS supplies the opening quote');
assert.match(
  blockedJs,
  /quote-text'\)\.textContent = quote\.text/,
  'blocked.js must set the bare quote text — punctuation lives in CSS'
);

// ---------------------------------------------------------------------------
// Panels over the animated background
// ---------------------------------------------------------------------------

const newtabCss = pageStyles['newtab/newtab.css'];

assert.match(
  newtabCss,
  /\.bg-active \.panel \{[^}]*background-color: transparent/s,
  'panels must stay unfilled over the shader rather than turning into frosted plates'
);

assert.match(
  newtabCss,
  /\.bg-active \.panel \{[^}]*backdrop-filter: none/s,
  'no backdrop blur — the page-level wash handles legibility instead'
);

assert.match(
  newtabCss,
  /\.bg-active::before \{[^}]*linear-gradient/s,
  'a page-level wash must demote the shader to ambient texture'
);

console.log('design token tests passed');
