/**
 * Content script fallback for sites that bypass declarativeNetRequest
 * This handles edge cases like x.com
 */

(() => {
  if (globalThis.__focusBlockingInitialized) {
    return;
  }
  globalThis.__focusBlockingInitialized = true;

  function normalizeDomain(domain) {
    return (domain || '').replace(/^www\./, '');
  }

  function isTopLevelFrame() {
    try {
      return window.top === window;
    } catch {
      return true;
    }
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
  let evaluationReason = 'navigation';
  let blockedPageHost = null;
  let blockedPageUrl = '';
  let blockedPageObserver = null;
  let blockedPageDialog = null;
  let blockedPageRenderId = '';
  let blockedPageFrame = null;
  let blockedPageLoading = null;
  let blockedPageReady = false;
  let blockedPageLoadTimer = null;
  let blockedPageScrollLock = null;
  let categoryScanInFlight = false;
  let scheduledCategoryScanDomain = '';
  let embedScanScheduled = false;
  let embedObserverStarted = false;
  let contentContextInvalidated = false;
  let embedObserver = null;
  let embedScanTimeoutId = null;
  let activeBlockedMediaNotice = null;
  let blockedMediaNoticeTimeoutId = null;
  let lastBlockedEmbedInteractionAt = 0;
  let activeFocusNotification = null;
  let focusNotificationTimeoutId = null;

  const EMBED_SOURCE_SELECTORS = 'iframe, video, audio, embed, object';
  const EMBED_ATTRIBUTION_SELECTORS = 'a[href], [data-href], [data-url], [data-video-url], meta[itemprop="url"], meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"]';
  const EMBED_BLOCK_MARKER = 'data-focus-extension-embed-blocked';
  const EMBED_GUARD_MARKER = 'data-focus-extension-embed-guarded';
  const EMBED_WRAPPER_MARKER = 'data-focus-extension-embed-wrapper';
  const EMBED_ALIAS_MAP = {
    'youtube.com': ['youtu.be', 'youtube-nocookie.com', 'googlevideo.com', 'ytimg.com'],
    'youtu.be': ['youtube.com', 'youtube-nocookie.com', 'googlevideo.com', 'ytimg.com'],
    'youtube-nocookie.com': ['youtube.com', 'youtu.be', 'googlevideo.com', 'ytimg.com'],
    'x.com': ['twitter.com', 'platform.twitter.com', 'syndication.twitter.com', 'twimg.com'],
    'twitter.com': ['x.com', 'platform.twitter.com', 'syndication.twitter.com', 'twimg.com'],
    'vimeo.com': ['player.vimeo.com', 'i.vimeocdn.com']
  };

  function showFocusBrowserNotification({ title, message }) {
    if (!isTopLevelFrame()) {
      return;
    }

    if (focusNotificationTimeoutId) {
      clearTimeout(focusNotificationTimeoutId);
      focusNotificationTimeoutId = null;
    }

    activeFocusNotification?.remove();

    const notification = document.createElement('div');
    notification.setAttribute('role', 'status');
    notification.setAttribute('aria-live', 'polite');
    notification.style.position = 'fixed';
    notification.style.top = '20px';
    notification.style.right = '20px';
    notification.style.zIndex = '2147483647';
    notification.style.boxSizing = 'border-box';
    notification.style.display = 'flex';
    notification.style.flexDirection = 'column';
    notification.style.gap = '6px';
    notification.style.maxWidth = '340px';
    notification.style.padding = '16px 18px';
    notification.style.border = '1px solid #3f3f3f';
    notification.style.borderRadius = '14px';
    notification.style.background = '#262626';
    notification.style.color = '#f1f1f1';
    notification.style.boxShadow = '0 18px 42px rgba(0, 0, 0, 0.24)';
    notification.style.fontFamily = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    notification.style.pointerEvents = 'none';
    notification.style.transform = 'translateY(-8px)';
    notification.style.opacity = '0';
    notification.style.transition = 'opacity 180ms ease, transform 180ms ease';

    const label = document.createElement('span');
    label.textContent = 'Focus timer';
    label.style.fontSize = '11px';
    label.style.fontWeight = '700';
    label.style.letterSpacing = '0.08em';
    label.style.textTransform = 'uppercase';
    label.style.color = '#a3a3a3';

    const titleEl = document.createElement('strong');
    titleEl.textContent = trimText(title || 'Timer update', 90);
    titleEl.style.fontSize = '16px';
    titleEl.style.lineHeight = '1.25';
    titleEl.style.fontWeight = '750';

    const messageEl = document.createElement('span');
    messageEl.textContent = trimText(message || '', 180);
    messageEl.style.fontSize = '13px';
    messageEl.style.lineHeight = '1.45';
    messageEl.style.color = '#a3a3a3';

    notification.append(label, titleEl, messageEl);
    (document.body || document.documentElement).appendChild(notification);
    activeFocusNotification = notification;

    requestAnimationFrame(() => {
      notification.style.opacity = '1';
      notification.style.transform = 'translateY(0)';
    });

    focusNotificationTimeoutId = setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transform = 'translateY(-8px)';
      setTimeout(() => {
        notification.remove();
        if (activeFocusNotification === notification) {
          activeFocusNotification = null;
        }
      }, 220);
    }, 6500);
  }

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

  function noteBlockedEmbedInteraction() {
    lastBlockedEmbedInteractionAt = Date.now();
  }

  async function trackBlockedEmbeddedAttempt(currentUrl) {
    if (!hasActiveExtensionContext() || !currentUrl) {
      return;
    }

    try {
      await chrome.runtime.sendMessage({
        type: 'TRACK_BLOCK_ATTEMPT',
        context: 'embedded_play'
      });
    } catch (error) {
      handleContentScriptError('Focus Extension: failed to track blocked embedded attempt', error);
    }
  }

  function createBlockedEmbedFrame(blockedUrl) {
    const blockedPageUrl = chrome.runtime.getURL('blocked/blocked.html');
    const iframe = document.createElement('iframe');
    iframe.src = `${blockedPageUrl}?url=${encodeURIComponent(blockedUrl)}`;
    iframe.setAttribute(EMBED_BLOCK_MARKER, 'true');
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = '0';
    iframe.style.display = 'block';
    iframe.style.borderRadius = 'inherit';
    iframe.style.background = 'transparent';
    return iframe;
  }

  function replaceEmbedWithBlockedFrame(ownerElement, blockedUrl) {
    if (!(ownerElement instanceof HTMLElement) || !blockedUrl) {
      return;
    }

    const rect = ownerElement.getBoundingClientRect();
    const wrapper = document.createElement('div');
    wrapper.setAttribute(EMBED_BLOCK_MARKER, 'true');
    wrapper.setAttribute(EMBED_WRAPPER_MARKER, 'true');
    wrapper.style.position = 'relative';
    wrapper.style.display = 'block';
    wrapper.style.width = rect.width > 0 ? `${rect.width}px` : ownerElement.style.width || '100%';
    wrapper.style.height = rect.height > 0 ? `${rect.height}px` : ownerElement.style.height || '315px';
    wrapper.style.maxWidth = '100%';
    wrapper.style.overflow = 'hidden';
    wrapper.style.borderRadius = window.getComputedStyle(ownerElement).borderRadius || '12px';

    const blockedFrame = createBlockedEmbedFrame(blockedUrl);
    wrapper.appendChild(blockedFrame);
    ownerElement.replaceWith(wrapper);
  }

  function armFramedEmbedBlock(embedElement, blockedUrl, blockedDomain) {
    if (!(embedElement instanceof HTMLElement) || isBlockedEmbedGuarded(embedElement)) {
      return;
    }

    const rect = embedElement.getBoundingClientRect();
    const wrapper = document.createElement('div');
    const overlay = document.createElement('button');
    const computedStyle = window.getComputedStyle(embedElement);

    wrapper.setAttribute(EMBED_WRAPPER_MARKER, 'true');
    wrapper.style.position = 'relative';
    wrapper.style.display = computedStyle.display === 'inline' ? 'inline-block' : computedStyle.display;
    wrapper.style.width = rect.width > 0 ? `${rect.width}px` : computedStyle.width;
    wrapper.style.height = rect.height > 0 ? `${rect.height}px` : computedStyle.height;
    wrapper.style.maxWidth = '100%';
    wrapper.style.borderRadius = computedStyle.borderRadius || '12px';
    wrapper.style.overflow = 'hidden';

    overlay.type = 'button';
    overlay.setAttribute('aria-label', `Play blocked media from ${blockedDomain}`);
    overlay.setAttribute(EMBED_GUARD_MARKER, 'true');
    overlay.style.position = 'absolute';
    overlay.style.inset = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.border = '0';
    overlay.style.padding = '0';
    overlay.style.margin = '0';
    overlay.style.background = 'transparent';
    overlay.style.cursor = 'pointer';
    overlay.style.zIndex = '2';

    embedElement.setAttribute(EMBED_GUARD_MARKER, 'true');
    overlay.addEventListener('pointerdown', noteBlockedEmbedInteraction, true);
    overlay.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await trackBlockedEmbeddedAttempt(blockedUrl);
      replaceEmbedWithBlockedFrame(wrapper, blockedUrl);
      showBlockedMediaNotice(blockedDomain);
    }, { capture: true, once: true });

    embedElement.replaceWith(wrapper);
    wrapper.appendChild(embedElement);
    wrapper.appendChild(overlay);
  }

  function armMediaPlaybackBlock(mediaElement, blockedUrl, blockedDomain) {
    if (!(mediaElement instanceof HTMLMediaElement) || isBlockedEmbedGuarded(mediaElement)) {
      return;
    }

    mediaElement.setAttribute(EMBED_GUARD_MARKER, 'true');
    mediaElement.addEventListener('pointerdown', noteBlockedEmbedInteraction, true);
    mediaElement.addEventListener('keydown', noteBlockedEmbedInteraction, true);

    mediaElement.addEventListener('play', async () => {
      mediaElement.pause();
      try {
        mediaElement.currentTime = 0;
      } catch {
        // Some media elements do not allow seeking yet.
      }

      const wasUserInitiated = Date.now() - lastBlockedEmbedInteractionAt < 2000;
      if (!wasUserInitiated) {
        return;
      }

      await trackBlockedEmbeddedAttempt(blockedUrl);
      replaceEmbedWithBlockedFrame(mediaElement, blockedUrl);
      showBlockedMediaNotice(blockedDomain);
    }, { once: true });
  }

  function isBlockedEmbedGuarded(element) {
    return element?.getAttribute?.(EMBED_GUARD_MARKER) === 'true';
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

  async function findDirectBlockedEmbedMatch(embedElement, settings, tempUnblocks, now) {
    if (!(embedElement instanceof HTMLElement)) {
      return null;
    }

    for (const candidateUrl of getElementUrlCandidates(embedElement)) {
      const blockedDomain = getBlockedDomainForCandidateUrl(candidateUrl, settings);
      if (!blockedDomain) {
        continue;
      }

      const isWhitelisted = await chrome.runtime.sendMessage({
        type: 'IS_URL_WHITELISTED',
        url: candidateUrl
      });

      if (isWhitelisted || hasActiveTempUnblock(settings, tempUnblocks, blockedDomain, now)) {
        continue;
      }

      return { blockedDomain, blockedUrl: candidateUrl };
    }

    return null;
  }

  async function maybeBlockEmbeddedContent(settings, tempUnblocks) {
    if (!isTopLevelFrame() || blockedPageHost || !settings || !settings.enabled || shouldSkipEmbeddedMediaHandling()) {
      return;
    }

    const currentDomain = normalizeDomain(window.location.hostname);
    const now = Date.now();
    if (hasActiveTempUnblock(settings, tempUnblocks, currentDomain, now)) {
      return;
    }

    if (settings.mode === 'blocklist' && getBlockedDomains(settings).length === 0) {
      return;
    }

    for (const embedElement of document.querySelectorAll(EMBED_SOURCE_SELECTORS)) {
      if (!(embedElement instanceof HTMLElement)
        || embedElement.getAttribute(EMBED_BLOCK_MARKER) === 'true'
        || isBlockedEmbedGuarded(embedElement)) {
        continue;
      }

      const ownerElement = embedElement.closest('video, audio') || embedElement;
      if (ownerElement instanceof HTMLMediaElement) {
        const match = await findDirectBlockedEmbedMatch(ownerElement, settings, tempUnblocks, now)
          || await findBlockedDomainForEmbed(ownerElement, settings, tempUnblocks, now).then((blockedDomain) => {
            if (!blockedDomain) {
              return null;
            }

            const blockedUrl = getElementUrlCandidates(ownerElement)[0] || '';
            return blockedUrl ? { blockedDomain, blockedUrl } : null;
          });

        if (!match) {
          continue;
        }

        armMediaPlaybackBlock(ownerElement, match.blockedUrl, match.blockedDomain);
        continue;
      }

      const match = await findDirectBlockedEmbedMatch(ownerElement, settings, tempUnblocks, now);
      if (!match) {
        continue;
      }

      armFramedEmbedBlock(ownerElement, match.blockedUrl, match.blockedDomain);
    }
  }

  function stopInvalidatedContentScript() {
    if (contentContextInvalidated) {
      return;
    }

    contentContextInvalidated = true;
    pendingEvaluation = false;
    embedObserver?.disconnect();
    embedObserver = null;
    embedObserverStarted = false;
    if (embedScanTimeoutId !== null) {
      clearTimeout(embedScanTimeoutId);
    }
    embedScanTimeoutId = null;
    embedScanScheduled = false;
    removeBlockedPage();
  }

  function hasActiveExtensionContext() {
    if (contentContextInvalidated) {
      return false;
    }

    try {
      if (chrome.runtime?.id) {
        return true;
      }
    } catch {
    }

    stopInvalidatedContentScript();
    return false;
  }

  function handleContentScriptError(label, error) {
    if (contentContextInvalidated) {
      return;
    }

    if (/Extension context invalidated/i.test(error?.message || String(error))) {
      stopInvalidatedContentScript();
      return;
    }

    console.error(label, error);
  }

  async function refreshBlockingState() {
    if (!hasActiveExtensionContext() || !isTopLevelFrame() || blockedPageHost) {
      return;
    }

    const [{ tempUnblocks = {} }, settings, isOnFocusBreak] = await Promise.all([
      chrome.storage.local.get('tempUnblocks'),
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }),
      chrome.runtime.sendMessage({ type: 'IS_ON_FOCUS_BREAK' })
    ]);

    if (!hasActiveExtensionContext() || blockedPageHost || isOnFocusBreak) {
      return;
    }

    await maybeBlockEmbeddedContent(settings, tempUnblocks);
  }

  function scheduleEmbedScan() {
    if (!hasActiveExtensionContext() || embedScanScheduled) {
      return;
    }

    embedScanScheduled = true;
    embedScanTimeoutId = window.setTimeout(async () => {
      embedScanTimeoutId = null;
      embedScanScheduled = false;

      if (!hasActiveExtensionContext()) {
        return;
      }

      try {
        await refreshBlockingState();
      } catch (error) {
        handleContentScriptError('Focus Extension: embedded content scan error', error);
      }
    }, 60);
  }

  function startEmbedObserver() {
    if (!hasActiveExtensionContext() || embedObserverStarted) {
      return;
    }

    if (!document.documentElement) {
      document.addEventListener('DOMContentLoaded', startEmbedObserver, { once: true });
      return;
    }

    embedObserverStarted = true;
    embedObserver = new MutationObserver((mutations) => {
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

    embedObserver.observe(document.documentElement, {
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
    if (!hasActiveExtensionContext() || categoryScanInFlight || !settings || settings.historyAnalysisEnabled === false) {
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

      if (!hasActiveExtensionContext() || blockedPageHost || window.location.href !== url) {
        return;
      }

      const payload = collectCategoryScanPayload(domain, url);
      await chrome.runtime.sendMessage({
        type: 'SAVE_SITE_CATEGORY_CONTENT_SCAN',
        payload
      });
    } catch (error) {
      handleContentScriptError('Focus Extension: site category scan error', error);
    } finally {
      categoryScanInFlight = false;
    }
  }

  const BLOCKED_PAGE_SCROLL_STYLES = [
    ['overflow-x', 'hidden'],
    ['overflow-y', 'hidden'],
    ['overscroll-behavior-x', 'none'],
    ['overscroll-behavior-y', 'none']
  ];

  function lockBlockedPageScroll() {
    if (!blockedPageScrollLock) {
      blockedPageScrollLock = {
        url: window.location.href,
        x: window.scrollX,
        y: window.scrollY,
        elements: new Map()
      };
    }

    for (const element of new Set([document.documentElement, document.body, document.scrollingElement])) {
      if (!element || blockedPageScrollLock.elements.has(element)) {
        continue;
      }

      const properties = BLOCKED_PAGE_SCROLL_STYLES.map(([property, lockedValue]) => ({
        property,
        lockedValue,
        value: element.style.getPropertyValue(property),
        priority: element.style.getPropertyPriority(property)
      }));
      blockedPageScrollLock.elements.set(element, {
        properties,
        x: element.scrollLeft,
        y: element.scrollTop
      });
      for (const { property, lockedValue } of properties) {
        element.style.setProperty(property, lockedValue, 'important');
      }
    }
  }

  function restoreBlockedPageScroll() {
    const lock = blockedPageScrollLock;
    blockedPageScrollLock = null;
    if (!lock) {
      return;
    }

    for (const [element, { properties }] of lock.elements) {
      for (const { property, lockedValue, value, priority } of properties) {
        if (element.style.getPropertyValue(property) !== lockedValue
          || element.style.getPropertyPriority(property) !== 'important') {
          continue;
        }

        if (value) {
          element.style.setProperty(property, value, priority);
        } else {
          element.style.removeProperty(property);
        }
      }
    }

    if (window.location.href !== lock.url) {
      return;
    }

    for (const [element, { x, y }] of lock.elements) {
      if (element.isConnected) {
        element.scrollTo({ left: x, top: y, behavior: 'instant' });
      }
    }
    window.scrollTo({ left: lock.x, top: lock.y, behavior: 'instant' });
  }

  function cancelBlockedPageLoadTimeout() {
    if (blockedPageLoadTimer !== null) {
      clearTimeout(blockedPageLoadTimer);
      blockedPageLoadTimer = null;
    }
  }

  function removeBlockedPage() {
    cancelBlockedPageLoadTimeout();
    blockedPageObserver?.disconnect();
    blockedPageObserver = null;
    document.removeEventListener('play', handleMediaPlayWhileBlocked, true);
    const dialog = blockedPageDialog;
    const host = blockedPageHost;
    blockedPageHost = null;
    blockedPageDialog = null;
    blockedPageFrame = null;
    blockedPageLoading = null;
    blockedPageUrl = '';
    blockedPageRenderId = '';
    blockedPageReady = false;
    if (dialog?.open) {
      dialog.close();
    }
    host?.remove();
    restoreBlockedPageScroll();
  }

  function retryBlockedPage(url, reason = 'retry') {
    if (!blockedPageHost || blockedPageUrl !== url || window.location.href !== url) {
      return;
    }

    removeBlockedPage();
    showBlockedPage(url, reason);
  }

  function markBlockedPageReady(url, renderId) {
    if (!blockedPageFrame || blockedPageUrl !== url
      || window.location.href !== url || renderId !== blockedPageRenderId) {
      return false;
    }

    if (blockedPageReady) {
      return true;
    }

    blockedPageReady = true;
    cancelBlockedPageLoadTimeout();
    blockedPageLoading?.remove();
    blockedPageLoading = null;
    blockedPageFrame.tabIndex = 0;
    if (document.hasFocus()) {
      blockedPageFrame.focus();
    }
    return true;
  }

  function pauseBlockedPageMedia() {
    for (const media of document.querySelectorAll('video, audio')) {
      try {
        media.pause();
      } catch {
      }
    }
  }

  function handleMediaPlayWhileBlocked(event) {
    if (!blockedPageHost || !(event.target instanceof HTMLMediaElement)) {
      return;
    }

    try {
      event.target.pause();
    } catch {
    }
  }

  function ensureBlockedPageObserver() {
    if (blockedPageObserver || !document.documentElement) {
      return;
    }

    blockedPageObserver = new MutationObserver(() => {
      if (!blockedPageHost) {
        return;
      }

      lockBlockedPageScroll();
      if (blockedPageHost.isConnected) {
        return;
      }

      const url = blockedPageUrl;
      removeBlockedPage();
      if (window.location.href === url) {
        showBlockedPage(url, 'render-recovery');
      } else {
        scheduleEvaluation('render-recovery');
      }
    });
    blockedPageObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function showBlockedPage(url, reason = 'navigation') {
    if (!isTopLevelFrame() || window.location.href !== url) {
      return;
    }

    if (blockedPageHost) {
      if (blockedPageUrl === url && blockedPageDialog?.open && blockedPageHost.isConnected) {
        return;
      }

      removeBlockedPage();
    }

    if (!document.documentElement) {
      document.addEventListener('DOMContentLoaded', () => scheduleEvaluation(reason), { once: true });
      return;
    }

    pauseBlockedPageMedia();
    document.addEventListener('play', handleMediaPlayWhileBlocked, true);

    const host = document.createElement('div');
    host.setAttribute('data-focus-extension-blocked-page', 'true');
    host.style.cssText = 'all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; display: block !important; width: 100vw !important; height: 100vh !important;';

    const shadow = host.attachShadow({ mode: 'closed' });
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Focus — site blocked');
    dialog.setAttribute('closedby', 'none');
    dialog.style.cssText = 'all: initial; position: fixed; inset: 0; display: block; width: 100vw; height: 100vh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; box-sizing: border-box; overflow: hidden; overscroll-behavior: none; visibility: visible; opacity: 1; background: #f7f5ef; color: #242420;';
    dialog.addEventListener('cancel', (event) => event.preventDefault());
    dialog.addEventListener('close', () => {
      if (blockedPageDialog === dialog && dialog.isConnected && !dialog.open) {
        dialog.showModal();
      }
    });

    const iframe = document.createElement('iframe');
    iframe.title = 'Focus — site blocked';
    iframe.tabIndex = -1;
    iframe.style.cssText = 'position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; border: 0 !important; margin: 0 !important; padding: 0 !important; display: block !important;';

    const renderId = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16)).join('-');
    const frameUrl = new URL(chrome.runtime.getURL('blocked/blocked.html'));
    frameUrl.searchParams.set('url', url);
    frameUrl.searchParams.set('embedded', '1');
    frameUrl.searchParams.set('reason', reason);
    frameUrl.searchParams.set('renderId', renderId);
    iframe.src = frameUrl.href;

    const loading = document.createElement('div');
    loading.style.cssText = 'position: absolute; inset: 0; z-index: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; background: #f7f5ef; color: #242420; padding: 24px; box-sizing: border-box; overflow-y: auto; overscroll-behavior: contain; font-family: system-ui, sans-serif;';
    const loadingHeading = document.createElement('h1');
    loadingHeading.textContent = 'This can wait.';
    loadingHeading.style.margin = '0';
    const loadingStatus = document.createElement('p');
    loadingStatus.setAttribute('role', 'status');
    loadingStatus.textContent = 'Loading your focus screen…';
    loadingStatus.style.margin = '0';
    const retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.autofocus = true;
    retryButton.textContent = 'Retry focus screen';
    retryButton.style.cssText = 'border: 1px solid #d6d2c4; border-radius: 8px; background: #ffffff; color: #242420; padding: 10px 18px; font: inherit; cursor: pointer;';
    retryButton.addEventListener('click', () => retryBlockedPage(url, reason));
    loading.appendChild(loadingHeading);
    loading.appendChild(loadingStatus);
    loading.appendChild(retryButton);

    dialog.appendChild(iframe);
    dialog.appendChild(loading);
    shadow.appendChild(dialog);

    blockedPageHost = host;
    blockedPageUrl = url;
    blockedPageDialog = dialog;
    blockedPageRenderId = renderId;
    blockedPageFrame = iframe;
    blockedPageLoading = loading;
    blockedPageReady = false;

    lockBlockedPageScroll();
    (document.body || document.documentElement).appendChild(host);
    try {
      dialog.showModal();
    } catch (error) {
      console.error('Focus Extension: unable to open blocking dialog', error);
      dialog.setAttribute('open', '');
    }

    blockedPageLoadTimer = setTimeout(() => {
      blockedPageLoadTimer = null;
      if (blockedPageHost === host && blockedPageRenderId === renderId && !blockedPageReady
        && window.location.href === url && blockedPageLoading) {
        loadingStatus.textContent = 'The focus screen is taking longer to load. Try again.';
      }
    }, 3000);
    ensureBlockedPageObserver();
  }

  async function evaluateCurrentUrl() {
    if (!hasActiveExtensionContext()) {
      return;
    }

    if (evaluationInFlight) {
      pendingEvaluation = true;
      return;
    }

    evaluationInFlight = true;

    try {
      const currentUrl = window.location.href;

      if (!isTopLevelFrame() || !/^https?:/i.test(currentUrl)) {
        return;
      }

      const currentDomain = normalizeDomain(window.location.hostname);
      const reason = evaluationReason;
      evaluationReason = 'navigation';

      const shouldBlock = await chrome.runtime.sendMessage({ type: 'SHOULD_BLOCK_URL', url: currentUrl });
      if (typeof shouldBlock !== 'boolean' || !hasActiveExtensionContext()) {
        return;
      }

      if (window.location.href !== currentUrl) {
        pendingEvaluation = true;
        return;
      }

      if (shouldBlock) {
        showBlockedPage(currentUrl, reason);
        return;
      }

      if (blockedPageHost) {
        removeBlockedPage();
        return;
      }

      const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (settings && !settings.error && settings.historyAnalysisEnabled !== false
        && !blockedPageHost && window.location.href === currentUrl) {
        queueMicrotask(() => maybeRunCategoryScan(settings, currentDomain, currentUrl));
      }
    } catch (e) {
      handleContentScriptError('Focus Extension: redirect error', e);
    } finally {
      evaluationInFlight = false;
      if (pendingEvaluation && !contentContextInvalidated) {
        pendingEvaluation = false;
        queueMicrotask(evaluateCurrentUrl);
      }
    }
  }

  function scheduleEvaluation(reason) {
    if (!hasActiveExtensionContext()) {
      return;
    }

    if (typeof reason === 'string' && reason) {
      evaluationReason = reason;
    }
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
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      scheduleEvaluation();
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }

    const relevantKeys = ['settings', 'profiles', 'activeProfileId', 'tempUnblocks', 'focusSession'];
    if (relevantKeys.some((key) => key in changes)) {
      scheduleEvaluation();
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender?.id && sender.id !== chrome.runtime.id) {
      return false;
    }

    if (message?.type === 'REEVALUATE_BLOCKING') {
      scheduleEvaluation(message.reason);
      sendResponse({ success: true });
      return false;
    }

    if (message?.type === 'CONTINUE_BLOCKED_PAGE') {
      const allowed = !!blockedPageHost && blockedPageUrl === message.blockedUrl
        && window.location.href === message.blockedUrl && /^https?:/i.test(message.url || '');
      sendResponse({ success: allowed });
      if (allowed) {
        const currentUrl = window.location.href;
        removeBlockedPage();
        if (message.url !== currentUrl) {
          window.location.replace(message.url);
        }
      }
      return false;
    }

    if (message?.type === 'BLOCKED_PAGE_READY') {
      sendResponse({ success: markBlockedPageReady(message.blockedUrl, message.renderId) });
      return false;
    }

    if (message?.type === 'SHOW_FOCUS_NOTIFICATION') {
      showFocusBrowserNotification({
        title: message.title,
        message: message.message
      });
      return false;
    }

    return false;
  });

  startEmbedObserver();
  scheduleEvaluation();
})();
