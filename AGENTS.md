# Agent notes

## Verification

- Node tests are plain `node tests/<name>.test.js` files (assert-based, no runner).
- `npm run preview` serves all five surfaces at http://localhost:4173 with a `chrome.*` shim.
- Browser checks can use the installed Google Chrome via `puppeteer-core` from a temp dir
  (`executablePath: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome`) — do not add
  it as a project dependency.
- Options page sidebar links are rendered by JS after `DOMContentLoaded`, so a `#page-*` hash
  in the initial URL can be overwritten by the default page. To reach a section in automation,
  load the page, then click `.sidebar-link[data-page="page-..."]` (or set the hash afterwards).

## Design

- Follow the user's Canada Modern reference by separating sections and rows with whitespace, not decorative horizontal dividers. Retain control outlines, focus rings, chart baselines, and vertical rails.
