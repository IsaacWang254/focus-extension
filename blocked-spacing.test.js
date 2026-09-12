import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('./lib/modernist.css', import.meta.url), 'utf8');

const rootBlock = css.match(/html\[data-design="modernist"\]\s*\{([\s\S]*?)\n\}/)[1];
for (const token of [
  '--modernist-frame-width: 1600px',
  '--modernist-gutter: clamp(16px, 3.8vw, 56px)',
  '--modernist-inset: clamp(16px, 2.2dvh, 28px)',
  '--modernist-pad: clamp(20px, 2.5vw, 40px)',
  '--modernist-frame-edge: max(var(--modernist-gutter), calc((100vw - var(--modernist-frame-width)) / 2))',
  '--modernist-section-gap: clamp(12px, 2dvh, 24px)',
  '--modernist-row-gap: clamp(8px, 1.5dvh, 16px)',
  '--modernist-panel-pad: clamp(12px, 2dvh, 20px)',
  '--modernist-column-gap: clamp(32px, 4.5vw, 64px)',
  '--modernist-panel-row-gap: clamp(24px, 3vh, 36px)',
  '--modernist-rail-pad: clamp(20px, 2.5vw, 32px)',
  '--modernist-columns: minmax(0, 1.6fr) minmax(280px, 1fr)',
  '--modernist-panel-heading: clamp(1.2rem, 2.7dvh, 1.5rem)'
]) {
  assert.ok(rootBlock.includes(token), `root spacing token missing: ${token}`);
}

assert.match(
  css,
  /\[data-surface="newtab"\]\s+\.main,\s*\n\s*html\[data-design="modernist"\]\s+\[data-surface="blocked"\]\s+>\s+\.container\s*\{[^}]*width:\s*calc\(100% - 2 \* var\(--modernist-gutter\)\)[^}]*max-width:\s*var\(--modernist-frame-width\)[^}]*margin:\s*0 auto[^}]*padding:\s*var\(--modernist-inset\) var\(--modernist-pad\)/s,
  'newtab and blocked must share the centered frame rule'
);

const standaloneMain = css.match(/html\[data-design="modernist"\] \[data-surface="newtab"\] \.main \{\n([^}]*)\}/);
assert.ok(standaloneMain, 'standalone newtab .main rule exists');
assert.doesNotMatch(standaloneMain[1], /width:|max-width:|min-height: 100dvh|padding:/, 'newtab .main defers frame sizing to the shared rule');

const blockedBody = css.match(/html\[data-design="modernist"\] \[data-surface="blocked"\] \{\n([^}]*)\}/);
assert.ok(blockedBody, 'blocked body rule exists');
assert.match(blockedBody[1], /padding:\s*0/, 'blocked body padding removed (frame provides spacing)');
assert.match(blockedBody[1], /display:\s*block/, 'blocked body is a block flow for the centered container');

const layoutRule = css.match(/\[data-surface="blocked"\]\s+\.layout\s*\{([^}]*)\}/);
assert.ok(layoutRule, 'blocked layout rule exists');
assert.match(layoutRule[1], /display:\s*grid/, 'blocked layout is a grid');
assert.match(layoutRule[1], /grid-template-columns:\s*minmax\(0,\s*1fr\)/, 'blocked layout stacks by default');
assert.match(layoutRule[1], /row-gap:\s*var\(--modernist-panel-row-gap\)/, 'blocked layout shares the row gap');
assert.match(layoutRule[1], /column-gap:\s*0/, 'blocked layout has no dead intercolumn gap');
assert.match(layoutRule[1], /padding-top:\s*0/, 'divider reaches the header hairline');
assert.match(layoutRule[1], /align-items:\s*stretch/, 'columns stretch so the divider spans the taller side');
assert.doesNotMatch(layoutRule[1], /max-width|height:\s*|overflow/, 'blocked layout has no width cap or clipping');

assert.match(
  css,
  /\[data-surface="blocked"\]\s+\.work-col\s*\{[^}]*padding-top:\s*var\(--modernist-panel-pad\)/s,
  'work column keeps its top breathing room'
);
const unblockRule = css.match(/html\[data-design="modernist"\] \[data-surface="blocked"\] \.unblock-col \{\n([^}]*)\}/);
assert.ok(unblockRule, 'blocked unblock-col default rule exists');
assert.match(unblockRule[1], /border-top:\s*1px solid var\(--border\)/, 'stacked rail gets a top divider');
assert.match(unblockRule[1], /border-left:\s*0/, 'stacked rail has no side divider');
assert.match(unblockRule[1], /padding:\s*var\(--modernist-panel-pad\) 0 0/, 'stacked rail pads top only');
assert.match(unblockRule[1], /margin-top:\s*0/, 'stacked rail margin cleared');

