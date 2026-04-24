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
let embedScanScheduled = false;
let embedObserverStarted = false;
let activeBlockedMediaNotice = null;
let blockedMediaNoticeTimeoutId = null;

const EMBED_SOURCE_SELECTORS = 'iframe, video, audio, embed, object';
const EMBED_ATTRIBUTION_SELECTORS = 'a[href], [data-href], [data-url], [data-video-url], meta[itemprop="url"], meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"]';
const EMBED_BLOCK_MARKER = 'data-focus-extension-embed-blocked';
const EMBED_GUARD_MARKER = 'data-focus-extension-embed-guarded';
const EMBED_ALIAS_MAP = {
  'youtube.com': ['youtu.be', 'youtube-nocookie.com', 'googlevideo.com', 'ytimg.com'],
  'youtu.be': ['youtube.com', 'youtube-nocookie.com', 'googlevideo.com', 'ytimg.com'],
  'youtube-nocookie.com': ['youtube.com', 'youtu.be', 'googlevideo.com', 'ytimg.com'],
  'x.com': ['twitter.com', 'platform.twitter.com', 'syndication.twitter.com', 'twimg.com'],
  'twitter.com': ['x.com', 'platform.twitter.com', 'syndication.twitter.com', 'twimg.com'],
  'vimeo.com': ['player.vimeo.com', 'i.vimeocdn.com']
};

function shouldSkipEmbeddedMediaHandling() {
  const currentDomain = normalizeDomain(window.location.hostname);
  if (currentDomain !== 'google.com' && !currentDomain.endsWith('.google.com')) {
    return false;
  }

  const searchParams = new URLSearchParams(window.location.search);
  return searchParams.has('q');
}

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

function parseCandidateUrl(candidate) {
  if (typeof candidate !== 'string') {
    return null;
  }

  const trimmedCandidate = candidate.trim();
  if (!trimmedCandidate || trimmedCandidate.startsWith('data:') || trimmedCandidate.startsWith('blob:')) {
    return null;
  }

  try {
    const parsedUrl = new URL(trimmedCandidate, window.location.href);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return null;
    }

    return parsedUrl.href;
  } catch {
    return null;
  }
}

function getElementUrlCandidates(element) {
  if (!(element instanceof Element)) {
    return [];
  }

  const candidates = new Set();
  const attributeNames = ['src', 'href', 'data', 'poster', 'content'];

  for (const attributeName of attributeNames) {
    const attributeValue = element.getAttribute(attributeName);
    const parsedUrl = parseCandidateUrl(attributeValue);
    if (parsedUrl) {
      candidates.add(parsedUrl);
    }
  }

  for (const [key, value] of Object.entries(element.dataset || {})) {
    if (!/url|src|video|embed|player|watch/i.test(key)) {
      continue;
    }

    const parsedUrl = parseCandidateUrl(value);
    if (parsedUrl) {
      candidates.add(parsedUrl);
    }
  }

  return [...candidates];
}

function getEmbedContextCandidates(embedElement) {
  const candidates = new Set(getElementUrlCandidates(embedElement));
  const ownerElement = embedElement.tagName === 'SOURCE'
    ? embedElement.closest('video, audio')
    : embedElement;

  if (ownerElement) {
    for (const element of ownerElement.querySelectorAll('source, track')) {
      for (const candidate of getElementUrlCandidates(element)) {
        candidates.add(candidate);
      }
    }
  }

  let container = embedElement.closest('figure, article, section, li, [role="dialog"], [role="region"]');
  if (!container) {
    container = embedElement.parentElement;
  }

  if (container) {
    for (const element of container.querySelectorAll(EMBED_ATTRIBUTION_SELECTORS)) {
      for (const candidate of getElementUrlCandidates(element)) {
        candidates.add(candidate);
      }
    }
  }

  return [...candidates];
}

function getBlockedDomainForCandidateUrl(url, settings) {
  try {
    const candidateDomain = normalizeDomain(new URL(url).hostname);
    if (!candidateDomain) {
      return null;
    }

    if (settings.mode === 'blocklist') {
      for (const blockedDomain of getBlockedDomains(settings)) {
        const normalizedBlockedDomain = normalizeDomain(blockedDomain);
        const candidateMatchers = [normalizedBlockedDomain, ...(EMBED_ALIAS_MAP[normalizedBlockedDomain] || [])];
        const isMatch = candidateMatchers.some((domain) => {
          const normalizedMatcher = normalizeDomain(domain);
          return candidateDomain === normalizedMatcher || candidateDomain.endsWith(`.${normalizedMatcher}`);
        });

        if (isMatch) {
          return normalizedBlockedDomain;
        }
      }

      return null;
    }

    return isDomainMatch(candidateDomain, settings.allowedSites || [])
      ? null
      : candidateDomain;
  } catch {
    return null;
  }
}

