/**
 * Content script fallback for sites that bypass declarativeNetRequest
 * This handles edge cases like x.com
 */

function normalizeDomain(domain) {
  return (domain || '').replace(/^www\./, '');
}

function isDomainMatch(currentDomain, domains = []) {
  return domains.some((site) => {
    const normalizedSite = normalizeDomain(site);
    return currentDomain === normalizedSite || currentDomain.endsWith(`.${normalizedSite}`);
  });
}

function getBlockedDomains(settings) {
  const blockedDomains = [...(settings.blockedSites || [])];

  for (const category of settings.categories || []) {
    if (!category?.enabled) {
      continue;
    }

    blockedDomains.push(...(category.sites || []));
  }

  return blockedDomains;
}

function isActiveUnblock(expiry, now) {
  return expiry === 'unlimited' || (typeof expiry === 'number' && expiry > now);
}

function hasActiveTempUnblock(settings, tempUnblocks, currentDomain, now) {
  const directExpiry = tempUnblocks.__all__ || tempUnblocks[currentDomain];
  if (isActiveUnblock(directExpiry, now)) {
    return true;
  }

  if (!settings.unblockAllBlockedSites) {
    return false;
  }

  return Object.entries(tempUnblocks).some(([domain, expiry]) => {
    return domain !== '__all__' && isActiveUnblock(expiry, now);
  });
}

let evaluationInFlight = false;
let pendingEvaluation = false;
let lastEvaluatedUrl = '';

async function evaluateCurrentUrl() {
  if (evaluationInFlight) {
    pendingEvaluation = true;
    return;
  }

  evaluationInFlight = true;

  try {
    const currentUrl = window.location.href;
    if (currentUrl === lastEvaluatedUrl) {
      return;
    }

    lastEvaluatedUrl = currentUrl;

    const currentDomain = normalizeDomain(window.location.hostname);
    const [{ tempUnblocks = {} }, settings, isWhitelisted] = await Promise.all([
      chrome.storage.local.get('tempUnblocks'),
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }),
      chrome.runtime.sendMessage({ type: 'IS_URL_WHITELISTED', url: currentUrl })
    ]);

    if (!settings || settings.error || !settings.enabled || isWhitelisted) {
      return;
    }

    if (hasActiveTempUnblock(settings, tempUnblocks, currentDomain, Date.now())) {
      return;
    }

    const shouldBlock = settings.mode === 'blocklist'
      ? isDomainMatch(currentDomain, getBlockedDomains(settings))
      : !isDomainMatch(currentDomain, settings.allowedSites);

    if (!shouldBlock) {
      return;
    }

    window.stop();
    const blockedPageUrl = chrome.runtime.getURL('blocked/blocked.html');
    window.location.replace(`${blockedPageUrl}?url=${encodeURIComponent(currentUrl)}`);
  } catch (e) {
    console.error('Focus Extension: redirect error', e);
  } finally {
    evaluationInFlight = false;
    if (pendingEvaluation) {
      pendingEvaluation = false;
      queueMicrotask(evaluateCurrentUrl);
    }
  }
}

function scheduleEvaluation() {
  queueMicrotask(evaluateCurrentUrl);
}

const originalPushState = history.pushState;
history.pushState = function(...args) {
  const result = originalPushState.apply(this, args);
  scheduleEvaluation();
  return result;
};

const originalReplaceState = history.replaceState;
history.replaceState = function(...args) {
  const result = originalReplaceState.apply(this, args);
  scheduleEvaluation();
  return result;
};

window.addEventListener('popstate', scheduleEvaluation);
window.addEventListener('hashchange', scheduleEvaluation);

scheduleEvaluation();
