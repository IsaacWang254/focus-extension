import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

const iconsSource = read('../lib/icons.js');
const iconSandbox = { window: {}, console };
vm.createContext(iconSandbox);
vm.runInContext(`${iconsSource}\nthis.icons = Icons;`, iconSandbox);
const Icons = iconSandbox.icons;

const newtabSource = read('../newtab/newtab.js');
const wiStart = newtabSource.indexOf('function getWeatherInfo');
const wiEnd = newtabSource.indexOf('async function getCoordinates');
assert.notEqual(wiStart, -1, 'getWeatherInfo anchor missing');
assert.notEqual(wiEnd, -1, 'getCoordinates anchor missing');
const wiSandbox = {};
vm.createContext(wiSandbox);
vm.runInContext(`${newtabSource.slice(wiStart, wiEnd)}\nthis.getWeatherInfo = getWeatherInfo;`, wiSandbox);
const getWeatherInfo = wiSandbox.getWeatherInfo;

assert.equal(getWeatherInfo(0, 1).icon, 'sun');
assert.equal(getWeatherInfo(0, 0).icon, 'moon');
assert.equal(getWeatherInfo(1, 1).icon, 'partlyCloudy');
assert.equal(getWeatherInfo(1, 0).icon, 'partlyCloudyNight');
assert.equal(getWeatherInfo(2, 1).icon, 'partlyCloudy');
assert.equal(getWeatherInfo(2, 0).icon, 'partlyCloudyNight');
assert.equal(getWeatherInfo(1, 1).desc, 'Mostly clear');
assert.equal(getWeatherInfo(2, 1).desc, 'Partly cloudy');
assert.equal(getWeatherInfo(0, 1).desc, 'Clear');

const expected = {
  3: 'cloud', 45: 'cloudFog', 48: 'cloudFog',
  51: 'cloudRain', 53: 'cloudRain', 55: 'cloudRain',
  61: 'cloudRain', 63: 'cloudRain', 65: 'cloudRain',
  80: 'cloudRain', 81: 'cloudRain', 82: 'cloudRain',
  71: 'cloudSnow', 73: 'cloudSnow', 75: 'cloudSnow', 77: 'cloudSnow',
  85: 'cloudSnow', 86: 'cloudSnow',
  95: 'cloudLightning', 96: 'cloudLightning', 99: 'cloudLightning',
};
for (const [code, icon] of Object.entries(expected)) {
  for (const isDay of [1, 0]) {
    const info = getWeatherInfo(Number(code), isDay);
    assert.equal(info.icon, icon, `code ${code} day=${isDay}`);
    assert.ok(Icons[info.icon] && Icons[info.icon].length > 0, `icon ${info.icon} exists`);
  }
}
for (const code of [-1, 999]) {
  const info = getWeatherInfo(code, 1);
  assert.equal(info.icon, 'cloud');
  assert.equal(info.desc, 'Unknown');
}

const weatherKeys = ['sun', 'moon', 'cloud', 'partlyCloudy', 'partlyCloudyNight', 'cloudRain', 'cloudSnow', 'cloudLightning', 'cloudFog'];
for (const key of weatherKeys) {
  const svg = Icons[key];
  assert.ok(svg, `Icons.${key} exists`);
  assert.match(svg, /viewBox="0 0 24 24"/, `${key} 24px viewBox`);
  assert.match(svg, /fill="none"/, `${key} fill none`);
  assert.match(svg, /stroke="currentColor"/, `${key} strokes currentColor`);
  assert.doesNotMatch(svg, /<image|<script|url\(|<use/, `${key} has no external refs`);
}
const newSeven = ['cloud', 'partlyCloudy', 'partlyCloudyNight', 'cloudRain', 'cloudSnow', 'cloudLightning', 'cloudFog'];
for (const key of newSeven) {
  assert.match(Icons[key], /stroke-width="1\.5"/, `${key} stroke-width 1.5`);
}
const distinct = new Set(newSeven.map((k) => Icons[k]));
assert.equal(distinct.size, newSeven.length, 'all seven new weather glyphs are distinct');
assert.notEqual(Icons.partlyCloudy, Icons.partlyCloudyNight, 'day and night partly-cloudy differ');

assert.match(Icons.sun, /<circle/, 'Icons.sun baseline circle retained');
assert.match(Icons.moon, /M21 12\.79A9 9 0 1 1 11\.21 3/, 'Icons.moon baseline path retained');

const modernistCss = read('../lib/modernist.css');
assert.match(
  modernistCss,
  /\[data-surface="newtab"\]\s+\.weather-icon\s*\{[^}]*color:\s*var\(--foreground\)/s,
  'weather icon uses the neutral foreground token'
);
assert.match(
  modernistCss,
  /\[data-surface="newtab"\]\s+\.weather-icon\s+svg\s*\{[^}]*width:\s*32px[^}]*stroke-width:\s*1\.5/s,
  'weather svg sized 32px at stroke 1.5'
);

const newtabHtml = read('../newtab/newtab.html');
assert.match(newtabHtml, /<span class="weather-icon" id="weather-icon" aria-hidden="true">/, 'weather icon span is aria-hidden');
assert.doesNotMatch(newtabHtml, /weather-icon[^>]*title=/, 'weather icon has no title');

console.log('newtab-weather-icons.test.js: all assertions passed');