const media1024 = css.match(/@media \(min-width: 1024px\) \{([\s\S]*?)\n\}/);
assert.ok(media1024, '1024px blocked columns media exists');
assert.match(media1024[1], /\.layout\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s, 'blocked splits into two equal tracks at 1024');
assert.match(media1024[1], /\.work-col\s*\{[^}]*padding-right:\s*var\(--modernist-rail-pad\)/s, 'work column gets balanced right padding');
const unblock1024 = media1024[1].match(/\.unblock-col\s*\{([^}]*)\}/);
assert.match(unblock1024[1], /border-top:\s*0/, 'rail top divider drops at 1024');
assert.match(unblock1024[1], /border-left:\s*1px solid var\(--border\)/, 'rail side divider appears at 1024');
assert.match(unblock1024[1], /padding-left:\s*var\(--modernist-rail-pad\)/, 'rail left padding matches work right padding');

const media769 = css.slice(css.indexOf('@media (min-width: 769px)'), css.indexOf('@media (min-width: 1024px)'));
assert.doesNotMatch(media769, /data-surface="blocked"/, 'the 769px shared block is homepage-only now');
assert.match(media769, /content-panels:not\(:has\(\.panel-todos\.hidden\)\)[^{]*\{[^}]*grid-template-columns:\s*var\(--modernist-columns\)/s, 'homepage keeps its sidebar proportions');
assert.match(media769, /\.side-rail\s*\{[^}]*padding-left:\s*var\(--modernist-rail-pad\)/s, 'homepage keeps its rail pad');

const mobileBlock = css.slice(css.indexOf('@media (max-width: 768px)'), css.indexOf('@media (min-width: 900px)'));
assert.doesNotMatch(mobileBlock, /\[data-surface="blocked"\]\s+\.layout\s*\{[^}]*grid-template-columns/s, 'no redundant blocked stacking rule under 768');
assert.match(mobileBlock, /\[data-surface="blocked"\]\s+\.section-header\s+h2\s*\{[^}]*font-size:\s*1\.35rem/s, 'blocked section heading still shrinks under 768');

assert.match(
  css,
  /\[data-surface="blocked"\]\s+\.header\s*\{[^}]*margin-bottom:\s*0[^}]*border-bottom:\s*1px solid var\(--foreground\)/s,
  'blocked header keeps the masthead hairline'
);
assert.match(
  css,
  /\[data-surface="blocked"\]\s+\.header-top\s*\{[^}]*border-bottom:\s*1px solid var\(--foreground\)/s,
  'blocked header-top gains the masthead divider'
);
assert.match(
  css,
  /\[data-surface="blocked"\]\s+\.title\s*\{[^}]*font-size:\s*clamp\(3rem,\s*min\(8vw,\s*16dvh\),\s*7\.5rem\)[^}]*margin-bottom:\s*var\(--modernist-row-gap\)/s,
  'blocked title is height-aware with shared row gap'
);
assert.match(
  css,
  /\[data-surface="blocked"\]\s+\.quote-section\s*\{[^}]*margin-bottom:\s*var\(--modernist-section-gap\)/s,
  'blocked quote uses the shared section gap'
);
assert.match(
  css,
  /\[data-surface="blocked"\]\s+\.section-header\s+h2\s*\{[^}]*font-size:\s*var\(--modernist-panel-heading\)/s,
  'blocked section heading uses the shared heading size'
);
assert.match(
  css,
  /\[data-surface="blocked"\]\s+\.blocked-url\s*\{[^}]*overflow-wrap:\s*anywhere/s,
  'long domains cannot overflow the frame'
);
assert.match(
  css,
  /\[data-surface="blocked"\]\s+\.unblock-col\s+>\s+\.section:last-child\s*\{[^}]*margin-bottom:\s*0/s,
  'last rail section keeps zero bottom margin'
);

console.log('blocked-spacing.test.js: all assertions passed');
