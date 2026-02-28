#!/usr/bin/env node
/**
 * Build local config files from .env
 *
 * Reads environment variables (or .env via dotenv) and generates:
 *   - manifest.json (from manifest.template.json)
 *   - lib/config.js (from lib/config.template.js)
 *   - worker/wrangler.toml (from worker/wrangler.template.toml)
 *
 * Run: npm run build:local
 * Requires: GOOGLE_OAUTH_CLIENT_ID, TODOIST_CLIENT_ID, TOKEN_PROXY_URL
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

dotenv.config({ path: join(ROOT, '.env') });

const GOOGLE = process.env.GOOGLE_OAUTH_CLIENT_ID;
const TODOIST_ID = process.env.TODOIST_CLIENT_ID;
const PROXY_URL = process.env.TOKEN_PROXY_URL;

const missing = [];
if (!GOOGLE) missing.push('GOOGLE_OAUTH_CLIENT_ID');
if (!TODOIST_ID) missing.push('TODOIST_CLIENT_ID');
if (!PROXY_URL) missing.push('TOKEN_PROXY_URL');

if (missing.length) {
  console.error('Missing required env vars. Add them to .env or export before running:');
  missing.forEach((m) => console.error('  -', m));
  console.error('\nCopy .env.example to .env and fill in your values.');
  process.exit(1);
}

function replaceAll(str, map) {
  let out = str;
  for (const [key, val] of Object.entries(map)) {
    out = out.split(key).join(val);
  }
  return out;
}

const replacements = {
  __GOOGLE_OAUTH_CLIENT_ID__: GOOGLE,
  __TODOIST_CLIENT_ID__: TODOIST_ID,
  __TOKEN_PROXY_URL__: PROXY_URL,
};

// manifest.json
const manifestTpl = readFileSync(join(ROOT, 'manifest.template.json'), 'utf8');
writeFileSync(join(ROOT, 'manifest.json'), replaceAll(manifestTpl, replacements));
console.log('Wrote manifest.json');

// lib/config.js
const configTpl = readFileSync(join(ROOT, 'lib', 'config.template.js'), 'utf8');
writeFileSync(join(ROOT, 'lib', 'config.js'), replaceAll(configTpl, replacements));
console.log('Wrote lib/config.js');

// worker/wrangler.toml
const wranglerTpl = readFileSync(join(ROOT, 'worker', 'wrangler.template.toml'), 'utf8');
writeFileSync(join(ROOT, 'worker', 'wrangler.toml'), replaceAll(wranglerTpl, replacements));
console.log('Wrote worker/wrangler.toml');

console.log('\nDone. Load the extension from this folder in chrome://extensions');
