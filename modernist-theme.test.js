import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

function makeDocument() {
  const attributes = new Map();
  const toggles = [];
  const icons = [];
  const makeButton = () => {
    const attrs = new Map();
    return {
      _attrs: attrs,
      getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
      setAttribute: (name, value) => attrs.set(name, String(value)),
      removeAttribute: (name) => attrs.delete(name)
    };
  };
  return {
    toggles,
    icons,
    documentElement: {
      setAttribute: (name, value) => attributes.set(name, String(value)),
      getAttribute: (name) => (attributes.has(name) ? attributes.get(name) : null),
      removeAttribute: (name) => attributes.delete(name),
      style: { removeProperty: () => {}, setProperty: () => {} },
      _attributes: attributes
    },
    querySelectorAll: (selector) => {
      if (selector === '[data-design-toggle]') return toggles;
      if (selector === '.theme-toggle, .settings-dialog-close') return icons;
      return [];
    },
    addToggle(checked = false) {
      const toggle = { checked };
      toggles.push(toggle);
      return toggle;
    },
    addIconButton(initialAttrs = {}) {
      const button = makeButton();
      for (const [k, v] of Object.entries(initialAttrs)) button.setAttribute(k, v);
      icons.push(button);
      return button;
    }
  };
}

function makeChrome(initial = {}) {
  const store = { ...initial };
  const setCalls = [];
  const listeners = [];
  const chrome = {
    setCalls,
    listeners,
    store,
    storage: {
      local: {
        async get(keys) {
          if (keys == null) return { ...store };
          const list = Array.isArray(keys) ? keys : [keys];
          return list.reduce((acc, k) => (k in store && (acc[k] = store[k]), acc), {});
        },
        async set(values) {
          setCalls.push({ ...values });
          Object.assign(store, values);
        },
        async remove(keys) {
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete store[k]);
        }
      },
      onChanged: { addListener: (fn) => listeners.push(fn) }
    }
  };
  return chrome;
}

function installGlobals(doc, chrome, darkOS = false) {
  globalThis.document = doc;
  if (chrome === null) delete globalThis.chrome;
  else globalThis.chrome = chrome;
  globalThis.window = {
    matchMedia: () => ({ matches: darkOS, addEventListener: () => {}, removeEventListener: () => {} })
  };
}

const design = await import('./lib/design-theme.js');
const theme = await import('./lib/theme.js');

{
  const doc = makeDocument();
  installGlobals(doc, null);
  design.applyModernistDesign();
  assert.equal(doc.documentElement.getAttribute('data-design'), 'modernist', 'applies with no chrome context');
  doc.documentElement.setAttribute('data-theme', 'dashboard-dark');
  design.applyModernistDesign();
  design.applyModernistDesign();
  assert.equal(doc.documentElement.getAttribute('data-design'), 'modernist', 'repeated calls are idempotent');
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dashboard-dark', 'data-theme is preserved');
}

for (const [base, sync, darkOS, expected] of [
  ['light', false, false, 'dashboard-light'],
  ['dark', false, false, 'dashboard-dark'],
  ['light', true, true, 'dashboard-dark'],
  ['dark', true, false, 'dashboard-light']
]) {
  for (const legacy of [false, null, true]) {
    const doc = makeDocument();
    const chrome = makeChrome({ theme: base, themeSyncWithBrowser: sync, modernistEnabled: legacy });
    installGlobals(doc, chrome, darkOS);
    await theme.loadTheme();
    assert.equal(doc.documentElement.getAttribute('data-theme'), expected, `theme=${base} sync=${sync} osDark=${darkOS}`);
    assert.equal(doc.documentElement.getAttribute('data-design'), 'modernist', `modernist applies regardless of legacy flag=${legacy}`);
    assert.ok(
      chrome.setCalls.every((c) => !Object.prototype.hasOwnProperty.call(c, 'modernistEnabled')),
      'no writes to the retired modernistEnabled key'
    );
    assert.equal(chrome.store.modernistEnabled, legacy, 'legacy stored flag left inert');
  }
}

{
  const doc = makeDocument();
  installGlobals(doc, null);
  await theme.loadTheme();
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dashboard-light', 'no chrome falls back to light');
  assert.equal(doc.documentElement.getAttribute('data-design'), 'modernist');
}

