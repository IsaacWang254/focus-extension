import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveNewtabBackground, NEWTAB_BACKGROUNDS } from '../lib/newtab-background.js';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// Migration off the old newtabShowOceanBackground boolean
// ---------------------------------------------------------------------------

assert.equal(
  resolveNewtabBackground({}),
  'ocean',
  'a fresh install defaults to the ocean background'
);

assert.equal(
  resolveNewtabBackground({ newtabShowOceanBackground: false }),
  'none',
  'someone who had turned the ocean off must not get it switched back on'
);

assert.equal(
  resolveNewtabBackground({ newtabShowOceanBackground: true }),
  'ocean',
  'someone who had the ocean on keeps it'
);

assert.equal(
  resolveNewtabBackground({ newtabBackground: 'dither', newtabShowOceanBackground: false }),
  'dither',
  'an explicit picker value wins over the legacy boolean'
);

assert.equal(
  resolveNewtabBackground({ newtabBackground: 'nonsense' }),
  'ocean',
  'an unrecognised stored value falls back to the default rather than blanking the page'
);

assert.deepEqual(
  NEWTAB_BACKGROUNDS,
  ['none', 'ocean', 'dither'],
  'the picker options and the resolver must agree on the available backgrounds'
);

// ---------------------------------------------------------------------------
// Options UI wiring
// ---------------------------------------------------------------------------

const optionsHtml = read('../options/options.html');
const optionsSource = read('../options/options.js');

NEWTAB_BACKGROUNDS.forEach((value) => {
  assert.match(
    optionsHtml,
    new RegExp(`<option value="${value}"`),
    `the background picker must offer "${value}"`
  );
});

assert.doesNotMatch(
  optionsSource,
  /getElementById\('newtab-show-ocean-background'\)/,
  'the removed ocean checkbox must not be read anywhere — it would throw on null'
);

assert.doesNotMatch(
  optionsHtml,
  /id="newtab-show-ocean-background"/,
  'the ocean checkbox markup should be gone, replaced by the picker'
);

assert.match(
  optionsSource,
  /settings\.newtabShowOceanBackground = settings\.newtabBackground !== 'none'/,
  'the legacy boolean must stay in sync so a downgrade does not lose the setting'
);

assert.match(
  optionsSource,
  /getElementById\('newtab-background'\)\?\.addEventListener\('change', markAsChanged\)/,
  'changing the background picker must reveal the Save button'
);

assert.match(
  optionsSource,
  /newtabBackground: document\.getElementById\('newtab-background'\)\.value/,
  'dirty-state snapshots must include newtabBackground so the picker is diffed'
);

// ---------------------------------------------------------------------------
// Shader loop bounds — regression guard on the unrolled-loop perf bug
// ---------------------------------------------------------------------------

const oceanSource = read('../newtab/ocean-shader.js');
const ditherSource = read('../newtab/dither-shader.js');
const glSource = read('../newtab/gl-background.js');

