# Agent notes

## Verification

- Node tests are plain `node tests/<name>.test.js` files (assert-based, no runner).
- `npm run preview` serves the new tab and Settings at http://localhost:4173 with a `chrome.*` shim.
- Browser checks can use the installed Google Chrome via `puppeteer-core` from a temp dir
  (`executablePath: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome`) — do not add
  it as a project dependency. The homepage check script loads it via the `PUPPETEER_CORE`
  env var, e.g. `mkdir /tmp/focus-checks && cd /tmp/focus-checks && npm i puppeteer-core`
  then `PUPPETEER_CORE=/tmp/focus-checks/node_modules/puppeteer-core node scripts/preview/browser-checks.mjs`
  (preview server must be running). Preview URL params: `?preview-now=2026-09-30T10:42` freezes the
  clock to match the reference mocks, `?preview-fixture=<name>` (dense, tiny, long, allday-many,
  cal-error, todoist-disconnected, …; see `scripts/preview/shim.js`), `?preview-theme=dark`.
- `scripts/measure-dashboard.mjs` needs `node --experimental-vm-modules` on Node 26.
- `tests/calendar-cache.test.js` fails outside UTC (pre-existing); run it with `TZ=UTC`.
- Homepage design references (v12 plan, overrides, 14 mockups) live in `.plans/`.
- Settings (`options/options.html`) is a plain single-column page — no sidebar or hash routing.

## Design

- Follow the user's Canada Modern reference by separating sections and rows with whitespace, not decorative horizontal dividers. Retain control outlines, focus rings, chart baselines, and vertical rails.
