import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function assertMetadata(actual, expected) {
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
}

function loadBlockedContentMetadataHarness(historyItems) {
  const source = fs.readFileSync(new URL('./background.js', import.meta.url), 'utf8');
  const start = source.indexOf('function normalizeHistoryLookupUrl');
  const end = source.indexOf('/**\n * Get browsing patterns by day of week');

  if (start === -1 || end === -1) {
    throw new Error('Unable to locate blocked content metadata helpers in background.js');
  }

  const sandbox = {
    URL,
    fetch: async () => ({ ok: false }),
    console,
    chrome: {
      history: {
        search: async () => historyItems
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(`${source.slice(start, end)}\nthis.getBlockedContentMetadata = getBlockedContentMetadata;`, sandbox);

  return sandbox.getBlockedContentMetadata;
}

async function testIgnoresNonExactHistoryTitles() {
  const getBlockedContentMetadata = loadBlockedContentMetadataHarness([
    {
      url: 'https://www.google.com/search?q=last+searched+thing',
      title: 'last searched thing - Google Search'
    }
  ]);

  const metadata = await getBlockedContentMetadata('https://www.reddit.com/r/productivity/comments/abc123/focus/');

  assertMetadata(metadata, { title: '', source: 'none' });
}

async function testUsesExactHistoryTitle() {
  const getBlockedContentMetadata = loadBlockedContentMetadataHarness([
    {
      url: 'https://www.reddit.com/r/productivity/comments/abc123/focus/',
      title: 'A useful productivity thread'
    }
  ]);

  const metadata = await getBlockedContentMetadata('https://www.reddit.com/r/productivity/comments/abc123/focus/');

  assertMetadata(metadata, { title: 'A useful productivity thread', source: 'history' });
}

await testIgnoresNonExactHistoryTitles();
await testUsesExactHistoryTitle();

console.log('blocked content metadata tests passed');