{
  const doc = makeDocument();
  const gear = doc.addIconButton({ title: 'Open settings', 'aria-label': 'Open settings' });
  const themeBtn = doc.addIconButton({ title: 'Toggle dark mode' });
  const closeBtn = doc.addIconButton({ 'aria-label': 'Close settings' });
  installGlobals(doc, null);
  design.applyModernistDesign();

  assert.equal(gear.getAttribute('title'), null, 'static title suppressed');
  assert.equal(gear.getAttribute('aria-label'), 'Open settings', 'existing aria-label preserved');
  assert.equal(themeBtn.getAttribute('title'), null);
  assert.equal(themeBtn.getAttribute('aria-label'), 'Toggle dark mode', 'title-only icon copies label to aria-label');
  assert.equal(closeBtn.getAttribute('title'), null, 'aria-only button never gains a title');

  design.setIconButtonLabel(themeBtn, 'Switch to light mode');
  assert.equal(themeBtn.getAttribute('aria-label'), 'Switch to light mode');
  assert.equal(themeBtn.getAttribute('title'), null, 'dynamic labels never reinstate native titles');
  design.setIconButtonLabel(null, 'ignored');

  design.applyModernistDesign();
  design.applyModernistDesign();
  assert.equal(gear.getAttribute('title'), null, 'no restoration behavior exists to cycle');
}

const surfaces = [
  ['./newtab/newtab.html', 'newtab.css', 'newtab'],
  ['./blocked/blocked.html', 'blocked.css', 'blocked'],
  ['./options/options.html', 'options.css', 'options'],
  ['./popup/popup.html', 'popup.css', 'popup'],
  ['./stats/stats.html', 'stats.css', 'stats']
];

for (const [file, pageCss, surface] of surfaces) {
  const html = read(file);
  const pageIndex = html.indexOf(`href="${pageCss}"`);
  const modernistIndex = html.indexOf('href="../lib/modernist.css"');
  assert.match(html, /<html lang="en" data-design="modernist">/, `${file} ships the design on the root element`);
  assert.match(html, /<link rel="icon" type="image\/png" href="\.\.\/icons\/icon16\.png">/, `${file} uses the brand PNG favicon`);
  assert.ok(pageIndex > -1, `${file} keeps its page stylesheet`);
  assert.ok(modernistIndex > pageIndex, `${file} loads modernist.css after ${pageCss}`);
  assert.match(html, new RegExp(`<body data-surface="${surface}"`), `${file} marks its body as ${surface}`);
}

const optionsHtml = read('./options/options.html');
const optionsSource = read('./options/options.js');
assert.doesNotMatch(optionsHtml, /data-design-toggle|modernist-enabled|modernist-status|modernist-setting/, 'the options toggle markup must be gone');
assert.doesNotMatch(optionsSource, /setupModernistToggle|setModernistDesign/, 'the options toggle wiring must be gone');

for (const src of ['./lib/theme.js', './lib/design-theme.js', './newtab/newtab.js', './blocked/blocked.js']) {
  assert.doesNotMatch(read(src), /modernistEnabled/, `${src} must not depend on the retired flag`);
}

const newtabHtml = read('./newtab/newtab.html');
const modernistCss = read('./lib/modernist.css');

assert.doesNotMatch(newtabHtml, /modernist-caption|A space for/, 'the masthead tagline must be gone');
assert.doesNotMatch(
  modernistCss,
  /\[data-surface="newtab"\]\s+\.main\s*\{[^}]*border-inline/s,
  'the new tab frame must not draw outer left/right rules'
);
assert.doesNotMatch(modernistCss, /modernist-setting/, 'the options row CSS must be gone');
assert.match(
  modernistCss,
  /@media\s*\(min-width:\s*900px\)\s*and\s*\(min-height:\s*600px\)/,
  'a scoped desktop-height fit block must exist'
);
assert.match(
  modernistCss,
  /grid-template-rows:\s*auto\s+auto\s+minmax\(0,\s*1fr\)\s+auto/,
  'the stage must give the flexible row to the panels'
);
assert.match(
  modernistCss,
  /\[data-surface="newtab"\]\s+\.panel-body\s*\{[^}]*overflow-y:\s*auto/s,
  'panel bodies must scroll inside their bounded row'
);

