#!/usr/bin/env node
/**
 * Copies bundled WOFF2 variable fonts from Fontsource packages into lib/fonts.
 * Run after npm install: npm run copy-fonts
 */
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DEST = join(ROOT, 'lib', 'fonts');

const files = [
  ['@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2', 'inter-latin-ext-wght-normal.woff2'],
  ['@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', 'inter-latin-wght-normal.woff2'],
];

const firstSrc = join(ROOT, 'node_modules', files[0][0]);
if (!existsSync(firstSrc)) {
  console.warn(
    'copy-fonts: Fontsource packages not found (npm install with devDependencies). Using existing lib/fonts/ if present.'
  );
  process.exit(0);
}

mkdirSync(DEST, { recursive: true });
for (const [rel, name] of files) {
  copyFileSync(join(ROOT, 'node_modules', rel), join(DEST, name));
}
console.log('Copied', files.length, 'font files to lib/fonts/');
