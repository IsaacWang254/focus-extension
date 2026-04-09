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
let categoryScanInFlight = false;
let scheduledCategoryScanDomain = '';

function trimText(text, maxLength) {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3)}...`
    : normalized;
}

function collectCategoryScanPayload(domain, url) {
  const contentRoot = document.querySelector('main, article, [role="main"]') || document.body;
  const title = trimText(document.title, 160);
  const description = trimText(
    document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
    280
  );
  const headings = trimText(
    Array.from(document.querySelectorAll('h1, h2'))
      .slice(0, 3)
      .map((element) => trimText(element.textContent || '', 120))
      .filter((text) => text.length >= 12)
      .join(' '),
    260
  );
  const snippet = trimText(
    Array.from(contentRoot.querySelectorAll('p'))
      .slice(0, 4)
      .map((element) => trimText(element.textContent || '', 320))
      .filter((text) => text.length >= 32)
      .join(' '),
    1200
  );

  return {
    domain,
    url,
    title,
    description,
    headings,
    snippet
  };
}

async function waitForCategoryScanReady() {
  if (document.readyState === 'loading') {
    await new Promise((resolve) => {
      document.addEventListener('DOMContentLoaded', resolve, { once: true });
    });
  }

  await new Promise(resolve => setTimeout(resolve, 450));
}

async function maybeRunCategoryScan(settings, domain, url) {
  if (categoryScanInFlight || !settings || settings.historyAnalysisEnabled === false) {
    return;
  }

  if (!domain || domain === scheduledCategoryScanDomain) {
    return;
  }

  categoryScanInFlight = true;
  scheduledCategoryScanDomain = domain;

  try {
    const status = await chrome.runtime.sendMessage({
      type: 'GET_SITE_CATEGORY_SCAN_STATUS',
      domain
    });

    if (!status?.shouldScan) {
      return;
    }

    await waitForCategoryScanReady();

    const payload = collectCategoryScanPayload(domain, url);
    await chrome.runtime.sendMessage({
      type: 'SAVE_SITE_CATEGORY_CONTENT_SCAN',
      payload
    });
  } catch (error) {
    console.error('Focus Extension: site category scan error', error);
  } finally {
    categoryScanInFlight = false;
  }
}

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
      if (settings && !settings.error && settings.enabled && isWhitelisted) {
        queueMicrotask(() => maybeRunCategoryScan(settings, currentDomain, currentUrl));
      }
      return;
    }

    if (hasActiveTempUnblock(settings, tempUnblocks, currentDomain, Date.now())) {
      queueMicrotask(() => maybeRunCategoryScan(settings, currentDomain, currentUrl));
      return;
    }

    const shouldBlock = settings.mode === 'blocklist'
      ? isDomainMatch(currentDomain, getBlockedDomains(settings))
      : !isDomainMatch(currentDomain, settings.allowedSites);

    if (!shouldBlock) {
      queueMicrotask(() => maybeRunCategoryScan(settings, currentDomain, currentUrl));
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
