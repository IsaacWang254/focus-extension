/**
 * Content script fallback for sites that bypass declarativeNetRequest
 * This handles edge cases like x.com
 */

// Run immediately - don't wait for anything
(async function() {
  try {
    // Get current domain
    const currentDomain = window.location.hostname.replace(/^www\./, '');
    
    // Get settings from storage
    const result = await chrome.storage.local.get(['settings', 'tempUnblocks']);
    const settings = result.settings;
    const tempUnblocks = result.tempUnblocks || {};
    
    if (!settings || !settings.enabled) return;
    
    // Check for temporary unblock first
    const unblockExpiry = tempUnblocks[currentDomain];
    if (unblockExpiry) {
      // Check if unlimited or not yet expired
      if (unblockExpiry === 'unlimited' || unblockExpiry > Date.now()) {
        return; // Site is temporarily unblocked
      }
    }
    
    // Check if current site should be blocked
    let shouldBlock = false;
    
    if (settings.mode === 'blocklist') {
      shouldBlock = settings.blockedSites.some(site => {
        const blockedDomain = site.replace(/^www\./, '');
        return currentDomain === blockedDomain || currentDomain.endsWith('.' + blockedDomain);
      });
    } else {
      // Allowlist mode - block unless explicitly allowed
      shouldBlock = !settings.allowedSites.some(site => {
        const allowedDomain = site.replace(/^www\./, '');
        return currentDomain === allowedDomain || currentDomain.endsWith('.' + allowedDomain);
      });
    }
    
    if (shouldBlock) {
      // Stop the page from loading further
      window.stop();
      
      // Redirect to blocked page with full original URL
      const blockedPageUrl = chrome.runtime.getURL('blocked/blocked.html');
      const fullUrl = window.location.href;
      window.location.replace(`${blockedPageUrl}?url=${encodeURIComponent(fullUrl)}`);
    }
  } catch (e) {
    console.error('Focus Extension: redirect error', e);
  }
})();
