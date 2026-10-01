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
  assert.match(html, /<link rel="icon" type="image\/png" href="\.\.\/icons\/icon16\.png">/, `${file} uses the brand PNG favicon`);
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

for (const [file, w, h] of [
  ['../icons/icon16.svg', 16, 16],
  ['../icons/icon48.svg', 48, 48],
  ['../icons/icon128.svg', 128, 128]
]) {
  const svg = read(file);
  assert.match(svg, /#E5342A/i, `${file} carries the brand red`);
  assert.match(svg, /#F7F5EF/i, `${file} carries the paper tone`);
  assert.doesNotMatch(svg, /#18181B|#F59E0B|#FFFFFF/i, `${file} must not keep old black/amber/white`);
  assert.match(svg, new RegExp(`width="${w}" height="${h}"`), `${file} dimensions intact`);
}

const pngSize = (rel) => {
  const buf = fs.readFileSync(new URL(rel, import.meta.url));
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${rel} is a PNG`);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
};
for (const [rel, w, h] of [
  ['../icons/icon16.png', 16, 16],
  ['../icons/icon48.png', 48, 48],
  ['../icons/icon128.png', 128, 128]
]) {
  const { w: pw, h: ph } = pngSize(rel);
  assert.equal(pw, w, `${rel} width`);
  assert.equal(ph, h, `${rel} height`);
}

assert.match(read('../manifest.json'), /icons\/icon128\.png/, 'manifest points at the regenerated PNG set');

console.log('modernist-theme.test.js: all assertions passed');
