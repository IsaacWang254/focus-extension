import assert from 'node:assert/strict';
import fs from 'node:fs';

const backgroundSource = fs.readFileSync(new URL('./background.js', import.meta.url), 'utf8');

assert.match(
  backgroundSource,
  /const SITE_INTERVENTION_ALARM = 'siteInterventionCheck';/,
  'site intervention monitor alarm should be defined'
);

assert.match(
  backgroundSource,
  /minutesSpent < SITE_INTERVENTION_TIME_THRESHOLD_MINUTES && visitCount < SITE_INTERVENTION_VISIT_THRESHOLD/,
  'prompts should be gated by time spent or visit count thresholds'
);

assert.match(
  backgroundSource,
  /if \(action === 'block'\) \{[\s\S]*?await addBlockedSite\(domain\);[\s\S]*?await redirectMatchingDomainTabsIfNeeded\(\[domain\], 'intervention-block'\);/,
  'distracting-site prompt actions should add the site to the blocklist and enforce it immediately'
);

assert.match(
  backgroundSource,
  /if \(action === 'focus'\) \{[\s\S]*?await startFocusSession\('pomodoro'\);/,
  'productive-site prompt actions should start a focus session'
);

assert.match(
  backgroundSource,
  /chrome\.notifications\.onButtonClicked\.addListener\(async \(notificationId, buttonIndex\) => \{[\s\S]*?parseSiteInterventionNotificationId\(notificationId\)/,
  'intervention prompts should handle notification button actions'
);

assert.match(
  backgroundSource,
  /} else if \(alarm\.name === SITE_INTERVENTION_ALARM\) \{\s*\n\s*await queueSiteInterventionCheck\(\);/,
  'site intervention checks should run from an alarm tick'
);

console.log('site intervention prompt tests passed');
