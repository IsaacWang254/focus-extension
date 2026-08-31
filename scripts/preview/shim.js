/**
 * Preview-only chrome.* shim, injected by scripts/preview/serve.mjs into
 * blocked.html, options.html and newtab.html so those surfaces render with
 * realistic fixture data outside the extension. Never shipped: the server
 * injects it at request time, the files on disk are untouched.
 */
(() => {
  if (typeof globalThis.chrome !== 'undefined' && globalThis.chrome.runtime?.id !== undefined) return;

  const now = Date.now();
  const todayIso = new Date().toISOString().slice(0, 10);

  // ---------------------------------------------------------------------------
  // Fixture data
  // ---------------------------------------------------------------------------

  const UNBLOCK_METHODS = {
    timer: { enabled: true, unit: 'minutes', value: 5, minutes: 5 },
    completeTodo: { enabled: true, mode: 'single', requiredCount: 3 },
    typePhrase: { enabled: false, phrase: 'I want to waste my time', useRandomString: false, randomLength: 30 },
    typeReason: { enabled: true, minLength: 50 },
    mathProblem: { enabled: true },
    password: { enabled: false, value: '' }
  };

  const CATEGORIES = [
    { id: 'social-media', name: 'Social Media', icon: 'SM', sites: ['twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'tiktok.com'], enabled: true },
    { id: 'entertainment', name: 'Entertainment', icon: 'EN', sites: ['youtube.com', 'netflix.com', 'twitch.tv'], enabled: false },
    { id: 'forums', name: 'Forums', icon: 'FR', sites: ['reddit.com', 'discord.com'], enabled: false }
  ];

  const SETTINGS = {
    enabled: true,
    mode: 'blocklist',
    blockedSites: ['twitter.com', 'x.com', 'reddit.com', 'youtube.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'twitch.tv', 'discord.com', 'netflix.com'],
    allowedSites: [],
    categories: CATEGORIES,
    blockedKeywords: { enabled: true, keywords: [{ keyword: 'shorts', caseSensitive: false }, { keyword: 'trending', caseSensitive: false }] },
    allowedUrls: [],
    allowUnlimitedTime: false,
    unblockAllBlockedSites: false,
    inactivityTimeout: 5,
    dailyLimit: { enabled: true, minutes: 30 },
    earnedTime: { enabled: true, minutesPerTask: 5, maxBankMinutes: 60, requireTasksToUnlock: false, addToActiveUnblock: false },
    schedule: { enabled: false, allowedTimes: [{ start: '07:00', end: '09:00' }, { start: '12:00', end: '13:00' }], activeDays: [1, 2, 3, 4, 5] },
    unblockMethods: UNBLOCK_METHODS,
    requireAllMethods: false,
    // New tab dashboard settings
    newtabShowWeather: true,
    newtabShowQuotes: true,
    newtabShowCalendar: true,
    newtabShowTodos: true,
    newtabShowFocusSnapshot: true,
    newtabBackground: 'none',
    newtabShowOceanBackground: false,
    newtabOceanBatterySaver: false,
    newtabOceanWaveSpeed: 0.8,
    newtabTempUnit: 'C',
    bedtimeReminderEnabled: false,
    bedtimeReminderTime: '22:30',
    bedtimeReminderEndTime: '07:00'
  };

  const PROFILES = [
    { id: 'work', name: 'Work', icon: 'W', color: '#059669', blockedSites: SETTINGS.blockedSites, categories: CATEGORIES, unblockMethods: UNBLOCK_METHODS },
    { id: 'study', name: 'Study', icon: 'S', color: '#2563eb', blockedSites: SETTINGS.blockedSites.slice(0, 6), categories: CATEGORIES, unblockMethods: UNBLOCK_METHODS },
    { id: 'relaxed', name: 'Relaxed', icon: 'R', color: '#d97706', blockedSites: SETTINGS.blockedSites.slice(0, 3), categories: [], unblockMethods: UNBLOCK_METHODS }
  ];

  const at = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };

  const EVENTS = [
    { title: 'Deep work: extension restyle', start: at(9, 30), end: at(11, 0), color: '#666666' },
    { title: 'Standup', start: at(11, 30), end: at(11, 45), color: '#666666' },
    { title: 'Review pull requests', start: at(14, 0), end: at(15, 0), color: '#999999' },
    { title: 'Ship day', isAllDay: true, color: '#999999' }
  ];

  const due = (offsetDays, label) => ({ date: new Date(now + offsetDays * 864e5).toISOString().slice(0, 10), string: label, is_recurring: false });

  const TASKS = [
    { id: 't1', content: 'Finish the blocked-page restyle', priority: 4, labels: ['deep-work'], due: due(0, 'today'), order: 1 },
    { id: 't2', content: 'Write design token tests for options page', priority: 3, labels: [], due: due(0, 'today'), order: 2 },
    { id: 't3', content: 'Reply to worker deploy thread', priority: 2, labels: ['quick'], due: due(-1, 'yesterday'), order: 3 },
    { id: 't4', content: 'Read the OKLCH color article', priority: 1, labels: [], due: null, order: 4 },
    { id: 't5', content: 'Plan next week', priority: 1, labels: [], due: due(2, 'Tuesday'), order: 5 },
    { id: 't1a', content: 'Unify unblock rail spacing', parent_id: 't1', priority: 2, labels: [], due: null, order: 1 },
    { id: 't1b', content: 'Check dark theme contrast', parent_id: 't1', priority: 2, labels: [], due: null, order: 2 }
  ];

  const COMPLETED = [
    { id: 'c1', content: 'Morning review', completed_at: new Date(now - 2 * 36e5).toISOString() },
    { id: 'c2', content: 'Inbox zero pass', completed_at: new Date(now - 5 * 36e5).toISOString() }
  ];

  const QUOTE = { text: 'Focus on being productive instead of busy.', author: 'Tim Ferriss', index: 1 };

  // ---------------------------------------------------------------------------
  // chrome.storage.local (in-memory)
  // ---------------------------------------------------------------------------

  const params = new URLSearchParams(window.location.search);

  const store = {
    theme: params.get('preview-theme') === 'dark' ? 'dark' : 'light',
    themeSyncWithBrowser: false,
    todoistToken: 'preview-token',
    weatherCache: {
      current: { temperature_2m: 21.4, weather_code: 2, is_day: 1 },
      daily: { temperature_2m_max: [24.1], temperature_2m_min: [16.3] }
    },
    weatherCacheTime: now,
    quoteOfDay: { date: todayIso, quote: QUOTE }
  };

  const changeListeners = [];
  const normalize = (keys) => {
    if (keys == null) return { ...store };
    if (typeof keys === 'string') return keys in store ? { [keys]: store[keys] } : {};
    if (Array.isArray(keys)) return keys.reduce((acc, k) => (k in store && (acc[k] = store[k]), acc), {});
    return Object.entries(keys).reduce((acc, [k, fallback]) => (acc[k] = k in store ? store[k] : fallback, acc), {});
  };

  const storageArea = {
    get(keys, cb) {
      const result = normalize(typeof keys === 'function' ? null : keys);
      const callback = typeof keys === 'function' ? keys : cb;
      if (callback) { callback(result); return undefined; }
      return Promise.resolve(result);
    },
    set(values, cb) {
      const changes = {};
      for (const [k, v] of Object.entries(values)) { changes[k] = { oldValue: store[k], newValue: v }; store[k] = v; }
      changeListeners.forEach((fn) => fn(changes, 'local'));
      if (cb) { cb(); return undefined; }
      return Promise.resolve();
    },
    remove(keys, cb) {
      (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete store[k]);
      if (cb) { cb(); return undefined; }
      return Promise.resolve();
    }
  };

  // ---------------------------------------------------------------------------
  // Message fixtures
  // ---------------------------------------------------------------------------

  // ?preview-state=nuclear | limit | empty — exercise the blocked page's
  // alternate layouts. ?preview-bg=ocean|dither — turn the shader back on.
  const previewState = params.get('preview-state');
  const previewBg = params.get('preview-bg');
  if (previewBg) {
    SETTINGS.newtabBackground = previewBg;
    SETTINGS.newtabShowOceanBackground = true;
  }
  // ?preview-hide=todos,calendar — exercise the new tab's hidden-panel layouts.
  (params.get('preview-hide') || '').split(',').forEach((part) => {
    if (part === 'todos') SETTINGS.newtabShowTodos = false;
    if (part === 'calendar') SETTINGS.newtabShowCalendar = false;
  });

  const respond = (message) => {
    switch (message.type) {
      case 'GET_SETTINGS': return structuredClone(SETTINGS);
      case 'UPDATE_SETTINGS': Object.assign(SETTINGS, message.settings); return { success: true };
      case 'GET_QUOTE_OF_DAY': case 'GET_RANDOM_QUOTE': return QUOTE;
      case 'GET_TEMP_UNBLOCKS': return [];
      case 'GET_DAILY_USAGE': return previewState === 'limit'
        ? { enabled: true, usedMinutes: 30, limitMinutes: 30, remainingMinutes: 0, exceeded: true }
        : { enabled: true, usedMinutes: 12, limitMinutes: 30, remainingMinutes: 18, exceeded: false };
      case 'GET_EARNED_TIME': return { enabled: true, minutes: 15, tasksCompleted: 3, totalEarned: 45, totalUsed: 30, minutesPerTask: 5, maxBankMinutes: 60, requireTasksToUnlock: false, addToActiveUnblock: false };
      case 'GET_COMPLETE_TODO_PROGRESS': return { enabled: true, mode: 'single', requiredCount: 1, completedCount: 0, remainingCount: 1, satisfied: false };
      case 'GET_NUCLEAR_STATUS': return previewState === 'nuclear'
        ? { active: true, expiresAt: now + 2 * 36e5, remainingMs: 2 * 36e5 }
        : { active: false, expiresAt: null, remainingMs: null };
      case 'GET_BLOCKED_CONTENT_METADATA': return null;
      case 'IS_ON_FOCUS_BREAK': return false;
      case 'TRACK_BLOCK_ATTEMPT': return 34;
      case 'SAVE_UNBLOCK_REASON': case 'TEMPORARY_UNBLOCK': case 'END_TEMP_UNBLOCK': return { success: true };
      case 'ADD_EARNED_TIME': return { added: message.minutes || 5, minutes: 20 };
      case 'GET_CALENDAR_STATUS': return { connected: true, email: 'preview@example.com' };
      case 'GET_NEWTAB_EVENTS': return {
        title: "Today's Schedule",
        displayDate: new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
        events: structuredClone(EVENTS)
      };
      case 'GET_TODAY_EVENTS': case 'GET_UPCOMING_EVENTS': return structuredClone(EVENTS);
      case 'GET_CALENDAR_LIST': return [{ id: 'primary', name: 'Personal', selected: true }, { id: 'team', name: 'Team', selected: false }];
      case 'GET_BLOCKING_SUMMARY': return { blockedSiteCount: SETTINGS.blockedSites.length, totalBlockAttempts: 34, lifetimeBlockAttempts: 210, totalUnblocks: 7, resistedCount: 27, topUnblockedDomain: 'youtube.com' };
      case 'GET_PROFILES': return structuredClone(PROFILES);
      case 'GET_ACTIVE_PROFILE': return structuredClone(PROFILES[0]);
      case 'GET_ACTIVE_PROFILE_ID': return 'work';
      case 'SET_ACTIVE_PROFILE': case 'SWITCH_PROFILE': return { success: true };
      case 'GET_SUGGESTED_PROFILE': return null;
      case 'GET_CATEGORIES': return structuredClone(CATEGORIES);
      case 'GET_CATEGORY_TEMPLATES': return {
        socialMedia: { name: 'Social Media', icon: 'SM', sites: ['twitter.com', 'x.com', 'facebook.com', 'instagram.com'] },
        entertainment: { name: 'Entertainment', icon: 'EN', sites: ['youtube.com', 'netflix.com', 'twitch.tv'] },
        news: { name: 'News', icon: 'NW', sites: ['news.google.com', 'cnn.com', 'bbc.com'] }
      };
      case 'GET_BLOCKED_KEYWORDS': return structuredClone(SETTINGS.blockedKeywords);
      case 'GET_ALLOWED_URLS_WITH_REASONS': return [{ url: 'https://www.youtube.com/watch?v=dev-talk', reason: 'Conference talk for work', addedAt: now - 864e5 }];
      case 'GET_UNBLOCK_REASONS': return {
        totalCount: 7,
        domainStats: { 'youtube.com': 3, 'reddit.com': 2, 'x.com': 2 },
        categoryStats: { research: 3, work: 2, other: 2 },
        recentReasons: [
          { domain: 'youtube.com', reason: 'Needed a tutorial for a build issue.', timestamp: now - 36e5, category: 'research' },
          { domain: 'reddit.com', reason: 'Checking a specific answer thread.', timestamp: now - 864e5, category: 'work' }
        ]
      };
      case 'GET_CURRENT_TAB_URL': return { url: 'https://x.com/home', domain: 'x.com' };
      case 'GET_FOCUS_SESSION': return null;
      case 'GET_FOCUS_PRESETS': return { pomodoro: { workMinutes: 25 }, short: { workMinutes: 15 }, long: { workMinutes: 50 } };
      case 'GET_ALL_TIME_STATS': return { totalSessions: 18, totalMinutes: 460 };
      case 'GET_STREAK_INFO': return { current: 4, longest: 11 };
      // Stats page (only shimmed with ?shim=1; defaults to its built-in preview)
      case 'GET_SITE_CATEGORIES': return { socialMedia: { name: 'Social' }, entertainment: { name: 'Entertainment' }, productivity: { name: 'Productivity' }, education: { name: 'Education' }, news: { name: 'News' } };
      case 'ANALYZE_HISTORY': return {
        categories: [
          { key: 'productivity', name: 'Productivity', visits: 82, color: '#56524d' },
          { key: 'education', name: 'Education', visits: 41, color: '#6b665f' },
          { key: 'socialMedia', name: 'Social', visits: 34, color: '#8a837a' },
          { key: 'entertainment', name: 'Entertainment', visits: 19, color: '#a49c92' }
        ],
        hourlyDistribution: [1, 0, 0, 0, 0, 1, 3, 8, 12, 15, 10, 9, 7, 11, 16, 18, 14, 10, 7, 5, 4, 3, 2, 1],
        topDomains: [
          { domain: 'github.com', visits: 36, category: 'productivity' },
          { domain: 'developer.mozilla.org', visits: 22, category: 'education' },
          { domain: 'youtube.com', visits: 19, category: 'entertainment', categorySource: 'content-scan' },
          { domain: 'reddit.com', visits: 14, category: '' }
        ]
      };
      case 'GET_PRODUCTIVITY_SCORE': return {
        score: 72,
        grade: 'b',
        breakdown: { productiveVisits: 82, distractingVisits: 34, neutralVisits: 22 },
        insights: { topProductiveSite: 'github.com', peakHourLabel: '3 PM', avgDailyVisits: 41, topDistractingSite: 'youtube.com', uniqueSites: 37 }
      };
      case 'GET_BROWSING_PATTERNS': return { dayOfWeek: [9, 18, 22, 19, 24, 17, 8].map((visits) => ({ visits })) };
      case 'GET_BLOCK_SUGGESTIONS': return [
        { domain: 'youtube.com', reason: 'Frequently visited entertainment site', visits: 19 },
        { domain: 'reddit.com', reason: 'Recurring social browsing pattern', visits: 14 }
      ];
      default: return null;
    }
  };

  // ---------------------------------------------------------------------------
  // chrome.*
  // ---------------------------------------------------------------------------

  globalThis.chrome = {
    runtime: {
      id: 'preview',
      lastError: undefined,
      getURL: (path) => `/${String(path).replace(/^\/+/, '')}`,
      openOptionsPage: () => { window.location.href = '/options/options.html'; },
      sendMessage: (message, cb) => {
        const result = respond(message || {});
        if (typeof cb === 'function') { setTimeout(() => cb(result), 0); return undefined; }
        return Promise.resolve(result);
      },
      onMessage: { addListener() {}, removeListener() {} }
    },
    storage: {
      local: storageArea,
      sync: storageArea,
      onChanged: { addListener: (fn) => changeListeners.push(fn), removeListener() {} }
    },
    tabs: {
      create: ({ url }) => window.open(url, '_blank'),
      query: (_q, cb) => cb && cb([])
    },
    identity: { getRedirectURL: () => 'https://preview.chromiumapp.org/' },
    permissions: { contains: () => Promise.resolve(true), request: () => Promise.resolve(true) },
    extension: { isAllowedIncognitoAccess: (cb) => cb(true) }
  };

  // ---------------------------------------------------------------------------
  // Todoist API interception
  // ---------------------------------------------------------------------------

  const realFetch = window.fetch.bind(window);
  const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('api.todoist.com')) {
      if (url.includes('/tasks/completed')) return json({ items: previewState === 'empty' ? [] : structuredClone(COMPLETED) });
      if (/\/tasks\/[^/]+\/(close|reopen)/.test(url)) return Promise.resolve(new Response(null, { status: 204 }));
      if (url.includes('/tasks')) return json({ results: previewState === 'empty' ? [] : structuredClone(TASKS) });
      if (url.includes('/labels')) return json({ results: [{ id: 'l1', name: 'deep-work', color: 'blue' }, { id: 'l2', name: 'quick', color: 'yellow' }] });
      if (url.includes('/projects')) return json({ results: [{ id: 'p1', name: 'Inbox' }] });
      return json({});
    }
    return realFetch(input, init);
  };
})();
