/**
 * Static preview server for the extension's UI surfaces.
 *
 * Serves the repo root and injects scripts/preview/shim.js into the pages
 * that require a chrome.* context (blocked, options, newtab), so every
 * surface can be opened in a normal browser:
 *
 *   node scripts/preview/serve.mjs [port]
 *
 *   http://localhost:4173/newtab/newtab.html
 *   http://localhost:4173/blocked/blocked.html?url=https%3A%2F%2Fx.com%2Fhome
 *   http://localhost:4173/options/options.html
 *   http://localhost:4173/popup/popup.html        (built-in preview fixtures)
 *   http://localhost:4173/stats/stats.html        (built-in preview fixtures)
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const port = Number(process.argv[2]) || 4173;

const SHIMMED_PAGES = ['/blocked/blocked.html', '/options/options.html', '/newtab/newtab.html'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon'
};

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/newtab/newtab.html';

    const filePath = normalize(join(root, pathname));
    if (!filePath.startsWith(root)) { res.writeHead(403).end(); return; }

    let body = await readFile(filePath);
    const type = MIME[extname(filePath)] || 'application/octet-stream';

    const wantsShim = SHIMMED_PAGES.includes(pathname) || url.searchParams.get('shim') === '1';
    if (pathname.endsWith('.html') && wantsShim && url.searchParams.get('shim') !== '0') {
      body = body.toString().replace('<head>', '<head>\n  <script src="/scripts/preview/shim.js"></script>');
    }

    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain' });
    res.end(String(err.message || err));
  }
}).listen(port, () => {
  console.log(`Preview server running at http://localhost:${port}`);
});