function createBlockedEmbedNotice(blockedDomain) {
  const notice = document.createElement('div');
  notice.setAttribute(EMBED_BLOCK_MARKER, 'true');
  notice.style.display = 'flex';
  notice.style.alignItems = 'center';
  notice.style.justifyContent = 'center';
  notice.style.flexDirection = 'column';
  notice.style.gap = '8px';
  notice.style.width = '100%';
  notice.style.minHeight = '180px';
  notice.style.padding = '20px';
  notice.style.boxSizing = 'border-box';
  notice.style.borderRadius = '12px';
  notice.style.border = '1px solid rgba(255, 255, 255, 0.12)';
  notice.style.background = 'linear-gradient(180deg, rgba(14, 18, 25, 0.94), rgba(8, 11, 16, 0.98))';
  notice.style.color = '#f4f7fb';
  notice.style.fontFamily = 'Inter, system-ui, sans-serif';
  notice.style.textAlign = 'center';
  notice.style.lineHeight = '1.4';
  notice.innerHTML = `
    <strong style="font-size: 15px;">Embedded content blocked</strong>
    <span style="font-size: 13px; opacity: 0.82;">This media appears to come from ${blockedDomain}.</span>
  `;
  return notice;
}

function showBlockedMediaNotice(blockedDomain) {
  if (blockedMediaNoticeTimeoutId) {
    window.clearTimeout(blockedMediaNoticeTimeoutId);
    blockedMediaNoticeTimeoutId = null;
  }

  if (activeBlockedMediaNotice?.isConnected) {
    activeBlockedMediaNotice.remove();
  }

  const notice = createBlockedEmbedNotice(blockedDomain);
  notice.style.position = 'fixed';
  notice.style.right = '20px';
  notice.style.bottom = '20px';
  notice.style.width = 'min(360px, calc(100vw - 32px))';
  notice.style.minHeight = '0';
  notice.style.maxWidth = 'calc(100vw - 32px)';
  notice.style.padding = '16px 18px';
  notice.style.borderRadius = '16px';
  notice.style.boxShadow = '0 16px 40px rgba(0, 0, 0, 0.35)';
  notice.style.zIndex = '2147483647';
  notice.style.pointerEvents = 'auto';

  document.body.appendChild(notice);
  activeBlockedMediaNotice = notice;

  blockedMediaNoticeTimeoutId = window.setTimeout(() => {
    if (activeBlockedMediaNotice === notice) {
      activeBlockedMediaNotice = null;
    }
    notice.remove();
    blockedMediaNoticeTimeoutId = null;
  }, 3200);
}

function isBlockedEmbedGuarded(element) {
  return element?.getAttribute?.(EMBED_GUARD_MARKER) === 'true';
}

function armMediaPlaybackBlock(mediaElement, blockedDomain) {
  if (!(mediaElement instanceof HTMLMediaElement) || isBlockedEmbedGuarded(mediaElement)) {
    return;
  }

  mediaElement.setAttribute(EMBED_GUARD_MARKER, 'true');

  mediaElement.addEventListener('play', () => {
    mediaElement.pause();
    mediaElement.currentTime = 0;
    showBlockedMediaNotice(blockedDomain);
  }, { once: true });
}

async function findBlockedDomainForEmbed(embedElement, settings, tempUnblocks, now) {
  if (!(embedElement instanceof HTMLElement)) {
    return null;
  }

  const candidates = getEmbedContextCandidates(embedElement);

  for (const candidateUrl of candidates) {
    const directMatch = getBlockedDomainForCandidateUrl(candidateUrl, settings);
    if (!directMatch) {
      continue;
    }

    const isWhitelisted = await chrome.runtime.sendMessage({
      type: 'IS_URL_WHITELISTED',
      url: candidateUrl
    });

    if (isWhitelisted || hasActiveTempUnblock(settings, tempUnblocks, directMatch, now)) {
      continue;
    }

    return directMatch;
  }

  return null;
}

async function maybeBlockEmbeddedContent(settings, tempUnblocks) {
  return;
}

async function refreshBlockingState() {
  const [{ tempUnblocks = {} }, settings] = await Promise.all([
    chrome.storage.local.get('tempUnblocks'),
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' })
  ]);

  await maybeBlockEmbeddedContent(settings, tempUnblocks);
}

function scheduleEmbedScan() {
  if (embedScanScheduled) {
    return;
  }

  embedScanScheduled = true;
  window.setTimeout(async () => {
    embedScanScheduled = false;

    try {
      await refreshBlockingState();
    } catch (error) {
      console.error('Focus Extension: embedded content scan error', error);
    }
  }, 60);
}

function startEmbedObserver() {
  if (embedObserverStarted) {
    return;
  }

  embedObserverStarted = true;
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && (mutation.addedNodes.length || mutation.removedNodes.length)) {
        scheduleEmbedScan();
        return;
      }

      if (mutation.type === 'attributes') {
        scheduleEmbedScan();
        return;
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'href', 'data', 'poster']
  });
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
  scheduleEmbedScan();
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

startEmbedObserver();
scheduleEvaluation();
