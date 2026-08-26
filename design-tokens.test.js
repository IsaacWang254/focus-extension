import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

const common = read('./lib/common.css');
const pageStyles = {
  'newtab/newtab.css': read('./newtab/newtab.css'),
  'blocked/blocked.css': read('./blocked/blocked.css'),
  'options/options.css': read('./options/options.css')
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
