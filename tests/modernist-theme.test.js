import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

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

const design = await import('../lib/design-theme.js');
const theme = await import('../lib/theme.js');

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

// Remaining surfaces: new tab + Settings. Both carry data-design on <html>,
// the shared token sheet, and a body data-surface marker.
for (const [file, surface] of [
  ['../newtab/newtab.html', 'newtab'],
  ['../options/options.html', 'settings']
]) {
  const html = read(file);
  assert.match(html, /<html lang="en" data-design="modernist">/, `${file} ships the design on the root element`);
  assert.match(html, /<link rel="icon" type="image\/png" href="\.\.\/icons\/icon16\.png">/, `${file} uses the brand PNG favicon (swapped to -dark by syncBrandAssets)`);
  assert.match(html, new RegExp(`<body data-surface="${surface}"`), `${file} marks its body as ${surface}`);
}
assert.match(read('../options/options.html'), /lib\/nt-tokens\.css/, 'options loads the shared token sheet');
assert.match(read('../newtab/newtab.css'), /@import '\.\.\/lib\/nt-tokens\.css'/, 'newtab loads the shared token sheet');

const newtabCss = read('../newtab/newtab.css');
const modernistCss = read('../lib/modernist.css');

assert.match(newtabCss, /body\[data-surface="newtab"\][^{]*\{[^}]*overflow-y:\s*auto/s,
  'the new tab keeps natural page scrolling');
assert.doesNotMatch(modernistCss, /\[data-surface="newtab"\][^{]*\{[^}]*overflow:\s*hidden/s,
  'the shared theme must not clip the new tab');

const newtabSource = read('../newtab/newtab.js');
assert.doesNotMatch(newtabSource, /setupThemeToggle|theme-toggle|setIconButtonLabel/, 'newtab must not retain the removed theme control');
assert.doesNotMatch(newtabSource, /bedtime|shader|ocean|dither|bgImage/i, 'newtab must not retain removed features');

// The Morrow mark: one quarter-disc rising from the bottom-right corner, bare
// (no tile), ink for light toolbars and paper for dark ones.
for (const size of [16, 32, 48, 128]) {
  for (const [suffix, fill, other] of [['', '#1F1F1F', '#F7F6F2'], ['-dark', '#F7F6F2', '#1F1F1F']]) {
    const file = `../icons/icon${size}${suffix}.svg`;
    const svg = read(file);
    assert.match(svg, new RegExp(fill, 'i'), `${file} is drawn in ${fill}`);
    assert.doesNotMatch(svg, new RegExp(other, 'i'), `${file} is one colour`);
    assert.doesNotMatch(svg, /<rect|<circle|stroke=/, `${file} is a single bare path`);
    assert.match(svg, /<path d="M(\d+) \1V\d+A(\d+) \2 0 0 0 \d+ \1Z"/, `${file} is the quarter-disc from the bottom-right corner`);
    assert.doesNotMatch(svg, /#E5342A|#18181B|#F59E0B|#FFFFFF/i, `${file} must not keep the old red bullseye palette or black/amber/white`);
    assert.match(svg, new RegExp(`width="${size}" height="${size}"`), `${file} dimensions intact`);
  }
}

const pngSize = (rel) => {
  const buf = fs.readFileSync(new URL(rel, import.meta.url));
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${rel} is a PNG`);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
};
for (const size of [16, 32, 48, 128]) {
  for (const suffix of ['', '-dark']) {
    const rel = `../icons/icon${size}${suffix}.png`;
    const { w: pw, h: ph } = pngSize(rel);
    assert.equal(pw, size, `${rel} width`);
    assert.equal(ph, size, `${rel} height`);
  }
}

const manifest = JSON.parse(read('../manifest.json'));
assert.equal(manifest.name, 'Morrow', 'the extension is named after the mark');
for (const size of [16, 32, 48, 128]) {
  assert.equal(manifest.action.default_icon[size], `icons/icon${size}.png`, `toolbar default icon ${size} is the light-toolbar mark`);
}
assert.match(read('../background.js'), /SET_TOOLBAR_ICON[\s\S]*setToolbarIcon|setToolbarIcon[\s\S]*SET_TOOLBAR_ICON/, 'service worker flips the toolbar icon on request');
assert.match(read('../background.js'), /icons\/icon\$\{size\}\$\{suffix\}\.png/, 'the dark set is addressed by the -dark suffix');
assert.match(read('../lib/theme.js'), /SET_TOOLBAR_ICON/, 'pages report the browser colour scheme for the toolbar icon');

// --- focus:theme localStorage mirror written by loadTheme -------------------

function makeLocalStorage({ throwOnSet = false } = {}) {
  const store = new Map();
  return {
    _store: store,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      if (throwOnSet) throw new Error('localStorage unavailable');
      store.set(k, String(v));
    },
    removeItem: (k) => store.delete(k)
  };
}

{
  const doc = makeDocument();
  const chrome = makeChrome({ theme: 'dark', themeSyncWithBrowser: false });
  const localStorage = makeLocalStorage();
  installGlobals(doc, chrome, false);
  globalThis.localStorage = localStorage;
  await theme.loadTheme();
  assert.deepEqual(JSON.parse(localStorage.getItem('focus:theme')), { theme: 'dark', sync: false },
    'loadTheme mirrors stored dark + sync=false');
  delete globalThis.localStorage;
}

{
  const doc = makeDocument();
  const chrome = makeChrome({});
  const localStorage = makeLocalStorage();
  installGlobals(doc, chrome, true);
  globalThis.localStorage = localStorage;
  await theme.loadTheme();
  assert.deepEqual(JSON.parse(localStorage.getItem('focus:theme')), { theme: 'light', sync: true },
    'loadTheme mirrors light + sync default on empty storage');
  delete globalThis.localStorage;
}

{
  const doc = makeDocument();
  const chrome = makeChrome({ theme: 'dark', themeSyncWithBrowser: false });
  installGlobals(doc, chrome, false);
  globalThis.localStorage = makeLocalStorage({ throwOnSet: true });
  const result = await theme.loadTheme();
  assert.equal(result.resolved, 'dashboard-dark', 'loadTheme still resolves when localStorage.setItem throws');
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dashboard-dark');
  delete globalThis.localStorage;
}

{
  const doc = makeDocument();
  const chrome = makeChrome({ theme: 'dark', themeSyncWithBrowser: false });
  installGlobals(doc, chrome, false);
  delete globalThis.localStorage;
  const result = await theme.loadTheme();
  assert.equal(result.resolved, 'dashboard-dark', 'loadTheme works without localStorage (Node)');
}

// --- lib/theme-boot.js pre-paint resolution ---------------------------------

const bootSource = read('../lib/theme-boot.js');
const runBoot = ({ cache, osDark }) => {
  const attributes = new Map();
  const sandbox = {
    document: {
      documentElement: {
        setAttribute: (name, value) => attributes.set(name, String(value)),
        getAttribute: (name) => (attributes.has(name) ? attributes.get(name) : null)
      }
    },
    localStorage: { getItem: () => cache },
    matchMedia: (query) => ({
      matches: query === '(prefers-color-scheme: dark)' ? osDark : false,
      addEventListener: () => {},
      removeEventListener: () => {}
    })
  };
  vm.createContext(sandbox);
  vm.runInContext(bootSource, sandbox);
  return attributes.get('data-theme');
};

for (const [cache, osDark, expected] of [
  [null, true, 'dashboard-dark'],
  [null, false, 'dashboard-light'],
  [JSON.stringify({ theme: 'dark', sync: false }), false, 'dashboard-dark'],
  [JSON.stringify({ theme: 'light', sync: false }), true, 'dashboard-light'],
  [JSON.stringify({ theme: 'light', sync: true }), true, 'dashboard-dark'],
  ['{not json', true, 'dashboard-dark']
]) {
  assert.equal(runBoot({ cache, osDark }), expected,
    `theme-boot cache=${cache} osDark=${osDark}`);
}

for (const file of ['../newtab/newtab.html', '../options/options.html']) {
  const html = read(file);
  assert.match(html, /<meta name="viewport"[^>]*>\s*<script src="\.\.\/lib\/theme-boot\.js"><\/script>/,
    `${file} loads theme-boot.js in <head> before stylesheets`);
  assert.ok(html.indexOf('theme-boot.js') < html.indexOf('rel="stylesheet"'),
    `${file} loads theme-boot.js before any stylesheet`);
}

console.log('modernist-theme.test.js: all assertions passed');
