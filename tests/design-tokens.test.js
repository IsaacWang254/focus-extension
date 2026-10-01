import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

const common = read('../lib/common.css');
const ntTokens = read('../lib/nt-tokens.css');
const pageStyles = {
  'newtab/newtab.css': read('../newtab/newtab.css'),
  'options/options.css': read('../options/options.css')
};

// ---------------------------------------------------------------------------
// Bundled fonts — the extension cannot pull fonts from a CDN
// ---------------------------------------------------------------------------

assert.match(
  ntTokens,
  /font-family: "Inter";/,
  'Inter must be declared as a bundled @font-face in the shared tokens file'
);

['inter-latin-wght-normal.woff2', 'inter-latin-ext-wght-normal.woff2',
 'jetbrains-mono-latin-wght-normal.woff2', 'jetbrains-mono-latin-ext-wght-normal.woff2']
  .forEach((file) => {
    assert.ok(
      fs.existsSync(new URL(`../lib/fonts/${file}`, import.meta.url)),
      `${file} must be bundled — the extension cannot pull fonts from a CDN`
    );
  });

// Inter is the interface face on both remaining surfaces.
assert.match(
  ntTokens,
  /inter-latin-wght-normal\.woff2/,
  'nt-tokens.css must reference the bundled Inter files'
);
assert.match(
  read('../newtab/newtab.css') + read('../options/options.css'),
  /font-family: "Inter", system-ui, sans-serif/,
  'the surfaces must resolve the Inter family'
);

// NK57 was tried and reverted; the variable face reads better at these sizes.
assert.doesNotMatch(common + ntTokens, /NK57/, 'no NK57 references should remain');

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

// The shared new-tab tokens exist in light and dark.
assert.match(ntTokens, /--nt-paper: #fafafa;/, 'light paper token');
assert.match(ntTokens, /--nt-paper: #141414;/, 'dark paper token');
assert.match(ntTokens, /--nt-wash: #f1f1f1;/, 'light wash token');
assert.match(ntTokens, /--nt-wash: #1e1e1e;/, 'dark wash token');
assert.match(ntTokens, /html\[data-theme\$="dark"\] body\[data-surface\]/, 'dark token block keyed off data-theme');

// Soft-card radii collapse to one 8px step; pills and circles are untouched.
// The overlay panels (Quick Add spotlight, Edit task modal) are the single
// sanctioned exception (12px, per the overlay spec) — everything else is 8px.
Object.entries(pageStyles).forEach(([name, css]) => {
  const radii = [...css.matchAll(/([^{}]+)\{[^{}]*?border-radius: (\d+)px/g)]
    .filter((m) => !m[1].includes('.quick-add-panel') && !m[1].includes('.edit-modal-panel') && !m[1].includes('.st-switch'))
    .map((m) => Number(m[2]));
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
[...Object.entries(pageStyles), ['lib/common.css', common], ['lib/nt-tokens.css', ntTokens]].forEach(([name, css]) => {
  assert.doesNotMatch(
    css,
    /#6366f1|#4f46e5|#818cf8/i,
    `${name} still references the retired indigo accent`
  );
});

console.log('design token tests passed');
