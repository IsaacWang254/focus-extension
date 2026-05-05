import assert from 'node:assert/strict';
import fs from 'node:fs';

const optionsSource = fs.readFileSync(new URL('./options/options.js', import.meta.url), 'utf8');

assert.match(
  optionsSource,
  /class="whitelist-url-text whitelist-url-link" href="\$\{escapeHtml\(safeHref\)\}"[^>]*target="_blank" rel="noopener noreferrer"/,
  'whitelisted URL entries should render as clickable links that open in a new tab'
);

assert.match(
  optionsSource,
  /if \(urlObj\.protocol === 'http:' \|\| urlObj\.protocol === 'https:'\) \{\s*safeHref = urlObj\.href;/,
  'whitelisted URL links must only be clickable for http/https URLs'
);

console.log('options whitelist link tests passed');
