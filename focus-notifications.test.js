import assert from 'node:assert/strict';
import fs from 'node:fs';

const backgroundSource = fs.readFileSync(new URL('./background.js', import.meta.url), 'utf8');
const contentSource = fs.readFileSync(new URL('./content-redirect.js', import.meta.url), 'utf8');
const optionsHtml = fs.readFileSync(new URL('./options/options.html', import.meta.url), 'utf8');
const manifestTemplate = JSON.parse(fs.readFileSync(new URL('./manifest.template.json', import.meta.url), 'utf8'));

assert.match(
  backgroundSource,
  /focusNotificationChannel:\s*'browser'/,
  'focus session notifications should default to browser toasts'
);

assert.match(
  backgroundSource,
  /SHOW_FOCUS_NOTIFICATION/,
  'background should dispatch focus notifications to browser tabs'
);

assert.match(
  backgroundSource,
  /chrome\.scripting\.executeScript/,
  'browser focus notifications should fall back to direct script injection when messaging fails'
);

assert.match(
  backgroundSource,
  /if \(normalizeFocusNotificationChannel\(settings\.focusNotificationChannel\) === 'desktop'\) \{[\s\S]*?sendDesktopFocusNotification\(title, message\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?await sendBrowserFocusNotification\(title, message\);/,
  'focus notifications should use desktop notifications only when the desktop channel is selected'
);

assert.match(
  contentSource,
  /SHOW_FOCUS_NOTIFICATION/,
  'content script should render browser focus notifications'
);

assert.match(
  backgroundSource,
  /#3f3f3f[\s\S]*#262626[\s\S]*#f1f1f1/,
  'injected browser notifications should use the graphite theme palette'
);

assert.match(
  contentSource,
  /#3f3f3f[\s\S]*#262626[\s\S]*#f1f1f1/,
  'content-script browser notifications should use the graphite theme palette'
);

assert.doesNotMatch(
  `${backgroundSource}\n${contentSource}`,
  /196, 181, 253|linear-gradient\(135deg, rgba\(17, 24, 39/,
  'browser notifications should not use the old purple gradient palette'
);

assert.match(
  optionsHtml,
  /id="focus-notification-channel"/,
  'settings should expose a focus notification channel option'
);

assert.match(
  optionsHtml,
  /Bypasses Do Not Disturb/,
  'settings should explain that the in-browser option bypasses normal desktop notifications'
);

assert.equal(
  manifestTemplate.content_scripts?.[0]?.matches?.[0],
  '<all_urls>',
  'browser focus notifications need content script coverage on normal web pages'
);

assert.ok(
  manifestTemplate.permissions?.includes('scripting'),
  'browser focus notifications need scripting permission for injection fallback'
);

console.log('focus notification tests passed');