assert.match(modernistCss, /--brand-red:\s*#e5342a/i, 'brand red token present');
assert.match(modernistCss, /--modernist-highlight:\s*var\(--brand-red\)/, 'highlight aliases brand red');
assert.match(modernistCss, /--indigo-hover:\s*#d9231b/i, 'light hover uses the deeper safe red');
assert.match(modernistCss, /--ring:\s*var\(--modernist-highlight\)/, 'focus ring follows the highlight');
assert.match(modernistCss, /--modernist-display:\s*var\(--brand-red\)/, 'display color follows brand red');
const darkBlock = modernistCss.slice(modernistCss.indexOf('[data-theme$="dark"]'));
assert.match(darkBlock, /--modernist-highlight:\s*#ff4e3a/i, 'dark highlight token');
assert.match(darkBlock, /--indigo-hover:\s*#ff705e/i, 'dark hover uses the readable bright red');
assert.match(darkBlock, /--ring:\s*var\(--modernist-highlight\)/, 'dark ring follows the highlight');
assert.match(
  modernistCss,
  /:is\(\.theme-toggle,\s*\.settings-dialog-close\):is\(:hover,\s*:focus-visible\)\s*\{[^}]*color:\s*var\(--modernist-highlight\)/s,
  'icon hover/focus uses the vibrant highlight'
);
assert.match(
  modernistCss,
  /:is\(\.btn-secondary,\s*\.btn-ghost,\s*\.profile-select,\s*\.time-range-select,\s*\.focus-preset-btn\):hover:not\(:disabled\)\s*\{[^}]*background-color:\s*var\(--background\)/s,
  'text-button hover keeps the plain page background for contrast'
);
assert.match(
  modernistCss,
  /\.radix-select-item\[data-highlighted\]\s*\{[^}]*background-color:\s*var\(--background\)/s,
  'highlighted select items keep the plain background for contrast'
);

const newtabSource = read('./newtab/newtab.js');
const blockedSource = read('./blocked/blocked.js');
for (const [file, src] of [['newtab/newtab.js', newtabSource], ['blocked/blocked.js', blockedSource]]) {
  assert.match(src, /setIconButtonLabel\(toggle/, `${file} must label the theme toggle through the design-aware helper`);
  assert.doesNotMatch(src, /toggle\.title\s*=/, `${file} must not assign native titles directly`);
}
assert.match(modernistCss, /\.settings-launch::after\s*\{[^}]*content:\s*none/s, 'the pseudo tooltip must be disabled');
assert.match(
  modernistCss,
  /:is\(\.theme-toggle,\s*\.settings-dialog-close\)\s*\{[^}]*border:\s*0[^}]*transition:[^}]*transform/s,
  'icon buttons must be borderless with a transform transition'
);
const reducedBlock = modernistCss.slice(modernistCss.indexOf('@media (prefers-reduced-motion: reduce)'));
assert.match(
  reducedBlock,
  /\.theme-toggle:not\(\.settings-launch\):is\(:hover,\s*:focus-visible\)\s+svg[^{]*\{[^}]*transform:\s*none/s,
  'the reduced-motion rule must outrank the moon/sun hover rotation selector'
);

for (const [file, w, h] of [
  ['./icons/icon16.svg', 16, 16],
  ['./icons/icon48.svg', 48, 48],
  ['./icons/icon128.svg', 128, 128]
]) {
  const svg = read(file);
  assert.match(svg, /#E5342A/i, `${file} carries the brand red`);
  assert.match(svg, /#F7F5EF/i, `${file} carries the paper tone`);
  assert.doesNotMatch(svg, /#18181B|#F59E0B|#FFFFFF/i, `${file} must not keep old black/amber/white`);
  assert.match(svg, new RegExp(`width="${w}" height="${h}"`), `${file} dimensions intact`);
}

const social = read('./icons/social-preview.svg');
for (const [from, to] of [
  ['#F5F5F4', '#F7F5EF'], ['#18181B', '#E5342A'], ['#F59E0B', '#F7F5EF'],
  ['#52525B', '#656259'], ['#D4D4D8', '#CBC6BA']
]) {
  assert.doesNotMatch(social, new RegExp(from, 'i'), `social preview keeps no ${from}`);
  assert.match(social, new RegExp(to, 'i'), `social preview carries ${to}`);
}
assert.match(social, /font-family="Hanken Grotesk, sans-serif"/, 'social preview uses the bundled face');
assert.doesNotMatch(social, /font-weight="700"/, 'social heading drops to 500');

const favicon = read('./icons/newtab-favicon.svg');
assert.match(favicon, /#E5342A/i, 'sunrise favicon recolored to brand red');
assert.match(favicon, /#F7F5EF/i, 'sunrise favicon carries paper');
assert.doesNotMatch(favicon, /#F59E0B|#FBBF24|#0a0a0a/i, 'sunrise favicon keeps no amber/black');

const pngSize = (rel) => {
  const buf = fs.readFileSync(new URL(rel, import.meta.url));
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${rel} is a PNG`);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
};
for (const [rel, w, h] of [
  ['./icons/icon16.png', 16, 16],
  ['./icons/icon48.png', 48, 48],
  ['./icons/icon128.png', 128, 128],
  ['./icons/social-preview.png', 1280, 640]
]) {
  const { w: pw, h: ph } = pngSize(rel);
  assert.equal(pw, w, `${rel} width`);
  assert.equal(ph, h, `${rel} height`);
}

assert.match(read('./manifest.json'), /icons\/icon128\.png/, 'manifest points at the regenerated PNG set');
assert.match(read('./README.md'), /icons\/icon128\.png/, 'README points at the regenerated PNG set');
assert.match(read('./README.md'), /Modernist-inspired design/, 'README describes the permanent design');
assert.doesNotMatch(read('./README.md'), /preview-design/, 'README no longer documents the retired preview param');

const shim = read('./scripts/preview/shim.js');
assert.doesNotMatch(shim, /focus-preview-modernist|modernistEnabled|preview-design/, 'preview shim returns to pre-session state');

console.log('modernist-theme.test.js: all assertions passed');