// GLSL ES 1.00 requires a constant loop bound, so `for(i<36) { if (i>=iters)
// break; }` still compiles to 36 unrolled iterations — the battery-saver
// setting bought almost nothing. Quality tiers must be #define'd instead.
for (const [name, src] of [['ocean', oceanSource], ['dither', ditherSource]]) {
  const loopBounds = [...src.matchAll(/for\s*\(\s*int\s+i\s*=\s*0\s*;\s*i\s*<\s*([A-Za-z0-9_]+)\s*;/g)]
    .map((m) => m[1]);

  assert.ok(loopBounds.length > 0, `${name} shader should still have fragment loops`);

  loopBounds.forEach((bound) => {
    assert.doesNotMatch(
      bound,
      /^\d+$/,
      `${name} shader loop bound "${bound}" is a literal; it must be a #define so tiers differ`
    );
    assert.match(
      src,
      new RegExp(`#define ${bound} \\$\\{`),
      `${name} shader must inject ${bound} as a templated #define`
    );
  });

  assert.doesNotMatch(
    src,
    /if\s*\(\s*i\s*>=\s*\w*[Ii]ters\w*\s*\)\s*break/,
    `${name} shader must not gate loops with a runtime break — that is the unroll bug`
  );

  assert.doesNotMatch(
    src,
    /uniform\s+int\s+u_powerSave/,
    `${name} shader must select quality by program, not by a u_powerSave uniform`
  );
}

assert.match(
  glSource,
  /programs\s*=\s*\{[\s\S]*normal:[\s\S]*saver:/,
  'the GL harness must build a separate program per quality tier'
);

assert.match(
  glSource,
  /WEBGL_lose_context/,
  'switching backgrounds must release the old WebGL context, not leak it'
);

// Resize flicker: assigning canvas.width clears the drawing buffer. Doing that
// from the resize handler leaves the canvas blank until the next capped frame
// (50ms at the dither tier's 20fps), which is the flicker. The resize must be
// flagged and performed inside the render path, back to back with the draw.
assert.doesNotMatch(
  glSource,
  /const onResize = \(\) => resize\(\);/,
  'the resize handler must not resize the buffer directly — that is the flicker'
);

assert.match(
  glSource,
  /const onResize = \(\) => \{\s*state\.needsResize = true;/,
  'a resize must be flagged for the render loop rather than applied immediately'
);

assert.match(
  glSource,
  /if \(!state\.needsResize && tier\.fps > 0/,
  'a pending resize must bypass the frame cap so the buffer is never left cleared'
);

assert.match(
  glSource,
  /if \(!state\.running\) renderOnce\(\);/,
  'a stopped shader must redraw itself on resize — no loop will do it'
);

assert.match(
  glSource,
  /const SIZE_QUANTUM = 4;/,
  'buffer sizes must snap so the 4x4 Bayer tile keeps its phase across resizes'
);

// ---------------------------------------------------------------------------
// New tab wiring
// ---------------------------------------------------------------------------

const newtabSource = read('../newtab/newtab.js');
const plannerSource = read('../newtab/planner.js');
const newtabHtml = read('../newtab/newtab.html');
const newtabCss = read('../newtab/newtab.css');
const packageSource = read('../package.json');

assert.match(
  newtabHtml,
  /id="bg-dither"/,
  'the new tab needs a canvas for the dither background'
);

assert.match(
  newtabCss,
  /\.bg-dither\s*\{[^}]*image-rendering:\s*pixelated/,
  'the dither canvas must upscale with nearest-neighbour or the stipple turns to mush'
);

assert.match(
  newtabCss,
  /\.bg-shader\s*\{[^}]*display:\s*none/,
  'shader canvases must start hidden so two backgrounds never paint at once'
);

assert.match(
  newtabSource,
  /applyBackgroundSetting\(resolveNewtabBackground\(settings\)\)/,
  'the new tab must pick its background through the shared resolver'
);

assert.match(
  newtabSource,
  /activeBackground\.handle\.destroy\(\)/,
  'switching backgrounds must destroy the previous shader, not just stop it'
);

assert.doesNotMatch(
  newtabSource,
  /applyOceanBackgroundSetting/,
  'the old ocean-only entry point should be gone'
);

// ---------------------------------------------------------------------------
// Todoist calls must not fire on pages nobody is looking at
// ---------------------------------------------------------------------------

const blockedSource = read('../blocked/blocked.js');
const whenVisibleSource = read('../lib/when-visible.js');

assert.match(
  whenVisibleSource,
  /document\.visibilityState === 'visible'/,
  'runWhenVisible must key off visibilityState'
);

assert.match(
  blockedSource,
  /runWhenVisible\(async \(\) => \{[\s\S]*?todoist\.isAuthenticated\(\)/,
  'the blocked page must defer its Todoist auth check until the tab is visible'
);

assert.match(
  newtabSource,
  /runWhenVisible\(\(\) => \{[\s\S]*?startDashboardRefresh\(\)/,
  'the new tab must defer the dashboard scheduler — including both Todoist fetches — until the tab is visible'
);

assert.doesNotMatch(
  newtabSource,
  /^\s{2}loadTodos\(\);\s*$/m,
  'loadTodos must not also be called unconditionally at startup'
);

assert.match(
  plannerSource,
  /if \(!tasks\.length\) setPlannerStatus\('tasks', 'Loading tasks…'\)/,
  'planner refreshes must not flash loading state over visible tasks'
);

// ---------------------------------------------------------------------------
// Left-aligned new tab layout
// ---------------------------------------------------------------------------

assert.match(
  newtabCss,
  /\.daily-hero \{[^}]*align-items: flex-end/,
  'the daily context must keep its deliberate reading alignment'
);

assert.doesNotMatch(
  newtabCss,
  /\.daily-brief \{[^}]*border/,
  'the daily brief must use whitespace instead of a decorative divider'
);

assert.match(newtabHtml, /id="today-timeline-section"/, 'the homepage must expose one Today timeline');
assert.match(newtabHtml, /id="add-task-btn"[^>]*aria-label="Add task"/, 'icon-only task actions need accessible names');
assert.match(newtabHtml, /id="view-schedule-btn"[^>]*aria-label="View schedule"/, 'the schedule icon needs an accessible name');
assert.doesNotMatch(newtabHtml, /product-mark|newtab-toolbar-root|settings-modal|radix-shell\.bundle/, 'retired homepage chrome must stay removed');
assert.doesNotMatch(newtabSource, /setupThemeToggle|setupSettings/, 'removed homepage controls must not retain event wiring');
assert.doesNotMatch(packageSource, /build:newtab|newtab\/radix-shell/, 'the retired new-tab bundle must stay out of build scripts');
assert.match(newtabCss, /\.timeline-list::before\s*\{[^}]*background:/s, 'the Today timeline keeps a clear vertical time rail');

console.log('newtab background setting tests passed');
