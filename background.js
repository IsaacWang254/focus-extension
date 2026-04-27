/**
 * Focus Extension - Background Service Worker
 * Handles URL blocking using declarativeNetRequest and manages extension state
 */

// Predefined category templates
const CATEGORY_TEMPLATES = {
  socialMedia: {
    name: 'Social Media',
    icon: 'SM',
    sites: ['twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'snapchat.com', 'linkedin.com', 'threads.net']
  },
  entertainment: {
    name: 'Entertainment',
    icon: 'EN',
    sites: ['youtube.com', 'netflix.com', 'twitch.tv', 'hulu.com', 'disneyplus.com', 'hbomax.com', 'primevideo.com', 'spotify.com']
  },
  news: {
    name: 'News',
    icon: 'NW',
    sites: ['news.google.com', 'cnn.com', 'bbc.com', 'foxnews.com', 'nytimes.com', 'theguardian.com', 'reddit.com/r/news', 'reuters.com']
  },
  gaming: {
    name: 'Gaming',
    icon: 'GM',
    sites: ['twitch.tv', 'discord.com', 'steampowered.com', 'epicgames.com', 'roblox.com', 'itch.io', 'gog.com']
  },
  shopping: {
    name: 'Shopping',
    icon: 'SH',
    sites: ['amazon.com', 'ebay.com', 'etsy.com', 'walmart.com', 'target.com', 'aliexpress.com', 'wish.com']
  },
  forums: {
    name: 'Forums & Communities',
    icon: 'FR',
    sites: ['reddit.com', 'discord.com', 'quora.com', 'stackexchange.com', 'hackernews.com', 'news.ycombinator.com']
  }
};

// Default settings
const DEFAULT_SETTINGS = {
  enabled: true,
  mode: 'blocklist', // 'blocklist' or 'allowlist'
  blockedSites: [
    'twitter.com',
    'x.com',
    'reddit.com',
    'youtube.com',
    'facebook.com',
    'instagram.com',
    'tiktok.com',
    'twitch.tv',
    'discord.com',
    'netflix.com'
  ],
  allowedSites: [],
  // Site categories for group blocking
  categories: [
    // Default categories - users can add/edit/delete
    {
      id: 'social-media',
      name: 'Social Media',
      icon: 'SM',
      sites: ['twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'tiktok.com'],
      enabled: false // When enabled, all sites in category are blocked
    },
    {
      id: 'entertainment',
      name: 'Entertainment',
      icon: 'EN',
      sites: ['youtube.com', 'netflix.com', 'twitch.tv'],
      enabled: false
    },
    {
      id: 'forums',
      name: 'Forums',
      icon: 'FR',
      sites: ['reddit.com', 'discord.com'],
      enabled: false
    }
  ],
  // Keyword blocking - block URLs containing these keywords
  blockedKeywords: {
    enabled: false,
    keywords: [] // Array of { keyword: string, caseSensitive: boolean }
  },
  // URL whitelist - allow specific URLs even on blocked domains
  allowedUrls: [], // Array of exact URLs to allow (e.g., "https://www.youtube.com/watch?v=specific_video")
  allowUnlimitedTime: false,
  unblockAllBlockedSites: false,
  inactivityTimeout: 5, // Minutes before auto-blocking when switched away (0 = disabled)
  dailyLimit: {
    enabled: false,
    minutes: 30, // Total minutes allowed per day on blocked sites
  },
  earnedTime: {
    enabled: false,
    minutesPerTask: 5, // Minutes earned per completed task
    maxBankMinutes: 60, // Maximum banked minutes
    requireTasksToUnlock: false, // If true, must have earned time to unblock
    addToActiveUnblock: false, // If true, completed tasks extend active timed unblocks before banking leftovers
  },
  bedtimeReminderEnabled: false,
  bedtimeReminderTime: '22:30',
  bedtimeReminderEndTime: '07:00',
  newtabShowWeather: true,
  newtabShowQuotes: true,
  newtabShowCalendar: true,
  newtabShowTodos: true,
  newtabShowFocusSnapshot: true,
  newtabShowOceanBackground: true,
  newtabOceanBatterySaver: false,
  newtabOceanWaveSpeed: 0.8,
  newtabTempUnit: 'C',
  newtabBgImageLight: '',
  newtabBgImageDark: '',
  schedule: {
    enabled: false,
    // Times when sites are UNBLOCKED (allowed)
    allowedTimes: [
      { start: '07:00', end: '09:00' },  // Morning
      { start: '12:00', end: '13:00' }   // Lunch
    ],
    // Days when schedule applies (0 = Sunday, 6 = Saturday)
    activeDays: [1, 2, 3, 4, 5] // Weekdays by default
  },
  unblockMethods: {
    timer: { enabled: false, unit: 'minutes', value: 5, minutes: 5 },
    completeTodo: { enabled: true, mode: 'single', requiredCount: 3 },
    typePhrase: { enabled: false, phrase: 'I want to waste my time', useRandomString: false, randomLength: 30 },
    typeReason: { enabled: true, minLength: 50 },
    mathProblem: { enabled: false },
    password: { enabled: false, value: '' }
  },
  requireAllMethods: false, // true = ALL methods required, false = ANY method works
  todoistToken: null,
  // Privacy settings
  historyAnalysisEnabled: true, // Allow browser history analysis for productivity insights
  // Focus session presets (customizable pomodoro timers)
  focusPresets: {
    pomodoro: { workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, sessionsBeforeLongBreak: 4 },
    short: { workMinutes: 15, breakMinutes: 3, longBreakMinutes: 10, sessionsBeforeLongBreak: 4 },
    long: { workMinutes: 50, breakMinutes: 10, longBreakMinutes: 20, sessionsBeforeLongBreak: 3 }
  }
};

const TEMP_UNBLOCK_ALL_KEY = '__all__';

const BEDTIME_REMINDER_ALARM = 'bedtimeReminder';
const BEDTIME_REMINDER_NOTIFICATION_ID = 'bedtime-reminder';
const BEDTIME_REMINDER_LAST_SENT_KEY = 'bedtimeReminderLastSentWindow';
const BLOCKED_RESOURCE_TYPES = ['main_frame'];

// Default profile structure
const DEFAULT_PROFILE = {
  id: 'default',
  name: 'Default',
  icon: '*',
  color: '#6366f1', // Indigo
  blockedSites: [
    'twitter.com',
    'x.com',
    'reddit.com',
    'youtube.com',
    'facebook.com',
    'instagram.com',
    'tiktok.com',
    'twitch.tv',
    'discord.com',
    'netflix.com'
  ],
  allowedSites: [],
  categories: [
    {
      id: 'social-media',
      name: 'Social Media',
      icon: 'SM',
      sites: ['twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'tiktok.com'],
      enabled: false
    },
    {
      id: 'entertainment',
      name: 'Entertainment',
      icon: 'EN',
      sites: ['youtube.com', 'netflix.com', 'twitch.tv'],
      enabled: false
    },
    {
      id: 'forums',
      name: 'Forums',
      icon: 'FR',
      sites: ['reddit.com', 'discord.com'],
      enabled: false
    }
  ],
  blockedKeywords: {
    enabled: false,
    keywords: []
  },
  allowedUrls: [],
  schedule: {
    enabled: false,
    allowedTimes: [
      { start: '07:00', end: '09:00' },
      { start: '12:00', end: '13:00' }
    ],
    activeDays: [1, 2, 3, 4, 5]
  },
  unblockMethods: {
    timer: { enabled: false, unit: 'minutes', value: 5, minutes: 5 },
    completeTodo: { enabled: true, mode: 'single', requiredCount: 3 },
    typePhrase: { enabled: false, phrase: 'I want to waste my time', useRandomString: false, randomLength: 30 },
    typeReason: { enabled: true, minLength: 50 },
    mathProblem: { enabled: false },
    password: { enabled: false, value: '' }
  },
  requireAllMethods: false
};

// Preset profile templates
const PROFILE_TEMPLATES = {
  work: {
    name: 'Work',
    icon: 'W',
    color: '#059669', // Emerald
    blockedSites: ['twitter.com', 'x.com', 'reddit.com', 'youtube.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'twitch.tv', 'discord.com', 'netflix.com'],
    categories: [
      { id: 'social', name: 'Social Media', icon: 'SM', sites: ['twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'snapchat.com'], enabled: true },
      { id: 'entertainment', name: 'Entertainment', icon: 'EN', sites: ['youtube.com', 'netflix.com', 'twitch.tv', 'hulu.com'], enabled: true },
      { id: 'gaming', name: 'Gaming', icon: 'GM', sites: ['twitch.tv', 'discord.com', 'steampowered.com'], enabled: true }
    ],
    unblockMethods: {
      timer: { enabled: true, unit: 'minutes', value: 10, minutes: 10 },
      completeTodo: { enabled: false, mode: 'single', requiredCount: 3 },
      typePhrase: { enabled: true, phrase: 'I should be working right now', useRandomString: false, randomLength: 30 },
      typeReason: { enabled: false, minLength: 50 },
      mathProblem: { enabled: false },
      password: { enabled: false, value: '' }
    }
  },
  study: {
    name: 'Study',
    icon: 'S',
    color: '#7c3aed', // Violet
    blockedSites: ['twitter.com', 'x.com', 'reddit.com', 'youtube.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'twitch.tv', 'discord.com', 'netflix.com', 'spotify.com'],
    categories: [
      { id: 'social', name: 'Social Media', icon: 'SM', sites: ['twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'tiktok.com'], enabled: true },
      { id: 'entertainment', name: 'Entertainment', icon: 'EN', sites: ['youtube.com', 'netflix.com', 'twitch.tv', 'spotify.com'], enabled: true }
    ],
    unblockMethods: {
      timer: { enabled: true, unit: 'minutes', value: 15, minutes: 15 },
      completeTodo: { enabled: true, mode: 'single', requiredCount: 3 },
      typePhrase: { enabled: false, phrase: 'I want to waste my time', useRandomString: false, randomLength: 30 },
      typeReason: { enabled: true, minLength: 50 },
      mathProblem: { enabled: true },
      password: { enabled: false, value: '' }
    }
  },
  relaxed: {
    name: 'Relaxed',
    icon: 'R',
    color: '#0891b2', // Cyan
    blockedSites: [],
    categories: [],
    unblockMethods: {
      timer: { enabled: true, unit: 'minutes', value: 1, minutes: 1 },
      completeTodo: { enabled: false, mode: 'single', requiredCount: 3 },
      typePhrase: { enabled: false, phrase: 'I want to waste my time', useRandomString: false, randomLength: 30 },
      typeReason: { enabled: false, minLength: 50 },
      mathProblem: { enabled: false },
      password: { enabled: false, value: '' }
    }
  }
};

// Rule ID counter start (to avoid conflicts)
const RULE_ID_START = 1000;

// Flag to prevent concurrent rule updates
let isUpdatingRules = false;
let pendingUpdate = false;

// Daily usage tracking state
let usageTrackingInterval = null;
let lastActiveTabCheck = null;

/**
 * Initialize the extension on install or update
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`Focus Extension ${details.reason}: ${details.previousVersion || 'new'} -> ${chrome.runtime.getManifest().version}`);

  if (details.reason === 'install') {
    // Fresh install - set default settings
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    console.log('Focus Extension installed with default settings');
  } else if (details.reason === 'update') {
    // Extension updated - merge existing settings with any new defaults
    await migrateSettings();
    console.log('Focus Extension updated - settings preserved and migrated');
  }

  // Always update rules on install/update
  await updateBlockingRules();
  await scheduleBedtimeReminderAlarm();
});

/**
 * Migrate settings on extension update
 * Preserves user settings while adding any new default fields
 */
async function migrateSettings() {
  try {
    const result = await chrome.storage.local.get(['settings', 'profiles', 'activeProfileId']);
    const existingSettings = result.settings;

    if (!existingSettings) {
      // No existing settings - use defaults
      await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
      return;
    }

    // Merge: existing settings take priority, but add any new default fields
    const migratedSettings = { ...DEFAULT_SETTINGS, ...existingSettings };

    // Deep merge for nested objects (unblockMethods, schedule, etc.)
    if (DEFAULT_SETTINGS.unblockMethods && existingSettings.unblockMethods) {
      migratedSettings.unblockMethods = {
        ...DEFAULT_SETTINGS.unblockMethods,
        ...existingSettings.unblockMethods
      };
      migratedSettings.unblockMethods.completeTodo = normalizeCompleteTodoSettings(migratedSettings.unblockMethods.completeTodo);
    }

    if (DEFAULT_SETTINGS.schedule && existingSettings.schedule) {
      migratedSettings.schedule = {
        ...DEFAULT_SETTINGS.schedule,
        ...existingSettings.schedule
      };
    }

    if (DEFAULT_SETTINGS.dailyLimit && existingSettings.dailyLimit) {
      migratedSettings.dailyLimit = {
        ...DEFAULT_SETTINGS.dailyLimit,
        ...existingSettings.dailyLimit
      };
    }

    if (DEFAULT_SETTINGS.earnedTime && existingSettings.earnedTime) {
      migratedSettings.earnedTime = {
        ...DEFAULT_SETTINGS.earnedTime,
        ...existingSettings.earnedTime
      };
    }

    if (DEFAULT_SETTINGS.focusPresets && existingSettings.focusPresets) {
      migratedSettings.focusPresets = {};
      for (const key of Object.keys(DEFAULT_SETTINGS.focusPresets)) {
        migratedSettings.focusPresets[key] = {
          ...DEFAULT_SETTINGS.focusPresets[key],
          ...(existingSettings.focusPresets[key] || {})
        };
      }
    }

    await chrome.storage.local.set({ settings: migratedSettings });

    // Also migrate profiles if they exist
    if (result.profiles && Array.isArray(result.profiles) && result.profiles.length > 0) {
      const migratedProfiles = result.profiles.map(profile => ({
        ...DEFAULT_PROFILE,
        ...profile,
        // Preserve user's blocked sites - don't let DEFAULT_PROFILE overwrite them
        blockedSites: profile.blockedSites || DEFAULT_PROFILE.blockedSites,
        allowedSites: profile.allowedSites || DEFAULT_PROFILE.allowedSites,
        categories: profile.categories || DEFAULT_PROFILE.categories,
        // Ensure new fields exist on profiles too
        unblockMethods: {
          ...DEFAULT_PROFILE.unblockMethods,
          ...(profile.unblockMethods || {})
        },
        schedule: {
          ...DEFAULT_PROFILE.schedule,
          ...(profile.schedule || {})
        }
      }));
      migratedProfiles.forEach(profile => {
        profile.unblockMethods.completeTodo = normalizeCompleteTodoSettings(profile.unblockMethods.completeTodo);
      });
      await chrome.storage.local.set({ profiles: migratedProfiles });
      console.log('Profiles migrated:', migratedProfiles.map(p => ({ id: p.id, name: p.name, blockedSitesCount: p.blockedSites?.length })));
    }

    console.log('Settings migration complete');
  } catch (e) {
    console.error('Settings migration failed:', e);
  }
}

/**
 * Export all extension data for backup
 */
async function exportAllData() {
  try {
    const data = await chrome.storage.local.get(null); // Get everything

    return {
      success: true,
      data: {
        version: chrome.runtime.getManifest().version,
        exportedAt: new Date().toISOString(),
        settings: data.settings,
        profiles: data.profiles,
        activeProfileId: data.activeProfileId,
        categories: data.categories,
        xpData: data.xpData,
        streakData: data.streakData,
        focusSessionHistory: data.focusSessionHistory,
        theme: data.theme,
        accentColor: data.accentColor
      }
    };
  } catch (e) {
    console.error('Export failed:', e);
    return { success: false, error: e.message };
  }
}

/**
 * Import extension data from backup
 */
async function importAllData(importData) {
  try {
    if (!importData || typeof importData !== 'object') {
      return { success: false, error: 'Invalid import data' };
    }

    // Validate the data has expected structure
    if (!importData.settings && !importData.profiles) {
      return { success: false, error: 'No settings or profiles found in import data' };
    }

    const dataToImport = {};

    // Import each data type if present
    if (importData.settings) {
      // Merge with defaults to ensure all required fields exist
      dataToImport.settings = { ...DEFAULT_SETTINGS, ...importData.settings };
    }

    if (importData.profiles) {
      dataToImport.profiles = importData.profiles;
    }

    if (importData.activeProfileId) {
      dataToImport.activeProfileId = importData.activeProfileId;
    }

    if (importData.categories) {
      dataToImport.categories = importData.categories;
    }

    if (importData.xpData) {
      dataToImport.xpData = importData.xpData;
    }

    if (importData.streakData) {
      dataToImport.streakData = importData.streakData;
    }

    if (importData.focusSessionHistory) {
      dataToImport.focusSessionHistory = importData.focusSessionHistory;
    }

    if (importData.theme) {
      dataToImport.theme = importData.theme;
    }

    if (importData.accentColor) {
      dataToImport.accentColor = importData.accentColor;
    }

    await chrome.storage.local.set(dataToImport);
    await updateBlockingRules();

    console.log('Import complete:', Object.keys(dataToImport));
    return { success: true, imported: Object.keys(dataToImport) };
  } catch (e) {
    console.error('Import failed:', e);
    return { success: false, error: e.message };
  }
}

/**
 * Update rules when extension starts
 */
chrome.runtime.onStartup.addListener(async () => {
  // Verify settings exist on startup
  const result = await chrome.storage.local.get(['settings', 'profiles']);
  if (!result.settings) {
    console.warn('No settings found on startup - restoring defaults');
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  } else {
    console.log('Settings loaded on startup:', {
      mode: result.settings.mode,
      blockedSitesCount: result.settings.blockedSites?.length || 0,
      profilesCount: result.profiles?.length || 0
    });
  }

  await updateBlockingRules();
  await scheduleBedtimeReminderAlarm();
});

/**
 * Listen for settings changes
 */
chrome.storage.onChanged.addListener(async (changes, namespace) => {
  if (namespace === 'local' && (changes.settings || changes.profiles || changes.activeProfileId)) {
    console.log('Settings or profiles changed, updating rules');
    await updateBlockingRules();
  }
});

/**
 * Get settings with active profile merged in
 * Profile settings override: blockedSites, allowedSites, categories, blockedKeywords, allowedUrls, schedule, unblockMethods, requireAllMethods, unblockAllBlockedSites
 * Global settings remain: enabled, mode, todoistToken, allowUnlimitedTime, inactivityTimeout, dailyLimit, earnedTime
 * @returns {Promise<object>} Settings object
 */
async function getSettings() {
  const result = await chrome.storage.local.get('settings');
  const globalSettings = result.settings || { ...DEFAULT_SETTINGS };
  if (globalSettings.enabled !== true) {
    globalSettings.enabled = true;
    await chrome.storage.local.set({ settings: globalSettings });
  }
  if (globalSettings.unblockMethods) {
    globalSettings.unblockMethods.completeTodo = normalizeCompleteTodoSettings(globalSettings.unblockMethods.completeTodo);
  }

  // Get active profile
  const data = await chrome.storage.local.get(['profiles', 'activeProfileId']);
  const profiles = data.profiles || [];

  // If no profiles exist yet, return global settings
  if (profiles.length === 0) {
    return globalSettings;
  }

  // Find active profile - use stored ID, or fall back to first profile
  let activeProfileId = data.activeProfileId;
  let activeProfile = profiles.find(p => p.id === activeProfileId);

  // If active profile not found (ID mismatch or never set), use first profile
  if (!activeProfile) {
    activeProfile = profiles[0];
    activeProfileId = activeProfile.id;
    // Fix the stored activeProfileId
    await chrome.storage.local.set({ activeProfileId });
  }

  // Merge profile-specific settings into global settings
  // Profile overrides these fields
  return {
    ...globalSettings,
    blockedSites: activeProfile.blockedSites || globalSettings.blockedSites,
    allowedSites: activeProfile.allowedSites || globalSettings.allowedSites,
    categories: activeProfile.categories || globalSettings.categories,
    blockedKeywords: activeProfile.blockedKeywords || globalSettings.blockedKeywords,
    allowedUrls: activeProfile.allowedUrls || globalSettings.allowedUrls,
    schedule: activeProfile.schedule || globalSettings.schedule,
    unblockMethods: {
      ...(activeProfile.unblockMethods || globalSettings.unblockMethods),
      completeTodo: normalizeCompleteTodoSettings((activeProfile.unblockMethods || globalSettings.unblockMethods)?.completeTodo)
    },
    requireAllMethods: activeProfile.requireAllMethods !== undefined ? activeProfile.requireAllMethods : globalSettings.requireAllMethods,
    unblockAllBlockedSites: activeProfile.unblockAllBlockedSites !== undefined ? activeProfile.unblockAllBlockedSites : globalSettings.unblockAllBlockedSites,
    // Keep reference to active profile
    _activeProfileId: activeProfileId,
    _activeProfileName: activeProfile.name
  };
}

/**
 * Save profile-specific settings to the active profile
 * This is used when modifying blockedSites, categories, keywords, etc.
 * @param {Object} updates - Fields to update (blockedSites, categories, etc.)
 * @returns {Promise<void>}
 */
async function saveProfileSettings(updates) {
  const data = await chrome.storage.local.get(['profiles', 'activeProfileId']);
  const profiles = data.profiles || [];

  // If no profiles exist, save to global settings (legacy behavior)
  if (profiles.length === 0) {
    const result = await chrome.storage.local.get('settings');
    const settings = result.settings || { ...DEFAULT_SETTINGS };
    Object.assign(settings, updates);
    await chrome.storage.local.set({ settings });
    return;
  }

  // Find active profile - use stored ID, or fall back to first profile
  let activeProfileId = data.activeProfileId;
  let profileIndex = profiles.findIndex(p => p.id === activeProfileId);

  // If active profile not found, use first profile and fix the stored ID
  if (profileIndex === -1) {
    profileIndex = 0;
    activeProfileId = profiles[0].id;
    await chrome.storage.local.set({ activeProfileId });
  }

  // Update the profile
  Object.assign(profiles[profileIndex], updates);
  await chrome.storage.local.set({ profiles });
}

/**
 * Extract domain from URL
 * @param {string} url - Full URL
 * @returns {string} Domain name
 */
function extractDomain(url) {
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^www\./, '');
  }
}

function normalizeTrackedDomain(domain) {
  if (typeof domain !== 'string') {
    return 'unknown site';
  }

  const normalized = domain.trim().replace(/^www\./, '').toLowerCase();
  return normalized || 'unknown site';
}

function isMeaningfulTrackedDomain(domain) {
  return normalizeTrackedDomain(domain) !== 'unknown site';
}

function isTempUnblockActive(expiry, now = Date.now()) {
  return expiry === 'unlimited' || (typeof expiry === 'number' && expiry > now);
}

function getSharedTempUnblockExpiry(tempUnblocks, now = Date.now()) {
  let latestExpiry = null;

  for (const [domain, expiry] of Object.entries(tempUnblocks)) {
    if (domain === TEMP_UNBLOCK_ALL_KEY || !isTempUnblockActive(expiry, now)) {
      continue;
    }

    if (expiry === 'unlimited') {
      return 'unlimited';
    }

    if (!latestExpiry || expiry > latestExpiry) {
      latestExpiry = expiry;
    }
  }

  return latestExpiry;
}

function getTempUnblockExpiry(tempUnblocks, domain, settings = null, now = Date.now()) {
  const globalExpiry = tempUnblocks[TEMP_UNBLOCK_ALL_KEY];
  if (isTempUnblockActive(globalExpiry, now)) {
    return globalExpiry;
  }

  const domainExpiry = tempUnblocks[domain];
  if (isTempUnblockActive(domainExpiry, now)) {
    return domainExpiry;
  }

  if (settings?.unblockAllBlockedSites && wouldBlockDomain(domain, settings)) {
    return getSharedTempUnblockExpiry(tempUnblocks, now);
  }

  return null;
}

function hasGlobalTempUnblock(tempUnblocks, now = Date.now()) {
  return isTempUnblockActive(tempUnblocks[TEMP_UNBLOCK_ALL_KEY], now);
}

function hasEffectiveGlobalTempUnblock(tempUnblocks, settings, now = Date.now()) {
  return hasGlobalTempUnblock(tempUnblocks, now) ||
    Boolean(settings?.unblockAllBlockedSites && getSharedTempUnblockExpiry(tempUnblocks, now));
}

function normalizeAllowedUrlInput(url) {
  let candidateUrl = typeof url === 'string' ? url.trim() : '';

  if (!candidateUrl) {
    return { success: false, error: 'URL cannot be empty' };
  }

  if (!candidateUrl.startsWith('http://') && !candidateUrl.startsWith('https://')) {
    candidateUrl = 'https://' + candidateUrl;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(candidateUrl);
  } catch {
    return { success: false, error: 'Invalid URL format' };
  }

  parsedUrl.hash = '';

  let normalizedPathname = parsedUrl.pathname || '/';
  if (normalizedPathname.length > 1 && normalizedPathname.endsWith('/')) {
    normalizedPathname = normalizedPathname.slice(0, -1);
  }

  const keepRootSlash = normalizedPathname === '/' && Boolean(parsedUrl.search);
  const pathSegment = normalizedPathname === '/'
    ? (keepRootSlash ? '/' : '')
    : normalizedPathname;

  return {
    success: true,
    normalizedUrl: `${parsedUrl.origin}${pathSegment}${parsedUrl.search}`
  };
}

function buildAllowedUrlRegex(url) {
  const normalizedResult = normalizeAllowedUrlInput(url);
  if (!normalizedResult.success) {
    throw new Error(normalizedResult.error);
  }

  const parsedUrl = new URL(normalizedResult.normalizedUrl);
  const escapedOrigin = parsedUrl.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedPath = parsedUrl.pathname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedSearch = (parsedUrl.search || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  if (parsedUrl.pathname === '/' && !parsedUrl.search) {
    return `^${escapedOrigin}(?:$|[/?#].*)`;
  }

  if (parsedUrl.search) {
    return `^${escapedOrigin}${escapedPath}${escapedSearch}(?:#.*)?$`;
  }

  return `^${escapedOrigin}${escapedPath}(?:$|[/?#].*)`;
}

function doesAllowedUrlMatch(normalizedTargetUrl, normalizedAllowedUrl) {
  const targetUrl = new URL(normalizedTargetUrl);
  const allowedUrl = new URL(normalizedAllowedUrl);

  if (targetUrl.origin !== allowedUrl.origin) {
    return false;
  }

  if (allowedUrl.search) {
    return normalizedTargetUrl === normalizedAllowedUrl;
  }

  if (allowedUrl.pathname === '/') {
    return true;
  }

  return targetUrl.pathname === allowedUrl.pathname ||
    targetUrl.pathname.startsWith(`${allowedUrl.pathname}/`);
}

function getAllBlockedDomains(settings) {
  if (settings.mode !== 'blocklist') {
    return [];
  }

  const domains = new Set((settings.blockedSites || []).map(extractDomain));
  for (const category of settings.categories || []) {
    if (!category.enabled) continue;
    for (const site of category.sites || []) {
      domains.add(extractDomain(site));
    }
  }

  return [...domains];
}

function wouldBlockDomain(domain, settings) {
  if (!domain || !settings?.enabled) return false;

  if (settings.mode === 'blocklist') {
    const blockedDomains = getAllBlockedDomains(settings);
    return blockedDomains.some((blockedDomain) => {
      return domain === blockedDomain || domain.endsWith('.' + blockedDomain);
    });
  }

  return !(settings.allowedSites || []).some((site) => {
    const allowedDomain = site.replace(/^www\./, '');
    return domain === allowedDomain || domain.endsWith('.' + allowedDomain);
  });
}

async function redirectTabsThatShouldNowBeBlocked(reason = 'expired') {
  const tabs = await chrome.tabs.query({});

  for (const tab of tabs) {
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      continue;
    }

    await redirectTabIfNeeded(tab.id, tab.url, reason);
  }
}

function doesDomainMatchAny(tabDomain, domains = []) {
  return domains.includes(tabDomain) || domains.some((domain) => tabDomain.endsWith(`.${domain}`));
}

async function redirectMatchingDomainTabsIfNeeded(domains, reason = 'navigation') {
  const tabs = await chrome.tabs.query({});

  for (const tab of tabs) {
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      continue;
    }

    const tabDomain = extractDomain(tab.url);
    if (!tabDomain || !doesDomainMatchAny(tabDomain, domains)) {
      continue;
    }

    await redirectTabIfNeeded(tab.id, tab.url, reason);
  }
}

function getHistoryTrackableDomain(url) {
  try {
    const urlObj = new URL(url);

    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      return null;
    }

    const domain = urlObj.hostname.replace(/^www\./, '').toLowerCase();
    return domain || null;
  } catch {
    return null;
  }
}

/**
 * Check if current time is within an allowed time window
 * @param {Object} schedule - Schedule settings
 * @returns {boolean} True if unblocking is allowed
 */
function isInAllowedTimeWindow(schedule) {
  // If schedule not enabled, always allow
  if (!schedule || !schedule.enabled) {
    return true;
  }

  const now = new Date();
  const currentDay = now.getDay();

  // Check if today is an active day
  if (!schedule.activeDays || !schedule.activeDays.includes(currentDay)) {
    return true; // Schedule doesn't apply today
  }

  // If no time windows defined, nothing is allowed
  if (!schedule.allowedTimes || schedule.allowedTimes.length === 0) {
    return false;
  }

  // Get current time in HH:MM format
  const currentTime = now.toTimeString().slice(0, 5);

  // Check each allowed time window
  for (const window of schedule.allowedTimes) {
    if (isTimeInRange(currentTime, window.start, window.end)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a time is within a range
 */
function isTimeInRange(time, start, end) {
  if (start <= end) {
    return time >= start && time < end;
  } else {
    // Overnight range
    return time >= start || time < end;
  }
}

function normalizeCompleteTodoSettings(method = {}) {
  const normalizedMode = method.mode === 'daily' ? 'daily' : 'single';
  const parsedRequiredCount = parseInt(method.requiredCount, 10);

  return {
    enabled: !!method.enabled,
    mode: normalizedMode,
    requiredCount: Number.isFinite(parsedRequiredCount) && parsedRequiredCount > 0 ? parsedRequiredCount : 3
  };
}

/**
 * Update declarativeNetRequest rules based on current settings
 */
async function updateBlockingRules() {
  // Prevent concurrent updates
  if (isUpdatingRules) {
    pendingUpdate = true;
    return;
  }

  isUpdatingRules = true;

  try {
    const settings = await getSettings();
    const blockedPageUrl = chrome.runtime.getURL('blocked/blocked.html');
    const blockedPageExtensionPath = '/blocked/blocked.html';
    const escapedBlockedPageUrl = blockedPageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Get temporary unblocks to exclude from blocking
    const tempUnblocks = (await chrome.storage.local.get('tempUnblocks')).tempUnblocks || {};
    const activeUnblocks = new Set();

    // Check if schedule allows unblocks right now
    const scheduleAllowsUnblock = isInAllowedTimeWindow(settings.schedule);

    // Filter to only active (non-expired) unblocks
    // BUT only if schedule allows unblocks
    const now = Date.now();
    if (scheduleAllowsUnblock) {
      for (const [domain, expiry] of Object.entries(tempUnblocks)) {
        if (isTempUnblockActive(expiry, now)) {
          activeUnblocks.add(domain);
        }
      }
    }

    // Get existing dynamic rules
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const existingRuleIds = existingRules.map(rule => rule.id);

    // Build new rules based on mode
    const newRules = [];
    let ruleId = RULE_ID_START;

    // During pomodoro breaks, suspend all blocking rules as a reward
    const onBreak = await isOnFocusBreak();

    // Only build rules if extension is enabled AND not on a focus break
    // Note: Schedule controls whether unblock methods are available on the blocked page,
    // not whether blocking happens. Sites are always blocked when schedule is enabled.
    if (settings.enabled && !onBreak) {
      // Always allow our own blocked page to avoid self-blocking loops
      newRules.push({
        id: ruleId++,
        priority: 100,
        action: {
          type: 'allow'
        },
        condition: {
          regexFilter: `^${escapedBlockedPageUrl}(\\?.*)?$`,
          resourceTypes: BLOCKED_RESOURCE_TYPES
        }
      });

      const hasGlobalUnblock = hasEffectiveGlobalTempUnblock(tempUnblocks, settings, now);

      if (settings.mode === 'blocklist') {
        // First, add allow rules for whitelisted URLs (higher priority)
        const allowedUrls = settings.allowedUrls || [];
        for (const url of allowedUrls) {
          let allowedUrlRegex;
          try {
            allowedUrlRegex = buildAllowedUrlRegex(url);
          } catch {
            continue;
          }

          newRules.push({
            id: ruleId++,
            priority: 10, // Higher priority than block rules
            action: {
              type: 'allow'
            },
            condition: {
              regexFilter: allowedUrlRegex,
              resourceTypes: BLOCKED_RESOURCE_TYPES
            }
          });
        }

        // Combine blocked sites with sites from enabled categories
        if (!hasGlobalUnblock) {
          // Block specific sites (excluding temporarily unblocked ones)
          for (const domain of getAllBlockedDomains(settings)) {
            if (activeUnblocks.has(domain)) {
              continue;
            }

            const escapedDomain = domain.replace(/\./g, '\\.');

            newRules.push({
              id: ruleId++,
              priority: 1,
              action: {
                type: 'redirect',
                redirect: {
                  regexSubstitution: `${blockedPageUrl}?url=\\0`
                }
              },
              condition: {
                regexFilter: `^https?://(www\\.)?${escapedDomain}.*`,
                resourceTypes: BLOCKED_RESOURCE_TYPES
              }
            });
          }
        }

        // Add keyword blocking rules (if enabled)
        const keywordSettings = settings.blockedKeywords || { enabled: false, keywords: [] };
        if (!hasGlobalUnblock && keywordSettings.enabled && keywordSettings.keywords.length > 0) {
          for (const keywordObj of keywordSettings.keywords) {
            // Escape special regex characters in the keyword
            const escapedKeyword = keywordObj.keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            // Build regex pattern - case insensitive by default
            const flags = keywordObj.caseSensitive ? '' : '(?i)';

            newRules.push({
              id: ruleId++,
              priority: 1,
              action: {
                type: 'redirect',
                redirect: {
                  regexSubstitution: `${blockedPageUrl}?url=\\0`
                }
              },
              condition: {
                regexFilter: `^https?://.*${escapedKeyword}.*`,
                isUrlFilterCaseSensitive: keywordObj.caseSensitive || false,
                resourceTypes: BLOCKED_RESOURCE_TYPES
              }
            });
          }
        }
      } else {
        // Allowlist mode - block everything except allowed sites
        // Combine allowedSites with temporarily unblocked sites
        const allAllowedDomains = new Set([
          ...settings.allowedSites.map(extractDomain),
          ...[...activeUnblocks].filter((domain) => domain !== TEMP_UNBLOCK_ALL_KEY)
        ]);

        if (!hasGlobalUnblock) {
          // First, add a rule to block all sites
          newRules.push({
            id: ruleId++,
            priority: 1,
            action: {
              type: 'redirect',
              redirect: {
                regexSubstitution: `${blockedPageUrl}?url=\\0`
              }
            },
            condition: {
              regexFilter: '^https?://.*',
              resourceTypes: ['main_frame'],
              excludedInitiatorDomains: ['chrome-extension']
            }
          });

          // Add exceptions for allowed sites (higher priority)
          for (const domain of allAllowedDomains) {
            newRules.push({
              id: ruleId++,
              priority: 2,
              action: {
                type: 'allow'
              },
              condition: {
                urlFilter: `||${domain}^`,
                resourceTypes: ['main_frame']
              }
            });
          }

          // Always allow extension pages
          newRules.push({
            id: ruleId++,
            priority: 3,
            action: {
              type: 'allow'
            },
            condition: {
              urlFilter: '|chrome-extension://',
              resourceTypes: ['main_frame']
            }
          });

          // Allow chrome:// pages
          newRules.push({
            id: ruleId++,
            priority: 3,
            action: {
              type: 'allow'
            },
            condition: {
              urlFilter: '|chrome://',
              resourceTypes: ['main_frame']
            }
          });
        }
      }
    }

    // Remove old rules and add new ones in a single atomic operation
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existingRuleIds,
      addRules: newRules
    });

    console.log(`Updated blocking rules: ${newRules.length} rules active`);
    console.log('Rules:', JSON.stringify(newRules, null, 2));
  } finally {
    isUpdatingRules = false;

    // If there was a pending update, run it now
    if (pendingUpdate) {
      pendingUpdate = false;
      await updateBlockingRules();
    }
  }
}

/**
 * Handle messages from other parts of the extension
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(error => {
      console.error('Message handler error:', error);
      sendResponse({ error: error.message });
    });

  // Return true to indicate async response
  return true;
});

/**
 * Process incoming messages
 * @param {object} message - The message
 * @param {object} sender - The sender
 * @returns {Promise<any>} Response
 */
async function handleMessage(message, sender) {
  switch (message.type) {
    case 'GET_SETTINGS':
      return await getSettings();

    case 'EXPORT_ALL_DATA':
      return await exportAllData();

    case 'IMPORT_ALL_DATA':
      return await importAllData(message.data);

    case 'UPDATE_SETTINGS':
      // Profile-specific fields that should be saved to the active profile
      const profileSpecificFields = ['blockedSites', 'allowedSites', 'unblockMethods', 'requireAllMethods', 'unblockAllBlockedSites',
        'allowUnlimitedTime', 'dailyLimit', 'earnedTime', 'inactivityTimeout', 'schedule',
        'categories', 'blockedKeywords', 'allowedUrls'];

      const profileUpdates = {};

      // Extract profile-specific fields
      for (const field of profileSpecificFields) {
        if (field in message.settings) {
          profileUpdates[field] = message.settings[field];
        }
      }

      // Save profile-specific settings to active profile (if any profiles exist)
      if (Object.keys(profileUpdates).length > 0) {
        await saveProfileSettings(profileUpdates);
      }

      // Save global settings (the full settings object for backward compatibility)
      // This ensures non-profile settings like mode, schedule, etc. are saved
      const result = await chrome.storage.local.get('settings');
      const currentSettings = result.settings || { ...DEFAULT_SETTINGS };
      const mergedSettings = { ...currentSettings, ...message.settings };
      mergedSettings.enabled = true;
      if (mergedSettings.unblockMethods) {
        mergedSettings.unblockMethods.completeTodo = normalizeCompleteTodoSettings(mergedSettings.unblockMethods.completeTodo);
      }
      await chrome.storage.local.set({ settings: mergedSettings });
      await scheduleBedtimeReminderAlarm({
        bedtimeReminderEnabled: mergedSettings.bedtimeReminderEnabled,
        bedtimeReminderTime: mergedSettings.bedtimeReminderTime,
        bedtimeReminderEndTime: mergedSettings.bedtimeReminderEndTime
      });

      return { success: true };

    case 'ADD_BLOCKED_SITE':
      return await addBlockedSite(message.site);

    case 'REMOVE_BLOCKED_SITE':
      return await removeBlockedSite(message.site);

    case 'ADD_ALLOWED_SITE':
      return await addAllowedSite(message.site);

    case 'REMOVE_ALLOWED_SITE':
      return await removeAllowedSite(message.site);

    case 'TEMPORARY_UNBLOCK':
      return await temporaryUnblock(message.site, message.minutes);

    case 'GET_CURRENT_TAB_URL':
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0] && tabs[0].url) {
        return { url: tabs[0].url, domain: extractDomain(tabs[0].url) };
      }
      return { url: null, domain: null };

    case 'GET_TEMP_UNBLOCKS':
      return await getTempUnblocks();

    case 'GET_DAILY_USAGE':
      return await getDailyUsageInfo();

    case 'SAVE_UNBLOCK_REASON':
      return await saveUnblockReason(message.domain, message.reason);

    case 'GET_UNBLOCK_REASONS':
      return await getUnblockReasons();

    case 'CLEAR_UNBLOCK_REASONS':
      return await clearUnblockReasons();

    case 'END_TEMP_UNBLOCK':
      return await endTempUnblock(message.domain);

    case 'TRACK_BLOCK_ATTEMPT':
      return await incrementBlockAttempts();

    case 'GET_EARNED_TIME':
      return await getEarnedTimeInfo();

    case 'GET_COMPLETE_TODO_PROGRESS':
      return await getCompleteTodoProgress();

    case 'ADD_EARNED_TIME':
      return await rewardCompletedTasks(message.taskCount || 1);

    case 'USE_EARNED_TIME':
      return await useEarnedTime(message.minutes);

    case 'RESET_EARNED_TIME':
      return await resetEarnedTimeBank();

    case 'GET_NUCLEAR_STATUS':
      return await getNuclearStatus();

    case 'ACTIVATE_NUCLEAR_MODE':
      return await activateNuclearMode(message.minutes);

    case 'GET_STREAK_INFO':
      return await getStreakInfo();

    case 'CHECK_STREAK':
      return await checkAndUpdateStreak();

    case 'GET_XP_DATA':
      return await getXPData();

    case 'ADD_XP':
      return await addXP(message.amount, message.reason);

    case 'GET_XP_HISTORY':
      return await getXPHistory();

    case 'GET_RANDOM_QUOTE':
      return getRandomQuote();

    case 'GET_QUOTE_OF_DAY':
      return await getQuoteOfTheDay();

    case 'GET_FOCUS_PRESETS':
      return await getFocusPresets();

    case 'GET_BLOCKED_CONTENT_METADATA':
      return await getBlockedContentMetadata(message.url);

    case 'GET_FOCUS_SESSION':
      return await getFocusSession();

    case 'START_FOCUS_SESSION':
      return await startFocusSession(message.sessionType, message.customMinutes);

    case 'STOP_FOCUS_SESSION':
      return await stopFocusSession();

    case 'SKIP_FOCUS_PHASE':
      return await skipFocusSessionPhase();

    case 'GET_FOCUS_SESSION_STATS':
      return await getFocusSessionStats();

    case 'GET_ACHIEVEMENTS':
      return await getAchievements();

    case 'CHECK_ACHIEVEMENTS':
      return await checkAchievements();

    case 'GET_ALL_TIME_STATS':
      return await getAllTimeStats();

    case 'GET_BLOCKING_SUMMARY':
      return await getBlockingSummary();

    // Category operations
    case 'GET_CATEGORIES':
      return await getCategories();

    case 'GET_CATEGORY_TEMPLATES':
      return getCategoryTemplates();

    case 'CREATE_CATEGORY':
      return await createCategory(message.category);

    case 'UPDATE_CATEGORY':
      return await updateCategory(message.categoryId, message.updates);

    case 'DELETE_CATEGORY':
      return await deleteCategory(message.categoryId);

    case 'TOGGLE_CATEGORY':
      return await toggleCategory(message.categoryId);

    case 'ADD_SITE_TO_CATEGORY':
      return await addSiteToCategory(message.categoryId, message.site);

    case 'REMOVE_SITE_FROM_CATEGORY':
      return await removeSiteFromCategory(message.categoryId, message.site);

    case 'ADD_CATEGORY_FROM_TEMPLATE':
      return await addCategoryFromTemplate(message.templateKey);

    // Keyword blocking operations
    case 'GET_BLOCKED_KEYWORDS':
      return await getBlockedKeywords();

    case 'ADD_BLOCKED_KEYWORD':
      return await addBlockedKeyword(message.keyword, message.caseSensitive);

    case 'REMOVE_BLOCKED_KEYWORD':
      return await removeBlockedKeyword(message.keyword);

    case 'TOGGLE_KEYWORD_BLOCKING':
      return await toggleKeywordBlocking();

    case 'UPDATE_BLOCKED_KEYWORD':
      return await updateBlockedKeyword(message.keyword, message.updates);

    // URL whitelist operations
    case 'GET_ALLOWED_URLS':
      return await getAllowedUrls();

    case 'GET_ALLOWED_URLS_WITH_REASONS':
      return await getAllowedUrlsWithReasons();

    case 'ADD_ALLOWED_URL':
      return await addAllowedUrl(message.url);

    case 'ADD_ALLOWED_URL_WITH_REASON':
      return await addAllowedUrlWithReason(message.url, message.reason, message.domain);

    case 'REMOVE_ALLOWED_URL':
      return await removeAllowedUrl(message.url);

    case 'IS_URL_WHITELISTED':
      return await isUrlWhitelisted(message.url);

    // Profile operations
    case 'GET_PROFILES':
      return await getProfiles();

    case 'GET_ACTIVE_PROFILE':
      return await getActiveProfile();

    case 'GET_ACTIVE_PROFILE_ID':
      return await getActiveProfileId();

    case 'SET_ACTIVE_PROFILE':
      return await setActiveProfile(message.profileId);

    case 'CREATE_PROFILE':
      return await createProfile(message.profileData);

    case 'UPDATE_PROFILE':
      return await updateProfile(message.profileId, message.updates);

    case 'DELETE_PROFILE':
      return await deleteProfile(message.profileId);

    case 'CREATE_PROFILE_FROM_TEMPLATE':
      return await createProfileFromTemplate(message.templateKey, message.customName);

    case 'DUPLICATE_PROFILE':
      return await duplicateProfile(message.profileId, message.newName);

    case 'GET_PROFILE_TEMPLATES':
      return getProfileTemplates();

    // History analysis operations
    case 'ANALYZE_HISTORY':
      return await analyzeHistory(message.days || 7);

    case 'GET_BLOCK_SUGGESTIONS':
      return await getBlockSuggestions();

    case 'GET_PRODUCTIVITY_SCORE': {
      const prodResult = await getProductivityScore(message.days || 7);
      // Also check productivity achievements when score is fetched
      await checkProductivityAchievements();
      return prodResult;
    }

    case 'GET_BROWSING_PATTERNS':
      return await getBrowsingPatterns(message.days || 30);

    case 'GET_SITE_CATEGORIES':
      return getSiteCategories();

    case 'SET_SITE_CATEGORY_OVERRIDE':
      return await setSiteCategoryOverride(message.domain, message.category);

    case 'REMOVE_SITE_CATEGORY_OVERRIDE':
      return await removeSiteCategoryOverride(message.domain);

    case 'GET_SITE_CATEGORY_SCAN_STATUS':
      return await getSiteCategoryScanStatus(message.domain);

    case 'SAVE_SITE_CATEGORY_CONTENT_SCAN':
      return await saveSiteCategoryContentScan(message.payload);

    // Google Calendar operations
    case 'CONNECT_GOOGLE_CALENDAR':
      return await connectGoogleCalendar();

    case 'DISCONNECT_GOOGLE_CALENDAR':
      return await disconnectGoogleCalendar();

    case 'GET_CALENDAR_STATUS':
      return await getCalendarStatus();

    case 'GET_CALENDAR_LIST':
      const token = await getValidCalendarToken();
      if (!token) return { error: 'Not connected' };
      return await fetchCalendarList(token);

    case 'GET_UPCOMING_EVENTS':
      return await fetchUpcomingEvents(message.days || 7);

    case 'GET_TODAY_EVENTS':
      return await getTodayEvents();

    case 'GET_NEWTAB_EVENTS':
      return await getNewTabEvents();

    case 'GET_CURRENT_EVENTS':
      return await getCurrentEvents();

    case 'UPDATE_CALENDAR_SETTINGS':
      return await updateCalendarSettings(message.settings);

    case 'GET_SUGGESTED_PROFILE':
      return await getSuggestedProfileFromCalendar();

    case 'START_CALENDAR_SYNC':
      await startCalendarSync();
      return { success: true };

    case 'STOP_CALENDAR_SYNC':
      await chrome.alarms.clear('calendar-sync');
      await saveCalendarSettings({ syncEnabled: false });
      return { success: true };

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

/**
 * Add a site to the blocklist
 * @param {string} site - Site to block
 */
async function addBlockedSite(site) {
  const settings = await getSettings();
  const domain = extractDomain(site);
  const blockedSites = [...settings.blockedSites];

  if (!blockedSites.includes(domain)) {
    blockedSites.push(domain);
    await saveProfileSettings({ blockedSites });

    // Check blocking achievements after adding a site
    await checkBlockingAchievements();
  }

  return { success: true, blockedSites };
}

/**
 * Remove a site from the blocklist
 * @param {string} site - Site to unblock
 */
async function removeBlockedSite(site) {
  const settings = await getSettings();
  const domain = extractDomain(site);

  const blockedSites = settings.blockedSites.filter(s => s !== domain);
  await saveProfileSettings({ blockedSites });

  return { success: true, blockedSites };
}

/**
 * Add a site to the allowlist
 * @param {string} site - Site to allow
 */
async function addAllowedSite(site) {
  const settings = await getSettings();
  const domain = extractDomain(site);
  const allowedSites = [...settings.allowedSites];

  if (!allowedSites.includes(domain)) {
    allowedSites.push(domain);
    await saveProfileSettings({ allowedSites });
  }

  return { success: true, allowedSites };
}

/**
 * Remove a site from the allowlist
 * @param {string} site - Site to remove from allowlist
 */
async function removeAllowedSite(site) {
  const settings = await getSettings();
  const domain = extractDomain(site);

  const allowedSites = settings.allowedSites.filter(s => s !== domain);
  await saveProfileSettings({ allowedSites });

  return { success: true, allowedSites };
}

/**
 * Get all active temporary unblocks
 * @returns {Promise<Array>} Array of {domain, expiry, remaining}
 */
async function getTempUnblocks() {
  const tempUnblocks = (await chrome.storage.local.get('tempUnblocks')).tempUnblocks || {};
  const settings = await getSettings();
  const now = Date.now();
  const active = [];

  const globalExpiry = tempUnblocks[TEMP_UNBLOCK_ALL_KEY];
  if (isTempUnblockActive(globalExpiry, now)) {
    return [{
      domain: TEMP_UNBLOCK_ALL_KEY,
      label: 'All blocked sites',
      expiry: globalExpiry,
      remaining: globalExpiry === 'unlimited' ? null : globalExpiry - now
    }];
  }

  if (settings.unblockAllBlockedSites) {
    const sharedExpiry = getSharedTempUnblockExpiry(tempUnblocks, now);
    if (sharedExpiry) {
      return [{
        domain: TEMP_UNBLOCK_ALL_KEY,
        label: 'All blocked sites',
        expiry: sharedExpiry,
        remaining: sharedExpiry === 'unlimited' ? null : sharedExpiry - now
      }];
    }
  }

  for (const [domain, expiry] of Object.entries(tempUnblocks)) {
    if (domain === TEMP_UNBLOCK_ALL_KEY) {
      continue;
    }

    if (expiry === 'unlimited') {
      active.push({ domain, expiry: 'unlimited', remaining: null });
    } else if (expiry > now) {
      active.push({ domain, expiry, remaining: expiry - now });
    }
  }

  // Sort by expiry (soonest first, unlimited last)
  active.sort((a, b) => {
    if (a.expiry === 'unlimited') return 1;
    if (b.expiry === 'unlimited') return -1;
    return a.expiry - b.expiry;
  });

  return active;
}

/**
 * Get daily usage info for UI display
 * @returns {Promise<Object>} { enabled, usedMinutes, limitMinutes, remainingMinutes, exceeded }
 */
async function getDailyUsageInfo() {
  const settings = await getSettings();
  const dailyLimitEnabled = settings.dailyLimit?.enabled || false;
  const limitMinutes = settings.dailyLimit?.minutes || 30;

  if (!dailyLimitEnabled) {
    return {
      enabled: false,
      usedMinutes: 0,
      limitMinutes: limitMinutes,
      remainingMinutes: null,
      exceeded: false
    };
  }

  const usage = await getDailyUsage();
  const usedMinutes = Math.round(usage.minutes);
  const remainingMinutes = Math.max(0, limitMinutes - usedMinutes);
  const exceeded = usedMinutes >= limitMinutes;

  return {
    enabled: true,
    usedMinutes,
    limitMinutes,
    remainingMinutes,
    exceeded
  };
}

// =============================================================================
// UNBLOCK REASONS
// =============================================================================

// Common excuse categories for classification
const REASON_CATEGORIES = {
  work: ['work', 'job', 'client', 'meeting', 'deadline', 'project', 'task', 'email', 'boss', 'colleague', 'office', 'business', 'professional'],
  research: ['research', 'learn', 'study', 'article', 'information', 'looking up', 'find out', 'check', 'verify', 'reference'],
  social: ['friend', 'family', 'message', 'reply', 'respond', 'someone', 'person', 'contact', 'catch up', 'birthday', 'event'],
  entertainment: ['bored', 'break', 'relax', 'quick', 'just', 'minute', 'one thing', 'reward', 'deserve'],
  news: ['news', 'update', 'happening', 'current', 'event', 'trending', 'important'],
  fomo: ['missing', 'miss out', 'everyone', 'viral', 'popular', 'see what'],
  other: []
};

/**
 * Classify a reason into a category
 * @param {string} reason - The reason text
 * @returns {string} Category name
 */
function classifyReason(reason) {
  const lowerReason = reason.toLowerCase();

  for (const [category, keywords] of Object.entries(REASON_CATEGORIES)) {
    if (category === 'other') continue;

    for (const keyword of keywords) {
      if (lowerReason.includes(keyword)) {
        return category;
      }
    }
  }

  return 'other';
}

/**
 * Save an unblock reason
 * @param {string} domain - The domain being unblocked
 * @param {string} reason - The reason provided
 */
async function saveUnblockReason(domain, reason) {
  const result = await chrome.storage.local.get('unblockReasons');
  const reasons = result.unblockReasons || [];
  const normalizedDomain = normalizeTrackedDomain(domain);

  const entry = {
    id: Date.now().toString(),
    domain: normalizedDomain,
    reason,
    category: classifyReason(reason),
    timestamp: Date.now(),
    date: new Date().toISOString()
  };

  reasons.push(entry);

  // Keep only last 100 reasons to avoid storage bloat
  const trimmedReasons = reasons.slice(-100);

  await chrome.storage.local.set({ unblockReasons: trimmedReasons });

  return { success: true, entry };
}

/**
 * Get all unblock reasons with stats
 */
async function getUnblockReasons() {
  const result = await chrome.storage.local.get('unblockReasons');
  const reasons = (result.unblockReasons || []).map((entry) => ({
    ...entry,
    domain: normalizeTrackedDomain(entry.domain)
  }));

  // Calculate category stats
  const categoryStats = {};
  const domainStats = {};

  for (const entry of reasons) {
    // Category counts
    categoryStats[entry.category] = (categoryStats[entry.category] || 0) + 1;

    // Domain counts
    if (isMeaningfulTrackedDomain(entry.domain)) {
      domainStats[entry.domain] = (domainStats[entry.domain] || 0) + 1;
    }
  }

  // Get recent reasons (last 7 days)
  const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const recentReasons = reasons.filter(r => {
    return r.timestamp > weekAgo && isMeaningfulTrackedDomain(r.domain);
  });

  // Find top category and domain
  let topCategory = null;
  let topCategoryCount = 0;
  for (const [cat, count] of Object.entries(categoryStats)) {
    if (count > topCategoryCount) {
      topCategory = cat;
      topCategoryCount = count;
    }
  }

  let topDomain = null;
  let topDomainCount = 0;
  for (const [domain, count] of Object.entries(domainStats)) {
    if (count > topDomainCount) {
      topDomain = domain;
      topDomainCount = count;
    }
  }

  return {
    reasons,
    recentReasons,
    categoryStats,
    domainStats,
    totalCount: reasons.length,
    // Add stats object for options.js compatibility
    stats: {
      topCategory,
      topDomain
    }
  };
}

/**
 * Clear all unblock reasons
 */
async function clearUnblockReasons() {
  await chrome.storage.local.set({ unblockReasons: [] });
  return { success: true };
}

/**
 * End a temporary unblock early
 * @param {string} domain - Domain to re-block
 */
async function endTempUnblock(domain) {
  const tempUnblocks = (await chrome.storage.local.get('tempUnblocks')).tempUnblocks || {};
  const isGlobalUnblock = domain === TEMP_UNBLOCK_ALL_KEY;

  // Remove the domain and any related domains
  const relatedDomains = {
    'twitter.com': ['x.com'],
    'x.com': ['twitter.com']
  };
  const domainsToRemove = isGlobalUnblock
    ? Object.keys(tempUnblocks)
    : [domain, ...(relatedDomains[domain] || [])];

  for (const d of domainsToRemove) {
    delete tempUnblocks[d];
    // Clear any pending alarm
    chrome.alarms.clear(`reblock_${d}`);
    chrome.alarms.clear(`inactivity_${d}`);
  }

  await chrome.storage.local.set({ tempUnblocks });
  await updateBlockingRules();
  await updateBadgeTimer();

  if (isGlobalUnblock) {
    await redirectTabsThatShouldNowBeBlocked('expired');
  } else {
    await redirectMatchingDomainTabsIfNeeded(domainsToRemove, 'expired');
  }

  return { success: true };
}

/**
 * Get the end time of the current allowed window in milliseconds
 * Returns null if not in an allowed window or schedule not enabled
 */
function getCurrentWindowEndTime(schedule) {
  if (!schedule || !schedule.enabled) {
    return null;
  }

  const now = new Date();
  const currentDay = now.getDay();

  // Check if today is an active day
  if (!schedule.activeDays || !schedule.activeDays.includes(currentDay)) {
    return null; // Schedule doesn't apply today, no cap needed
  }

  if (!schedule.allowedTimes || schedule.allowedTimes.length === 0) {
    return null;
  }

  const currentTime = now.toTimeString().slice(0, 5);

  for (const window of schedule.allowedTimes) {
    if (isTimeInRange(currentTime, window.start, window.end)) {
      // We're in this window - calculate end time in milliseconds
      const [endHour, endMin] = window.end.split(':').map(Number);
      const endDate = new Date(now);
      endDate.setHours(endHour, endMin, 0, 0);

      // Handle overnight windows where end is tomorrow
      if (window.start > window.end && currentTime < window.end) {
        // We're in the early morning part of an overnight window, end is today
      } else if (window.start > window.end) {
        // We're in the evening part, end is tomorrow
        endDate.setDate(endDate.getDate() + 1);
      }

      return endDate.getTime();
    }
  }

  return null;
}

/**
 * Temporarily unblock a site for a specified duration
 * @param {string} site - Site to unblock
 * @param {number} minutes - Duration in minutes (0 = unlimited)
 * @param {boolean} useEarnedTimeFlag - Whether to use earned time for this unblock
 */
async function temporaryUnblock(site, minutes, useEarnedTimeFlag = false) {
  const domain = extractDomain(site);
  const settings = await getSettings();
  const unblockAllBlockedSites = settings.unblockAllBlockedSites === true;

  // Check if nuclear mode is active
  if (await isNuclearModeActive()) {
    return { success: false, error: 'nuclear_mode_active' };
  }

  // Check if daily limit is exceeded
  if (await isDailyLimitExceeded()) {
    return { success: false, error: 'daily_limit_exceeded' };
  }

  // Check if earned time is required but user doesn't have enough
  const earnedTimeSettings = settings.earnedTime || { enabled: false, requireTasksToUnlock: false };
  if (earnedTimeSettings.enabled && earnedTimeSettings.requireTasksToUnlock) {
    const bank = await getEarnedTimeBank();

    // For unlimited, check if they have any earned time
    if (minutes === 0 && bank.minutes <= 0) {
      return { success: false, error: 'insufficient_earned_time' };
    }

    // For timed unblocks, check if they have enough earned time
    if (minutes > 0 && bank.minutes < minutes) {
      return { success: false, error: 'insufficient_earned_time', available: bank.minutes, requested: minutes };
    }
  }

  // Store the unblock expiry time (0 = unlimited)
  const tempUnblocks = (await chrome.storage.local.get('tempUnblocks')).tempUnblocks || {};
  const isUnlimited = minutes === 0;

  let expiryTime;
  let actualMinutes = minutes;

  // Get remaining daily time if daily limit is enabled
  const remainingDailyMinutes = await getRemainingDailyTime();

  // If using earned time, cap to available earned time
  let earnedTimeToUse = 0;
  if (earnedTimeSettings.enabled && earnedTimeSettings.requireTasksToUnlock) {
    const bank = await getEarnedTimeBank();

    if (isUnlimited) {
      // Use all available earned time
      earnedTimeToUse = bank.minutes;
      actualMinutes = bank.minutes;
    } else {
      // Use the requested amount (already verified we have enough)
      earnedTimeToUse = minutes;
      actualMinutes = minutes;
    }
  }

  if (isUnlimited && !earnedTimeSettings.requireTasksToUnlock) {
    // For unlimited, check if we need to cap to schedule window end
    const windowEnd = getCurrentWindowEndTime(settings.schedule);
    if (windowEnd) {
      expiryTime = windowEnd;
      actualMinutes = (windowEnd - Date.now()) / (60 * 1000);
      console.log(`Unlimited unblock capped to schedule window end: ${actualMinutes.toFixed(1)} minutes`);
    } else if (remainingDailyMinutes !== null) {
      // Cap to remaining daily time
      expiryTime = Date.now() + (remainingDailyMinutes * 60 * 1000);
      actualMinutes = remainingDailyMinutes;
      console.log(`Unlimited unblock capped to remaining daily time: ${actualMinutes.toFixed(1)} minutes`);
    } else {
      expiryTime = 'unlimited';
    }
  } else {
    // Calculate expiry based on actualMinutes
    expiryTime = Date.now() + (actualMinutes * 60 * 1000);

    // Cap to schedule window end if it would exceed
    const windowEnd = getCurrentWindowEndTime(settings.schedule);
    if (windowEnd && expiryTime > windowEnd) {
      expiryTime = windowEnd;
      actualMinutes = (windowEnd - Date.now()) / (60 * 1000);
      console.log(`Unblock capped to schedule window end: ${actualMinutes.toFixed(1)} minutes`);
    }

    // Also cap to remaining daily time if it would exceed
    if (remainingDailyMinutes !== null && actualMinutes > remainingDailyMinutes) {
      expiryTime = Date.now() + (remainingDailyMinutes * 60 * 1000);
      actualMinutes = remainingDailyMinutes;
      console.log(`Unblock capped to remaining daily time: ${actualMinutes.toFixed(1)} minutes`);
    }

    // If using earned time, cap to that
    if (earnedTimeToUse > 0 && actualMinutes > earnedTimeToUse) {
      actualMinutes = earnedTimeToUse;
      expiryTime = Date.now() + (actualMinutes * 60 * 1000);
      console.log(`Unblock capped to earned time: ${actualMinutes.toFixed(1)} minutes`);
    }
  }

  // Deduct earned time if using it
  if (earnedTimeToUse > 0) {
    // Use the actual minutes being granted (might be less than requested due to caps)
    const minutesToDeduct = Math.min(earnedTimeToUse, actualMinutes);
    await useEarnedTime(minutesToDeduct);
    console.log(`Deducted ${minutesToDeduct} minutes from earned time bank`);
  }

  const domainsToUnblock = unblockAllBlockedSites
    ? [TEMP_UNBLOCK_ALL_KEY]
    : [domain, ...({
      'twitter.com': ['x.com'],
      'x.com': ['twitter.com']
    }[domain] || [])];

  if (unblockAllBlockedSites) {
    for (const existingDomain of Object.keys(tempUnblocks)) {
      chrome.alarms.clear(`reblock_${existingDomain}`);
      chrome.alarms.clear(`inactivity_${existingDomain}`);
      delete tempUnblocks[existingDomain];
    }
  }

  for (const d of domainsToUnblock) {
    tempUnblocks[d] = expiryTime;
  }
  await chrome.storage.local.set({ tempUnblocks });

  // Update blocking rules (will exclude temporarily unblocked sites)
  await updateBlockingRules();

  // Set alarms to re-block each domain (only if not unlimited)
  if (expiryTime !== 'unlimited') {
    for (const d of domainsToUnblock) {
      chrome.alarms.create(`reblock_${d}`, { when: Date.now() + (actualMinutes * 60 * 1000) });
    }
  }

  // Update badge immediately
  await updateBadgeTimer();

  // Ensure we have an alarm set for window end
  await scheduleWindowEndAlarm();

  // Record this unblock for streak tracking
  await recordUnblockForStreak(domain, actualMinutes);
  await decrementBlockedPageCounter();

  return { success: true, unblockUntil: expiryTime, unlimited: expiryTime === 'unlimited', earnedTimeUsed: earnedTimeToUse > 0 };
}

/**
 * Handle alarms for re-blocking sites and badge updates
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'updateBadge') {
    await updateBadgeTimer();
  } else if (alarm.name === BEDTIME_REMINDER_ALARM) {
    const settings = await getSettings();
    await maybeSendBedtimeReminderNotification(settings);
    await scheduleBedtimeReminderAlarm(settings);
  } else if (alarm.name.startsWith('reblock_')) {
    const domain = alarm.name.replace('reblock_', '');
    const isGlobalUnblock = domain === TEMP_UNBLOCK_ALL_KEY;

    // Related domains that should also be re-blocked together
    const relatedDomains = {
      'twitter.com': ['x.com'],
      'x.com': ['twitter.com']
    };
    const currentTempUnblocks = (await chrome.storage.local.get('tempUnblocks')).tempUnblocks || {};
    const domainsToReblock = isGlobalUnblock
      ? Object.keys(currentTempUnblocks)
      : [domain, ...(relatedDomains[domain] || [])];

    // Remove from temporary unblocks
    const tempUnblocks = currentTempUnblocks;
    for (const d of domainsToReblock) {
      delete tempUnblocks[d];
      // Clear any related alarms too
      chrome.alarms.clear(`reblock_${d}`);
      chrome.alarms.clear(`inactivity_${d}`);
    }
    await chrome.storage.local.set({ tempUnblocks });

    // Update blocking rules (site will be blocked again)
    await updateBlockingRules();
    await updateBadgeTimer();

    console.log(`Re-blocked site: ${domain} (and related: ${domainsToReblock.join(', ')})`);

    try {
      if (isGlobalUnblock) {
        await redirectTabsThatShouldNowBeBlocked('expired');
      } else {
        await redirectMatchingDomainTabsIfNeeded(domainsToReblock, 'expired');
      }
    } catch (e) {
      console.error('Error redirecting tabs after timer expiry:', e);
    }
  } else if (alarm.name.startsWith('inactivity_')) {
    const domain = alarm.name.replace('inactivity_', '');
    const isGlobalUnblock = domain === TEMP_UNBLOCK_ALL_KEY;

    // Check if user is currently on this domain
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab && activeTab.url) {
        const activeDomain = extractDomain(activeTab.url);
        const settings = await getSettings();
        const stillOnAllowedTarget = isGlobalUnblock
          ? wouldBlockDomain(activeDomain, settings)
          : activeDomain === domain || activeDomain === `www.${domain}`;

        if (stillOnAllowedTarget) {
          // User is back on the site, don't block
          console.log(`Inactivity timer fired but user is on ${domain}, not blocking`);
          return;
        }
      }
    } catch (e) {
      // Ignore errors, proceed with blocking
    }

    console.log(`Inactivity timeout reached for ${domain}, re-blocking`);

    // End the temporary unblock due to inactivity
    await endTempUnblock(domain);

    try {
      if (isGlobalUnblock) {
        await redirectTabsThatShouldNowBeBlocked('inactivity');
      } else {
        await redirectMatchingDomainTabsIfNeeded([domain], 'inactivity');
      }
    } catch (e) {
      console.error('Error redirecting tabs after inactivity:', e);
    }
  } else if (alarm.name === 'scheduleCheck') {
    // Periodic check to enforce schedule transitions
    await enforceSchedule();
  } else if (alarm.name === 'scheduleWindowEnd') {
    // Precise trigger when schedule window ends
    await enforceSchedule();
    // Schedule the next window end alarm (for when we enter a new window)
    await scheduleWindowEndAlarm();
  } else if (alarm.name === 'midnightReset') {
    // Reset daily usage at midnight
    console.log('Midnight reset triggered');

    // Award XP for focused day before checking streak (which resets todayFocused)
    await awardDailyFocusXP();

    // Check and update streak before resetting daily data
    await checkAndUpdateStreak();

    await chrome.storage.local.set({ dailyUsage: { date: getTodayDateString(), minutes: 0 } });
    await chrome.storage.local.set({ dailyUnblockCount: { date: getTodayDateString(), count: 0, totalMinutes: 0 } });

    // Schedule next midnight reset
    scheduleMidnightReset();
  } else if (alarm.name === 'nuclearModeEnd') {
    // Nuclear mode expired
    console.log('Nuclear mode ended');
    await chrome.storage.local.set({ nuclearMode: { active: false, expiresAt: null } });
    await updateBadgeTimer();

    // Check for nuclear survivor achievement
    await checkNuclearSurvivorAchievement();
  } else if (alarm.name === 'focusSessionEnd') {
    // Focus session phase ended
    // Note: getFocusSession() already detects expired phases and calls handleSessionPhaseEnd internally,
    // so we must NOT call handleSessionPhaseEnd again here to avoid double XP awards and phase skipping.
    const session = await getFocusSession();
    if (session.active) {
      console.log(`Focus session phase transitioned: now in ${session.phase}`);
    }
  } else if (alarm.name === 'calendar-sync') {
    // Calendar sync alarm
    await handleCalendarSyncAlarm();
  }
});

// =============================================================================
// BADGE TIMER
// =============================================================================

/**
 * Update the extension badge to show remaining time
 */
async function updateBadgeTimer() {
  const tempUnblocks = (await chrome.storage.local.get('tempUnblocks')).tempUnblocks || {};
  const settings = await getSettings();

  const setBadgeAppearance = async (text, backgroundColor, textColor = null) => {
    await chrome.action.setBadgeText({ text });

    if (backgroundColor) {
      await chrome.action.setBadgeBackgroundColor({ color: backgroundColor });
    }

    if (textColor) {
      await chrome.action.setBadgeTextColor({ color: textColor });
    }
  };

  if (!settings.enabled) {
    await setBadgeAppearance('OFF', '#F5F5F4', '#1C1917');
    return;
  }

  // Check nuclear mode first
  const nuclearStatus = await getNuclearStatus();
  if (nuclearStatus.active) {
    const remainingMs = nuclearStatus.remainingMs || 0;
    const remainingMins = Math.ceil(remainingMs / 60000);

    let badgeText;
    if (remainingMins >= 60) {
      const hours = Math.floor(remainingMins / 60);
      badgeText = `${hours}h`;
    } else {
      badgeText = `${remainingMins}m`;
    }

    await setBadgeAppearance(badgeText, '#dc2626', '#FFFFFF'); // Red for nuclear

    // Schedule next update
    chrome.alarms.create('updateBadge', { delayInMinutes: 1 / 6 }); // Every 10s
    return;
  }

  // Find the soonest expiring unblock (excluding unlimited)
  let soonestExpiry = null;
  let hasUnlimited = false;

  for (const [domain, expiry] of Object.entries(tempUnblocks)) {
    if (expiry === 'unlimited') {
      hasUnlimited = true;
    } else if (expiry > Date.now()) {
      if (!soonestExpiry || expiry < soonestExpiry) {
        soonestExpiry = expiry;
      }
    }
  }

  if (soonestExpiry) {
    const remaining = Math.max(0, soonestExpiry - Date.now());
    const remainingSeconds = Math.ceil(remaining / 1000);
    const mins = Math.floor(remainingSeconds / 60);
    const secs = remainingSeconds % 60;

    // Format badge text
    let badgeText;
    if (mins >= 60) {
      const hours = Math.floor(mins / 60);
      badgeText = `${hours}h`;
    } else if (mins > 0) {
      badgeText = `${mins}m`;
    } else {
      badgeText = `${secs}s`;
    }

    // Set badge color based on time remaining
    let badgeColor;
    if (remainingSeconds <= 60) {
      badgeColor = '#ff5252'; // Red - danger
    } else if (remainingSeconds <= 300) {
      badgeColor = '#ffc107'; // Yellow - warning
    } else {
      badgeColor = '#4CAF50'; // Green - plenty of time
    }

    const badgeTextColor = remainingSeconds <= 300 ? '#1C1917' : '#FFFFFF';
    await setBadgeAppearance(badgeText, badgeColor, badgeTextColor);

    // Schedule next update
    chrome.alarms.create('updateBadge', { delayInMinutes: remainingSeconds <= 60 ? 1 / 60 : 1 / 6 }); // Every 1s or 10s
  } else if (hasUnlimited) {
    await setBadgeAppearance('∞', '#2196F3', '#FFFFFF'); // Blue
  } else {
    // No active timers
    await chrome.action.setBadgeText({ text: '' });
  }
}

/**
 * Start the badge timer update loop
 */
function startBadgeTimer() {
  updateBadgeTimer();
  // Create recurring alarm to update badge
  chrome.alarms.create('updateBadge', { periodInMinutes: 1 / 6 }); // Every 10 seconds
  // Create recurring alarm to check schedule transitions
  chrome.alarms.create('scheduleCheck', { periodInMinutes: 1 }); // Every minute
  // Set precise alarm for current window end
  scheduleWindowEndAlarm();
}

/**
 * Set an alarm for exactly when the current schedule window ends
 */
async function scheduleWindowEndAlarm() {
  const settings = await getSettings();
  const windowEnd = getCurrentWindowEndTime(settings.schedule);

  // Clear any existing window end alarm
  chrome.alarms.clear('scheduleWindowEnd');

  if (windowEnd) {
    const msUntilEnd = windowEnd - Date.now();
    if (msUntilEnd > 0) {
      const minutesUntilEnd = msUntilEnd / (60 * 1000);
      chrome.alarms.create('scheduleWindowEnd', { delayInMinutes: minutesUntilEnd });
    }
  }
}

/**
 * Enforce schedule by blocking sites when entering a blocked time period
 */
async function enforceSchedule() {
  const settings = await getSettings();

  // Only enforce if schedule is enabled
  if (!settings.schedule || !settings.schedule.enabled) {
    return;
  }

  const canUnblock = isInAllowedTimeWindow(settings.schedule);

  // If we're outside allowed time windows, end all temporary unblocks
  if (!canUnblock) {
    const tempUnblocks = (await chrome.storage.local.get('tempUnblocks')).tempUnblocks || {};

    if (Object.keys(tempUnblocks).length > 0) {
      // Get domains to redirect
      const domainsToBlock = Object.keys(tempUnblocks);
      const shouldRedirectAll = domainsToBlock.includes(TEMP_UNBLOCK_ALL_KEY);

      // Clear all temp unblocks
      await chrome.storage.local.set({ tempUnblocks: {} });

      // Clear all reblock alarms
      for (const domain of domainsToBlock) {
        chrome.alarms.clear(`reblock_${domain}`);
        chrome.alarms.clear(`inactivity_${domain}`);
      }

      // Update blocking rules
      await updateBlockingRules();
      await updateBadgeTimer();

      // Redirect any tabs on blocked domains
      try {
        if (shouldRedirectAll) {
          await redirectTabsThatShouldNowBeBlocked('schedule');
        } else {
          await redirectMatchingDomainTabsIfNeeded(domainsToBlock, 'schedule');
        }
      } catch (e) {
        console.error('Error redirecting tabs after schedule change:', e);
      }
    }
  }
}

// =============================================================================
// TAB MONITORING
// =============================================================================

/**
 * Check if the user is currently on a pomodoro break (break or longBreak phase).
 * Reads directly from storage to avoid getFocusSession()'s auto-phase-end side effects.
 * @returns {Promise<boolean>}
 */
async function isOnFocusBreak() {
  const result = await chrome.storage.local.get('focusSession');
  const session = result.focusSession;
  if (!session || !session.active) return false;
  if (session.endTime && session.endTime <= Date.now()) return false;
  return session.phase === 'break' || session.phase === 'longBreak';
}

/**
 * Check if a domain should be blocked
 */
async function shouldBlockDomain(domain) {
  if (!domain) return false;

  const settings = await getSettings();
  if (!settings.enabled) return false;

  // During pomodoro breaks, all sites are unblocked as a reward
  if (await isOnFocusBreak()) return false;

  // Check if schedule allows unblocks
  const scheduleAllowsUnblock = isInAllowedTimeWindow(settings.schedule);

  // Check temp unblocks first (only if schedule allows)
  if (scheduleAllowsUnblock) {
    const tempUnblocks = (await chrome.storage.local.get('tempUnblocks')).tempUnblocks || {};
    const expiry = getTempUnblockExpiry(tempUnblocks, domain, settings);
    if (expiry) {
      return false; // Temporarily unblocked
    }
  }

  return wouldBlockDomain(domain, settings);
}

function isUrlWhitelistedWithSettings(url, settings) {
  if (!url || !settings) {
    return false;
  }

  const normalizedResult = normalizeAllowedUrlInput(url);
  if (!normalizedResult.success) {
    return false;
  }

  const normalizedUrl = normalizedResult.normalizedUrl;
  const normalizedAllowedUrls = (settings.allowedUrls || []).map((allowedUrl) => {
    const allowedResult = normalizeAllowedUrlInput(allowedUrl);
    return allowedResult.success ? allowedResult.normalizedUrl : allowedUrl;
  });

  return normalizedAllowedUrls.some((allowed) => {
    const allowedWithoutProtocol = allowed.replace(/^https?:\/\//, '');
    const targetWithoutProtocol = normalizedUrl.replace(/^https?:\/\//, '');

    if (doesAllowedUrlMatch(normalizedUrl, allowed)) {
      return true;
    }

    return allowedWithoutProtocol === targetWithoutProtocol;
  });
}

async function shouldBlockUrl(url) {
  if (!url) return false;

  const settings = await getSettings();
  if (!settings.enabled) return false;

  // During pomodoro breaks, all sites are unblocked as a reward
  if (await isOnFocusBreak()) return false;

  if (isUrlWhitelistedWithSettings(url, settings)) {
    return false;
  }

  const domain = extractDomain(url);
  if (!domain) return false;

  // Check if schedule allows unblocks
  const scheduleAllowsUnblock = isInAllowedTimeWindow(settings.schedule);

  // Check temp unblocks first (only if schedule allows)
  if (scheduleAllowsUnblock) {
    const tempUnblocks = (await chrome.storage.local.get('tempUnblocks')).tempUnblocks || {};
    const expiry = getTempUnblockExpiry(tempUnblocks, domain, settings);
    if (expiry) {
      return false;
    }
  }

  return wouldBlockDomain(domain, settings);
}

async function redirectTabIfNeeded(tabId, url, reason = 'navigation') {
  const blockedPageUrl = chrome.runtime.getURL('blocked/blocked.html');
  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
    return;
  }

  if (url.startsWith(blockedPageUrl)) {
    return;
  }

  if (await shouldBlockUrl(url)) {
    await chrome.tabs.update(tabId, {
      url: `${blockedPageUrl}?url=${encodeURIComponent(url)}&reason=${encodeURIComponent(reason)}`
    });
  }
}

/**
 * Handle tab activation - check if we need to block the tab
 */
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      return;
    }

    await redirectTabIfNeeded(activeInfo.tabId, tab.url, 'activated');
  } catch (e) {
    console.error('Tab activation handler error:', e);
  }
});

chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
  if (details.frameId !== 0) {
    return;
  }

  try {
    await redirectTabIfNeeded(details.tabId, details.url, 'history-state-updated');
  } catch (e) {
    console.error('History state navigation handler error:', e);
  }
});

chrome.webNavigation.onReferenceFragmentUpdated.addListener(async (details) => {
  if (details.frameId !== 0) {
    return;
  }

  try {
    await redirectTabIfNeeded(details.tabId, details.url, 'fragment-updated');
  } catch (e) {
    console.error('Fragment navigation handler error:', e);
  }
});

/**
 * Handle tab switching away from unblocked sites - start inactivity timer
 */
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const settings = await getSettings();
    if (!settings.inactivityTimeout || settings.inactivityTimeout <= 0) {
      return; // Inactivity timeout disabled
    }

    // Get all tabs to find which ones we switched away from
    const tempUnblocks = (await chrome.storage.local.get('tempUnblocks')).tempUnblocks || {};
    const activeUnblockDomains = Object.entries(tempUnblocks)
      .filter(([_, expiry]) => isTempUnblockActive(expiry))
      .map(([domain]) => domain);

    if (activeUnblockDomains.length === 0) return;

    // Get the newly active tab
    const activeTab = await chrome.tabs.get(activeInfo.tabId);
    const activeDomain = activeTab.url ? extractDomain(activeTab.url) : null;

    // For each unblocked domain, check if we're still on it
    for (const domain of activeUnblockDomains) {
      const alarmName = `inactivity_${domain}`;
      const keepAlive = domain === TEMP_UNBLOCK_ALL_KEY
        ? wouldBlockDomain(activeDomain, settings)
        : activeDomain === domain || activeDomain === `www.${domain}`;

      if (keepAlive) {
        // We're on this domain, clear any inactivity timer
        await chrome.alarms.clear(alarmName);
      } else {
        // We switched away, start inactivity timer (if not already running)
        const existingAlarm = await chrome.alarms.get(alarmName);
        if (!existingAlarm) {
          chrome.alarms.create(alarmName, { delayInMinutes: settings.inactivityTimeout });
          console.log(`Started inactivity timer for ${domain}: ${settings.inactivityTimeout} minutes`);
        }
      }
    }
  } catch (e) {
    console.error('Inactivity timer handler error:', e);
  }
});

/**
 * Handle window focus changes
 */
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Browser lost focus, start inactivity timers for all unblocked domains
    const settings = await getSettings();
    if (!settings.inactivityTimeout || settings.inactivityTimeout <= 0) return;

    const tempUnblocks = (await chrome.storage.local.get('tempUnblocks')).tempUnblocks || {};

    for (const [domain, expiry] of Object.entries(tempUnblocks)) {
      if (isTempUnblockActive(expiry)) {
        const alarmName = `inactivity_${domain}`;
        const existingAlarm = await chrome.alarms.get(alarmName);
        if (!existingAlarm) {
          chrome.alarms.create(alarmName, { delayInMinutes: settings.inactivityTimeout });
        }
      }
    }
  } else {
    // Browser gained focus, check active tab and clear timer if on unblocked site
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, windowId });
      if (activeTab && activeTab.url) {
        const activeDomain = extractDomain(activeTab.url);
        await chrome.alarms.clear(`inactivity_${activeDomain}`);
        if (wouldBlockDomain(activeDomain, await getSettings())) {
          await chrome.alarms.clear(`inactivity_${TEMP_UNBLOCK_ALL_KEY}`);
        }
      }
    } catch (e) {
      // Ignore errors
    }
  }
});

// =============================================================================
// DAILY LIMIT TRACKING
// =============================================================================

/**
 * Get today's date string for comparison
 */
function getTodayDateString() {
  return new Date().toDateString();
}

/**
 * Get current daily usage, resetting if it's a new day
 */
async function getDailyUsage() {
  const result = await chrome.storage.local.get('dailyUsage');
  let usage = result.dailyUsage || { date: '', minutes: 0 };

  // Reset if it's a new day
  const today = getTodayDateString();
  if (usage.date !== today) {
    usage = { date: today, minutes: 0 };
    await chrome.storage.local.set({ dailyUsage: usage });
  }

  return usage;
}

/**
 * Add time to daily usage
 * @param {number} minutes - Minutes to add
 */
async function addDailyUsage(minutes) {
  const usage = await getDailyUsage();
  usage.minutes += minutes;
  await chrome.storage.local.set({ dailyUsage: usage });
  return usage;
}

/**
 * Check if daily limit is exceeded
 */
async function isDailyLimitExceeded() {
  const settings = await getSettings();
  if (!settings.dailyLimit || !settings.dailyLimit.enabled) {
    return false;
  }

  const usage = await getDailyUsage();
  return usage.minutes >= settings.dailyLimit.minutes;
}

/**
 * Get remaining daily time in minutes
 */
async function getRemainingDailyTime() {
  const settings = await getSettings();
  if (!settings.dailyLimit || !settings.dailyLimit.enabled) {
    return null; // Unlimited
  }

  const usage = await getDailyUsage();
  const remaining = Math.max(0, settings.dailyLimit.minutes - usage.minutes);
  return remaining;
}

/**
 * Start tracking usage for active tab if it's an unblocked blocked-site
 */
async function startUsageTracking() {
  // Clear any existing interval
  if (usageTrackingInterval) {
    clearInterval(usageTrackingInterval);
  }

  const settings = await getSettings();
  if (!settings.dailyLimit || !settings.dailyLimit.enabled) {
    return; // Daily limit not enabled
  }

  // Track every 10 seconds
  usageTrackingInterval = setInterval(async () => {
    await trackActiveTabUsage();
  }, 10000); // 10 seconds

  // Also track immediately
  await trackActiveTabUsage();
}

/**
 * Track usage if user is on an unblocked blocked-site
 */
async function trackActiveTabUsage() {
  try {
    const settings = await getSettings();
    if (!settings.dailyLimit || !settings.dailyLimit.enabled) {
      return;
    }

    // Get active tab
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!activeTab || !activeTab.url || activeTab.url.startsWith('chrome://') || activeTab.url.startsWith('chrome-extension://')) {
      return;
    }

    const domain = extractDomain(activeTab.url);

    // Check if this domain is a blocked site that's currently unblocked
    const tempUnblocks = (await chrome.storage.local.get('tempUnblocks')).tempUnblocks || {};
    const isTemporarilyUnblocked = Boolean(getTempUnblockExpiry(tempUnblocks, domain, settings));

    if (!isTemporarilyUnblocked) {
      return; // Not on an unblocked blocked-site
    }

    const isBlockedSite = wouldBlockDomain(domain, settings);

    if (!isBlockedSite) {
      return; // Not a blocked site
    }

    // Add 10 seconds (1/6 minute) to usage
    const usage = await addDailyUsage(10 / 60);
    console.log(`Daily usage: ${usage.minutes.toFixed(2)} minutes on ${domain}`);

    // Check if limit exceeded
    if (usage.minutes >= settings.dailyLimit.minutes) {
      console.log('Daily limit exceeded, ending all temporary unblocks');
      await enforceDailyLimit();
    }
  } catch (e) {
    console.error('Error tracking active tab usage:', e);
  }
}

/**
 * Enforce daily limit by ending all temp unblocks and blocking sites
 */
async function enforceDailyLimit() {
  const tempUnblocks = (await chrome.storage.local.get('tempUnblocks')).tempUnblocks || {};

  if (Object.keys(tempUnblocks).length === 0) {
    return; // No active unblocks
  }

  const domainsToBlock = Object.keys(tempUnblocks);
  const shouldRedirectAll = domainsToBlock.includes(TEMP_UNBLOCK_ALL_KEY);

  // Clear all temp unblocks
  await chrome.storage.local.set({ tempUnblocks: {} });

  // Clear all related alarms
  for (const domain of domainsToBlock) {
    chrome.alarms.clear(`reblock_${domain}`);
    chrome.alarms.clear(`inactivity_${domain}`);
  }

  // Update blocking rules
  await updateBlockingRules();

  if (shouldRedirectAll) {
    await redirectTabsThatShouldNowBeBlocked('daily-limit');
  }
  await updateBadgeTimer();

  if (!shouldRedirectAll) {
    try {
      const tabs = await chrome.tabs.query({});
      const blockedPageUrl = chrome.runtime.getURL('blocked/blocked.html');

      for (const tab of tabs) {
        if (tab.url) {
          const tabDomain = extractDomain(tab.url);
          if (domainsToBlock.includes(tabDomain) || domainsToBlock.some(d => tabDomain.endsWith('.' + d))) {
            await chrome.tabs.update(tab.id, {
              url: `${blockedPageUrl}?url=${encodeURIComponent(tab.url)}&reason=dailylimit`
            });
          }
        }
      }
    } catch (e) {
      console.error('Error redirecting tabs after daily limit exceeded:', e);
    }
  }
}

/**
 * Schedule midnight reset alarm
 */
function scheduleMidnightReset() {
  // Calculate milliseconds until midnight
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0); // Next midnight

  const msUntilMidnight = midnight.getTime() - now.getTime();
  const minutesUntilMidnight = msUntilMidnight / (60 * 1000);

  // Create alarm for midnight reset
  chrome.alarms.create('midnightReset', { delayInMinutes: minutesUntilMidnight });
  console.log(`Midnight reset alarm scheduled for ${minutesUntilMidnight.toFixed(1)} minutes from now`);
}

function parseTimeStringToMinutes(timeString) {
  if (typeof timeString !== 'string') {
    return null;
  }

  const [hoursString, minutesString] = timeString.split(':');
  const hours = parseInt(hoursString, 10);
  const minutes = parseInt(minutesString, 10);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }

  return (hours * 60) + minutes;
}

function formatTimeForNotification(timeString) {
  const totalMinutes = parseTimeStringToMinutes(timeString);
  if (totalMinutes === null) {
    return timeString;
  }

  const date = new Date();
  date.setHours(Math.floor(totalMinutes / 60), totalMinutes % 60, 0, 0);
  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit'
  });
}

function getNextOccurrenceForTime(timeString) {
  const totalMinutes = parseTimeStringToMinutes(timeString);
  if (totalMinutes === null) {
    return null;
  }

  const now = new Date();
  const next = new Date(now);
  next.setHours(Math.floor(totalMinutes / 60), totalMinutes % 60, 0, 0);

  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

function isWithinReminderWindow(startTime, endTime, now = new Date()) {
  const startMinutes = parseTimeStringToMinutes(startTime);
  const endMinutes = parseTimeStringToMinutes(endTime);

  if (startMinutes === null || endMinutes === null) {
    return false;
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  if (startMinutes === endMinutes) {
    return true;
  }

  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function getReminderWindowKey(startTime, endTime, now = new Date()) {
  const keyDate = new Date(now);
  const startMinutes = parseTimeStringToMinutes(startTime);
  const endMinutes = parseTimeStringToMinutes(endTime);

  if (startMinutes === null || endMinutes === null) {
    return keyDate.toISOString().slice(0, 10);
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const spansMidnight = startMinutes > endMinutes;

  if (spansMidnight && currentMinutes < endMinutes) {
    keyDate.setDate(keyDate.getDate() - 1);
  }

  return keyDate.toISOString().slice(0, 10);
}

function createBedtimeReminderMessage(startTime, endTime) {
  const formattedStart = formatTimeForNotification(startTime);
  const formattedEnd = formatTimeForNotification(endTime);

  return `You planned to get off your computer at ${formattedStart}. Wrap up for the night and stay off until ${formattedEnd}.`;
}

function sendBedtimeReminderNotification(startTime, endTime) {
  chrome.notifications.create(BEDTIME_REMINDER_NOTIFICATION_ID, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Night shutdown reminder',
    message: createBedtimeReminderMessage(startTime, endTime),
    priority: 2,
    requireInteraction: true
  });
}

async function maybeSendBedtimeReminderNotification(settings, now = new Date()) {
  if (!settings?.bedtimeReminderEnabled) {
    return false;
  }

  const startTime = settings.bedtimeReminderTime || DEFAULT_SETTINGS.bedtimeReminderTime;
  const endTime = settings.bedtimeReminderEndTime || DEFAULT_SETTINGS.bedtimeReminderEndTime;

  if (!isWithinReminderWindow(startTime, endTime, now)) {
    return false;
  }

  const windowKey = getReminderWindowKey(startTime, endTime, now);
  const result = await chrome.storage.local.get(BEDTIME_REMINDER_LAST_SENT_KEY);
  if (result[BEDTIME_REMINDER_LAST_SENT_KEY] === windowKey) {
    return false;
  }

  sendBedtimeReminderNotification(startTime, endTime);
  await chrome.storage.local.set({ [BEDTIME_REMINDER_LAST_SENT_KEY]: windowKey });
  return true;
}

async function scheduleBedtimeReminderAlarm(settingsOverride = null) {
  await chrome.alarms.clear(BEDTIME_REMINDER_ALARM);

  const settings = settingsOverride || await getSettings();
  if (!settings.bedtimeReminderEnabled) {
    return;
  }

  await maybeSendBedtimeReminderNotification(settings);

  const nextReminderAt = getNextOccurrenceForTime(settings.bedtimeReminderTime || DEFAULT_SETTINGS.bedtimeReminderTime);
  if (!nextReminderAt) {
    console.warn('Unable to schedule bedtime reminder alarm: invalid reminder time');
    return;
  }

  await chrome.alarms.create(BEDTIME_REMINDER_ALARM, { when: nextReminderAt.getTime() });
  console.log(`Bedtime reminder alarm scheduled for ${nextReminderAt.toLocaleString()}`);
}

// =============================================================================
// FOCUS SESSIONS
// =============================================================================

/**
 * Send a focus session notification
 * @param {string} title - Notification title
 * @param {string} message - Notification body
 */
function sendFocusNotification(title, message) {
  chrome.notifications.create(`focus-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    priority: 2,
    requireInteraction: true
  });
}

// Default focus session presets (fallback if settings haven't loaded)
const DEFAULT_FOCUS_PRESETS = {
  pomodoro: { workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, sessionsBeforeLongBreak: 4 },
  short: { workMinutes: 15, breakMinutes: 3, longBreakMinutes: 10, sessionsBeforeLongBreak: 4 },
  long: { workMinutes: 50, breakMinutes: 10, longBreakMinutes: 20, sessionsBeforeLongBreak: 3 }
};

/**
 * Get focus session presets from user settings
 * @returns {Promise<Object>} The presets object
 */
async function getFocusPresets() {
  const settings = await getSettings();
  return settings.focusPresets || DEFAULT_FOCUS_PRESETS;
}

// Lock to prevent concurrent phase-end handling (avoids duplicate XP, counter increments, etc.)
let _handlingPhaseEnd = false;

/**
 * Get current focus session state
 * @returns {Promise<{active: boolean, type: string, phase: string, endTime: number, sessionsCompleted: number, totalSessionsToday: number}>}
 */
async function getFocusSession() {
  const result = await chrome.storage.local.get('focusSession');
  const session = result.focusSession || {
    active: false,
    type: null,
    phase: null, // 'work', 'break', 'longBreak'
    endTime: null,
    sessionsCompleted: 0, // In current cycle
    totalSessionsToday: 0,
    totalMinutesToday: 0,
    startedAt: null,
    date: null
  };

  // Reset daily totals if it's a new day
  const today = getTodayDateString();
  if (session.date !== today) {
    session.totalSessionsToday = 0;
    session.totalMinutesToday = 0;
    session.date = today;
  }

  // Check if session has expired
  if (session.active && session.endTime && session.endTime <= Date.now()) {
    // Guard against concurrent callers each triggering handleSessionPhaseEnd
    // (e.g., popup timer + alarm firing simultaneously). Without this lock,
    // each caller reads the same expired state and independently awards XP.
    if (_handlingPhaseEnd) {
      // Another call is already handling the phase end; return current state from storage
      // (will be stale for a moment, but the next poll will pick up the updated state)
      return session;
    }
    _handlingPhaseEnd = true;
    try {
      // Session phase ended - handle completion
      return await handleSessionPhaseEnd(session);
    } finally {
      _handlingPhaseEnd = false;
    }
  }

  return session;
}

/**
 * Handle when a session phase ends
 */
async function handleSessionPhaseEnd(session) {
  const presets = await getFocusPresets();
  const preset = presets[session.type] || presets.pomodoro;

  if (session.phase === 'work') {
    // Work phase completed - award XP
    const xpAmount = preset.workMinutes >= 50 ? XP_REWARDS.FOCUS_SESSION_50 : XP_REWARDS.FOCUS_SESSION_25;
    await addXP(xpAmount, `focus_session_${preset.workMinutes}`);

    // Increment session count
    session.sessionsCompleted++;
    session.totalSessionsToday++;
    session.totalMinutesToday += preset.workMinutes;

    // Increment total focus sessions counter (for achievements)
    await incrementTotalFocusSessions();

    // Determine next phase
    if (session.sessionsCompleted >= preset.sessionsBeforeLongBreak) {
      // Full cycle complete — start long break, then stop
      session.phase = 'longBreak';
      session.endTime = Date.now() + (preset.longBreakMinutes * 60 * 1000);
      session.sessionsCompleted = 0; // Reset cycle

      sendFocusNotification(
        'Time for a long break!',
        `Great work! You completed ${preset.sessionsBeforeLongBreak} sessions. Take a ${preset.longBreakMinutes} minute break — all sites are unblocked.`
      );
    } else {
      session.phase = 'break';
      session.endTime = Date.now() + (preset.breakMinutes * 60 * 1000);

      sendFocusNotification(
        'Focus session complete!',
        `Nice work! Take a ${preset.breakMinutes} minute break — all sites are unblocked. (${session.sessionsCompleted}/${preset.sessionsBeforeLongBreak} sessions)`
      );
    }

    // IMPORTANT: Save updated session to storage BEFORE checking achievements.
    // checkAchievements() calls getFocusSession() internally, which reads from storage.
    // If we haven't saved yet, it reads the old expired session and triggers
    // handleSessionPhaseEnd again -> infinite recursion -> runaway CPU/memory/XP.
    await chrome.storage.local.set({ focusSession: session });

    // Set alarm for next phase end
    chrome.alarms.create('focusSessionEnd', { when: session.endTime });

    // Unblock sites for the break
    await updateBlockingRules();

    // Now safe to check achievements (storage has the updated, non-expired session)
    await checkNightOwlAchievement();
    await checkAchievements();
  } else if (session.phase === 'longBreak') {
    // Long break completed — full cycle done, stop the session
    session.active = false;
    session.phase = null;
    session.endTime = null;
    session.startedAt = null;

    await chrome.storage.local.set({ focusSession: session });
    chrome.alarms.clear('focusSessionEnd');

    // Re-enable blocking now that the cycle is over
    await updateBlockingRules();

    sendFocusNotification(
      'Break over — cycle complete!',
      `You finished a full focus cycle. ${session.totalSessionsToday} sessions today (${session.totalMinutesToday} min). Start another when you\'re ready.`
    );
  } else {
    // Short break completed - start new work phase
    session.phase = 'work';
    session.endTime = Date.now() + (preset.workMinutes * 60 * 1000);
    session.startedAt = Date.now();

    await chrome.storage.local.set({ focusSession: session });
    chrome.alarms.create('focusSessionEnd', { when: session.endTime });

    // Re-enable blocking for the work phase
    await updateBlockingRules();

    sendFocusNotification(
      'Break over — time to focus!',
      `Starting a ${preset.workMinutes} minute focus session. Sites are blocked again. (${session.sessionsCompleted + 1}/${preset.sessionsBeforeLongBreak})`
    );
  }

  return session;
}

/**
 * Start a new focus session
 * @param {string} type - Session type: 'pomodoro', 'short', 'long', or 'custom'
 * @param {number} customMinutes - Custom duration in minutes (only if type is 'custom')
 */
async function startFocusSession(type, customMinutes = null) {
  const presets = await getFocusPresets();
  const preset = presets[type] || presets.pomodoro;
  const workMinutes = type === 'custom' && customMinutes ? customMinutes : preset.workMinutes;

  const session = {
    active: true,
    type,
    phase: 'work',
    endTime: Date.now() + (workMinutes * 60 * 1000),
    sessionsCompleted: 0,
    totalSessionsToday: (await getFocusSession()).totalSessionsToday || 0,
    totalMinutesToday: (await getFocusSession()).totalMinutesToday || 0,
    startedAt: Date.now(),
    date: getTodayDateString(),
    customMinutes: type === 'custom' ? customMinutes : null
  };

  await chrome.storage.local.set({ focusSession: session });

  // Set alarm for session end
  chrome.alarms.create('focusSessionEnd', { when: session.endTime });

  sendFocusNotification(
    'Focus session started!',
    `${workMinutes} minute focus session. Let's go!`
  );

  console.log(`Focus session started: ${type} (${workMinutes} min work)`);

  return session;
}

/**
 * Stop the current focus session
 */
async function stopFocusSession() {
  const session = await getFocusSession();

  if (!session.active) {
    return { success: false, error: 'No active session' };
  }

  // Calculate partial work time if in work phase
  let partialMinutes = 0;
  if (session.phase === 'work' && session.startedAt) {
    partialMinutes = Math.floor((Date.now() - session.startedAt) / 60000);
    session.totalMinutesToday += partialMinutes;
  }

  session.active = false;
  session.phase = null;
  session.endTime = null;
  session.startedAt = null;

  await chrome.storage.local.set({ focusSession: session });
  chrome.alarms.clear('focusSessionEnd');

  // Re-enable blocking in case we were on a break
  await updateBlockingRules();

  console.log(`Focus session stopped. Partial minutes: ${partialMinutes}`);

  return { success: true, partialMinutes };
}

/**
 * Skip the current phase (break or work)
 */
async function skipFocusSessionPhase() {
  // Read directly from storage to avoid getFocusSession()'s auto-phase-end handling,
  // since we want to explicitly trigger the phase end here ourselves.
  const result = await chrome.storage.local.get('focusSession');
  const session = result.focusSession;

  if (!session || !session.active) {
    return { success: false, error: 'No active session' };
  }

  chrome.alarms.clear('focusSessionEnd');

  // Trigger phase end handling
  return await handleSessionPhaseEnd(session);
}

/**
 * Get focus session stats for today
 */
async function getFocusSessionStats() {
  const session = await getFocusSession();

  // Get historical data
  const result = await chrome.storage.local.get('focusSessionHistory');
  const history = result.focusSessionHistory || [];

  // Calculate this week's stats
  const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const thisWeekSessions = history.filter(h => h.timestamp > weekAgo);
  const weeklyMinutes = thisWeekSessions.reduce((sum, h) => sum + (h.minutes || 0), 0);
  const weeklySessions = thisWeekSessions.length;

  return {
    todaySessions: session.totalSessionsToday,
    todayMinutes: session.totalMinutesToday,
    weeklySessions,
    weeklyMinutes,
    currentSession: session.active ? {
      type: session.type,
      phase: session.phase,
      remainingMs: session.endTime ? Math.max(0, session.endTime - Date.now()) : 0,
      sessionsCompleted: session.sessionsCompleted
    } : null
  };
}

/**
 * Get all-time statistics for the stats page
 */
async function getAllTimeStats() {
  const totalSessions = await getTotalFocusSessions();

  // Get focus session history for monthly/all-time calculations
  const result = await chrome.storage.local.get('focusSessionHistory');
  const history = result.focusSessionHistory || [];

  // Calculate monthly stats (last 30 days)
  const monthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
  const thisMonthSessions = history.filter(h => h.timestamp > monthAgo);
  const monthlyMinutes = thisMonthSessions.reduce((sum, h) => sum + (h.minutes || 0), 0);
  const monthlySessions = thisMonthSessions.length;

  // Calculate all-time stats
  const totalMinutes = history.reduce((sum, h) => sum + (h.minutes || 0), 0);

  // Get earned time bank for total todos
  const earnedTimeInfo = await getEarnedTimeInfo();

  return {
    totalSessions,
    totalMinutes,
    monthlySessions,
    monthlyMinutes,
    totalTodos: earnedTimeInfo.tasksCompleted || 0
  };
}

async function getBlockedPageCounter() {
  const result = await chrome.storage.local.get('blockedPageCounter');
  return result.blockedPageCounter || 0;
}

async function incrementBlockedPageCounter() {
  const current = await getBlockedPageCounter();
  const nextValue = current + 1;
  await chrome.storage.local.set({ blockedPageCounter: nextValue });
  return nextValue;
}

async function decrementBlockedPageCounter() {
  const current = await getBlockedPageCounter();
  const nextValue = Math.max(0, current - 1);
  await chrome.storage.local.set({ blockedPageCounter: nextValue });
  return nextValue;
}

async function getBlockingSummary() {
  const [settings, displayedBlockCount, lifetimeBlockAttempts, unblockReasons] = await Promise.all([
    getSettings(),
    getBlockedPageCounter(),
    getTotalBlockAttempts(),
    getUnblockReasons()
  ]);

  const totalUnblocks = unblockReasons?.totalCount || 0;
  const resistedCount = Math.max(0, displayedBlockCount);
  const domainStats = unblockReasons?.domainStats || {};
  const topUnblockedEntry = Object.entries(domainStats)
    .sort((a, b) => b[1] - a[1])[0] || null;

  return {
    blockedSiteCount: settings?.blockedSites?.length || 0,
    totalBlockAttempts: displayedBlockCount,
    lifetimeBlockAttempts,
    totalUnblocks,
    resistedCount,
    topUnblockedDomain: topUnblockedEntry?.[0] || null,
    topUnblockedCount: topUnblockedEntry?.[1] || 0
  };
}

// =============================================================================
// MOTIVATIONAL QUOTES
// =============================================================================

const MOTIVATIONAL_QUOTES = [
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Focus on being productive instead of busy.", author: "Tim Ferriss" },
  { text: "It's not that I'm so smart, it's just that I stay with problems longer.", author: "Albert Einstein" },
  { text: "The way to get started is to quit talking and begin doing.", author: "Walt Disney" },
  { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
  { text: "Discipline is choosing between what you want now and what you want most.", author: "Abraham Lincoln" },
  { text: "Your focus determines your reality.", author: "Qui-Gon Jinn" },
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill" },
  { text: "Small daily improvements over time lead to stunning results.", author: "Robin Sharma" },
  { text: "Action is the foundational key to all success.", author: "Pablo Picasso" },
  { text: "The best time to plant a tree was 20 years ago. The second best time is now.", author: "Chinese Proverb" },
  { text: "You don't have to be great to start, but you have to start to be great.", author: "Zig Ziglar" },
  { text: "Productivity is never an accident. It is always the result of a commitment to excellence.", author: "Paul J. Meyer" },
  { text: "Until we can manage time, we can manage nothing else.", author: "Peter Drucker" },
  { text: "The key is not to prioritize what's on your schedule, but to schedule your priorities.", author: "Stephen Covey" },
  { text: "You will never find time for anything. If you want time you must make it.", author: "Charles Buxton" },
  { text: "Lost time is never found again.", author: "Benjamin Franklin" },
  { text: "The bad news is time flies. The good news is you're the pilot.", author: "Michael Altshuler" },
  { text: "Ordinary people think merely of spending time. Great people think of using it.", author: "Arthur Schopenhauer" },
  { text: "Do the hard jobs first. The easy jobs will take care of themselves.", author: "Dale Carnegie" },
  { text: "Amateurs sit and wait for inspiration, the rest of us just get up and go to work.", author: "Stephen King" },
  { text: "The only thing standing between you and your goal is the story you keep telling yourself.", author: "Jordan Belfort" },
  { text: "Start where you are. Use what you have. Do what you can.", author: "Arthur Ashe" },
  { text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
  { text: "What we fear of doing most is usually what we most need to do.", author: "Tim Ferriss" },
  { text: "Great acts are made up of small deeds.", author: "Lao Tzu" },
  { text: "The future depends on what you do today.", author: "Mahatma Gandhi" },
  { text: "Your limitation—it's only your imagination.", author: "Unknown" },
  { text: "Push yourself, because no one else is going to do it for you.", author: "Unknown" },
  { text: "Great things never come from comfort zones.", author: "Unknown" },
  { text: "Dream it. Wish it. Do it.", author: "Unknown" },
  { text: "Success doesn't just find you. You have to go out and get it.", author: "Unknown" },
  { text: "The harder you work for something, the greater you'll feel when you achieve it.", author: "Unknown" },
  { text: "Don't stop when you're tired. Stop when you're done.", author: "Unknown" },
  { text: "Wake up with determination. Go to bed with satisfaction.", author: "Unknown" },
  { text: "Do something today that your future self will thank you for.", author: "Sean Patrick Flanery" },
  { text: "Little things make big days.", author: "Unknown" },
  { text: "It's going to be hard, but hard does not mean impossible.", author: "Unknown" },
  { text: "Don't wait for opportunity. Create it.", author: "Unknown" },
  { text: "Sometimes we're tested not to show our weaknesses, but to discover our strengths.", author: "Unknown" },
  { text: "The distance between your dreams and reality is called action.", author: "Unknown" },
  { text: "Starve your distractions. Feed your focus.", author: "Daniel Goleman" },
  { text: "Work hard in silence. Let success be your noise.", author: "Frank Ocean" },
  { text: "Stay focused, go after your dreams and keep moving toward your goals.", author: "LL Cool J" },
  { text: "Concentration is the secret of strength.", author: "Ralph Waldo Emerson" },
  { text: "Lack of direction, not lack of time, is the problem.", author: "Zig Ziglar" },
  { text: "The successful warrior is the average man, with laser-like focus.", author: "Bruce Lee" },
  { text: "Where focus goes, energy flows.", author: "Tony Robbins" },
  { text: "One way to boost our willpower is to enlist our focus.", author: "Daniel Goleman" },
  { text: "God did not send David to slay Goliath. He sent Goliath, to prove to David that what resides in him is a giant slayer", author: "Michael Irvin" }
];

/**
 * Get a random motivational quote
 * @returns {{text: string, author: string}}
 */
function getRandomQuote() {
  const index = Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length);
  return MOTIVATIONAL_QUOTES[index];
}

/**
 * Get the quote of the day (consistent for the whole day)
 * @returns {{text: string, author: string, index: number}}
 */
async function getQuoteOfTheDay() {
  const today = getTodayDateString();
  const result = await chrome.storage.local.get('quoteOfDay');

  if (result.quoteOfDay && result.quoteOfDay.date === today) {
    return result.quoteOfDay.quote;
  }

  // Generate a new quote for today based on date
  // Use date string to create a consistent "random" index for the day
  const dateHash = today.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  const index = dateHash % MOTIVATIONAL_QUOTES.length;
  const quote = { ...MOTIVATIONAL_QUOTES[index], index };

  await chrome.storage.local.set({ quoteOfDay: { date: today, quote } });

  return quote;
}

// =============================================================================
// XP & LEVELS SYSTEM
// =============================================================================

// Level thresholds (10 levels)
const LEVEL_THRESHOLDS = [
  0,      // Level 1: 0 XP
  100,    // Level 2: 100 XP
  300,    // Level 3: 300 XP
  600,    // Level 4: 600 XP
  1000,   // Level 5: 1000 XP
  1500,   // Level 6: 1500 XP
  2200,   // Level 7: 2200 XP
  3000,   // Level 8: 3000 XP
  4000,   // Level 9: 4000 XP
  5500    // Level 10: 5500 XP
];

const LEVEL_NAMES = [
  'Novice',
  'Apprentice',
  'Focused',
  'Dedicated',
  'Disciplined',
  'Determined',
  'Unstoppable',
  'Master',
  'Grandmaster',
  'Legend'
];

// XP rewards
const XP_REWARDS = {
  COMPLETE_TODO: 10,
  FOCUSED_DAY: 50,
  STREAK_BONUS_3: 25,    // 3 day streak
  STREAK_BONUS_7: 50,    // 7 day streak
  STREAK_BONUS_14: 100,  // 14 day streak
  STREAK_BONUS_30: 200,  // 30 day streak
  BLOCKED_ATTEMPT: 2,    // XP for staying blocked (got redirected)
  FOCUS_SESSION_25: 15,  // Completing a 25min pomodoro
  FOCUS_SESSION_50: 35   // Completing a 50min session
};

/**
 * Get current XP data
 * @returns {Promise<{xp: number, level: number, levelName: string, xpToNextLevel: number, xpProgress: number, totalXpEarned: number}>}
 */
async function getXPData() {
  const result = await chrome.storage.local.get('xpData');
  const data = result.xpData || { xp: 0, totalXpEarned: 0 };

  return calculateLevelInfo(data.xp, data.totalXpEarned);
}

/**
 * Calculate level info from XP
 */
function calculateLevelInfo(xp, totalXpEarned = 0) {
  let level = 1;
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= LEVEL_THRESHOLDS[i]) {
      level = i + 1;
      break;
    }
  }

  const currentLevelXP = LEVEL_THRESHOLDS[level - 1];
  const nextLevelXP = level < LEVEL_THRESHOLDS.length ? LEVEL_THRESHOLDS[level] : null;

  let xpToNextLevel = null;
  let xpProgress = 100;

  if (nextLevelXP !== null) {
    xpToNextLevel = nextLevelXP - xp;
    const levelRange = nextLevelXP - currentLevelXP;
    const progressInLevel = xp - currentLevelXP;
    xpProgress = Math.round((progressInLevel / levelRange) * 100);
  }

  return {
    xp,
    level,
    levelName: LEVEL_NAMES[level - 1],
    xpToNextLevel,
    xpProgress,
    totalXpEarned: totalXpEarned || xp,
    maxLevel: level >= LEVEL_THRESHOLDS.length
  };
}

/**
 * Add XP and check for level up
 * @param {number} amount - Amount of XP to add
 * @param {string} reason - Reason for XP gain
 * @returns {Promise<{newXP: number, levelUp: boolean, newLevel: number, levelName: string}>}
 */
async function addXP(amount, reason = 'unknown') {
  const result = await chrome.storage.local.get('xpData');
  const data = result.xpData || { xp: 0, totalXpEarned: 0 };

  const oldLevel = calculateLevelInfo(data.xp).level;

  data.xp += amount;
  data.totalXpEarned = (data.totalXpEarned || 0) + amount;

  const newInfo = calculateLevelInfo(data.xp, data.totalXpEarned);
  const levelUp = newInfo.level > oldLevel;

  // Save XP data
  await chrome.storage.local.set({ xpData: data });

  // Log XP gain
  console.log(`XP gained: +${amount} (${reason}) - Total: ${data.xp}, Level: ${newInfo.level}`);

  // Record XP history
  await recordXPHistory(amount, reason, newInfo.level, levelUp);

  return {
    newXP: data.xp,
    xpGained: amount,
    levelUp,
    newLevel: newInfo.level,
    levelName: newInfo.levelName,
    ...newInfo
  };
}

/**
 * Record XP gain in history
 */
async function recordXPHistory(amount, reason, level, levelUp) {
  const result = await chrome.storage.local.get('xpHistory');
  const history = result.xpHistory || [];

  history.push({
    amount,
    reason,
    level,
    levelUp,
    timestamp: Date.now()
  });

  // Keep only last 100 entries
  const trimmed = history.slice(-100);
  await chrome.storage.local.set({ xpHistory: trimmed });
}

/**
 * Get XP history
 */
async function getXPHistory() {
  const result = await chrome.storage.local.get('xpHistory');
  return result.xpHistory || [];
}

/**
 * Award XP for completing a todo
 */
async function awardTodoXP() {
  return await addXP(XP_REWARDS.COMPLETE_TODO, 'complete_todo');
}

/**
 * Award daily focus bonus (called at midnight if day was focused)
 */
async function awardDailyFocusXP() {
  const streak = await getStreakData();

  if (streak.todayFocused) {
    let totalXP = XP_REWARDS.FOCUSED_DAY;
    let reason = 'focused_day';

    // Add streak bonuses
    if (streak.currentStreak >= 30) {
      totalXP += XP_REWARDS.STREAK_BONUS_30;
      reason = 'focused_day_streak_30';
    } else if (streak.currentStreak >= 14) {
      totalXP += XP_REWARDS.STREAK_BONUS_14;
      reason = 'focused_day_streak_14';
    } else if (streak.currentStreak >= 7) {
      totalXP += XP_REWARDS.STREAK_BONUS_7;
      reason = 'focused_day_streak_7';
    } else if (streak.currentStreak >= 3) {
      totalXP += XP_REWARDS.STREAK_BONUS_3;
      reason = 'focused_day_streak_3';
    }

    return await addXP(totalXP, reason);
  }

  return null;
}

/**
 * Award XP for being blocked (resisting temptation)
 */
async function awardBlockedAttemptXP() {
  // Rate limit to avoid spam - max once per 5 minutes per domain
  const result = await chrome.storage.local.get('lastBlockedXP');
  const lastTime = result.lastBlockedXP || 0;
  const now = Date.now();

  if (now - lastTime < 5 * 60 * 1000) {
    return null; // Too soon
  }

  await chrome.storage.local.set({ lastBlockedXP: now });
  return await addXP(XP_REWARDS.BLOCKED_ATTEMPT, 'blocked_attempt');
}

// =============================================================================
// STREAK TRACKING
// =============================================================================

/**
 * Get current streak data
 * @returns {Promise<{currentStreak: number, longestStreak: number, lastFocusedDate: string, todayFocused: boolean, history: object[]}>}
 */
async function getStreakData() {
  const result = await chrome.storage.local.get('streakData');
  return result.streakData || {
    currentStreak: 0,
    longestStreak: 0,
    lastFocusedDate: null,
    todayFocused: true, // Assume focused until proven otherwise
    streakStartDate: null,
    history: [] // Last 30 days of focus history
  };
}

/**
 * Check and update streak at start of day
 * Called from midnight reset
 */
async function checkAndUpdateStreak() {
  const streak = await getStreakData();
  const today = getTodayDateString();
  const yesterday = getYesterdayDateString();

  // If we haven't tracked today yet
  if (streak.lastFocusedDate !== today) {
    // Check if yesterday was focused
    if (streak.lastFocusedDate === yesterday && streak.todayFocused) {
      // Continue the streak
      streak.currentStreak += 1;
      streak.longestStreak = Math.max(streak.longestStreak, streak.currentStreak);

      // Add to history
      addToStreakHistory(streak, yesterday, true);
    } else if (streak.lastFocusedDate === yesterday && !streak.todayFocused) {
      // Yesterday broke the streak
      addToStreakHistory(streak, yesterday, false);
      streak.currentStreak = 0;
      streak.streakStartDate = null;
    } else if (streak.lastFocusedDate !== yesterday && streak.currentStreak > 0) {
      // Missed a day - streak broken
      streak.currentStreak = 0;
      streak.streakStartDate = null;
    }

    // Reset for new day
    streak.lastFocusedDate = today;
    streak.todayFocused = true; // Start optimistic

    if (streak.currentStreak === 1 || (streak.currentStreak === 0 && streak.streakStartDate === null)) {
      streak.streakStartDate = today;
    }

    await chrome.storage.local.set({ streakData: streak });
  }

  return streak;
}

/**
 * Add a day to streak history
 */
function addToStreakHistory(streak, date, focused) {
  if (!streak.history) streak.history = [];

  // Check if this date already exists in history
  const existingIndex = streak.history.findIndex(h => h.date === date);
  if (existingIndex >= 0) {
    streak.history[existingIndex].focused = focused;
  } else {
    streak.history.push({ date, focused });
  }

  // Keep only last 30 days
  if (streak.history.length > 30) {
    streak.history = streak.history.slice(-30);
  }
}

/**
 * Get yesterday's date string
 */
function getYesterdayDateString() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toDateString();
}

/**
 * Mark today as unfocused (streak broken)
 * Called when user excessively bypasses blocking
 */
async function markTodayUnfocused() {
  const streak = await getStreakData();
  streak.todayFocused = false;
  await chrome.storage.local.set({ streakData: streak });
  console.log('Today marked as unfocused - streak will be broken at midnight');
  return streak;
}

/**
 * Record an unblock event and check if it breaks streak
 * @param {string} domain - Domain being unblocked
 * @param {number} minutes - Duration of unblock
 */
async function recordUnblockForStreak(domain, minutes) {
  const result = await chrome.storage.local.get('dailyUnblockCount');
  const today = getTodayDateString();

  let unblockData = result.dailyUnblockCount || { date: '', count: 0, totalMinutes: 0 };

  // Reset if it's a new day
  if (unblockData.date !== today) {
    unblockData = { date: today, count: 0, totalMinutes: 0 };
  }

  unblockData.count += 1;
  unblockData.totalMinutes += minutes || 0;

  await chrome.storage.local.set({ dailyUnblockCount: unblockData });

  // Check streak rules:
  // - More than 5 unblocks in a day breaks streak
  // - More than 60 total unblock minutes in a day breaks streak
  const settings = await getSettings();
  const dailyLimit = settings.dailyLimit?.minutes || 30;

  if (unblockData.count > 5 || unblockData.totalMinutes > dailyLimit * 2) {
    await markTodayUnfocused();
  }

  return unblockData;
}

/**
 * Get streak info for UI display
 */
async function getStreakInfo() {
  const streak = await getStreakData();
  const today = getTodayDateString();

  // Make sure we're up to date
  if (streak.lastFocusedDate !== today) {
    await checkAndUpdateStreak();
    return await getStreakData();
  }

  return {
    currentStreak: streak.currentStreak,
    longestStreak: streak.longestStreak,
    todayFocused: streak.todayFocused,
    streakStartDate: streak.streakStartDate,
    history: streak.history || []
  };
}

// =============================================================================
// ACHIEVEMENTS SYSTEM
// =============================================================================

// Achievement definitions
const ACHIEVEMENTS = [
  {
    id: 'first_focus',
    name: 'First Focus',
    description: 'Complete your first focus session',
    icon: '[F]',
    xpReward: 25
  },
  {
    id: 'pomodoro_master',
    name: 'Pomodoro Master',
    description: 'Complete 10 Pomodoro sessions',
    icon: '[P]',
    xpReward: 50
  },
  {
    id: 'streak_3',
    name: 'Getting Started',
    description: 'Achieve a 3-day focus streak',
    icon: '[3]',
    xpReward: 30
  },
  {
    id: 'streak_7',
    name: 'Week Warrior',
    description: 'Achieve a 7-day focus streak',
    icon: '[7]',
    xpReward: 75
  },
  {
    id: 'streak_14',
    name: 'Fortnight Fighter',
    description: 'Achieve a 14-day focus streak',
    icon: '[14]',
    xpReward: 150
  },
  {
    id: 'streak_30',
    name: 'Monthly Master',
    description: 'Achieve a 30-day focus streak',
    icon: '[30]',
    xpReward: 300
  },
  {
    id: 'level_5',
    name: 'Rising Star',
    description: 'Reach level 5',
    icon: '[*]',
    xpReward: 50
  },
  {
    id: 'level_10',
    name: 'Legend',
    description: 'Reach level 10',
    icon: '[T]',
    xpReward: 200
  },
  {
    id: 'todo_10',
    name: 'Task Tackler',
    description: 'Complete 10 todos',
    icon: '[+]',
    xpReward: 25
  },
  {
    id: 'todo_50',
    name: 'Productivity Pro',
    description: 'Complete 50 todos',
    icon: '[50]',
    xpReward: 75
  },
  {
    id: 'todo_100',
    name: 'Century Club',
    description: 'Complete 100 todos',
    icon: '[100]',
    xpReward: 150
  },
  {
    id: 'nuclear_survivor',
    name: 'Nuclear Survivor',
    description: 'Complete a nuclear mode session',
    icon: '[N]',
    xpReward: 100
  },
  {
    id: 'focus_hour',
    name: 'Hour of Power',
    description: 'Complete 60 minutes of focus sessions in one day',
    icon: '[60]',
    xpReward: 40
  },
  {
    id: 'early_bird',
    name: 'Early Bird',
    description: 'Start a focus session before 7 AM',
    icon: '[AM]',
    xpReward: 30
  },
  {
    id: 'night_owl',
    name: 'Night Owl',
    description: 'Complete a focus session after 10 PM',
    icon: '[PM]',
    xpReward: 30
  },
  // Blocking achievements
  {
    id: 'first_block',
    name: 'Gatekeeper',
    description: 'Add your first site to the blocklist',
    icon: '[BL]',
    xpReward: 15
  },
  {
    id: 'block_5',
    name: 'Building Walls',
    description: 'Have 5 or more sites on your blocklist',
    icon: '[B5]',
    xpReward: 25
  },
  {
    id: 'block_15',
    name: 'Digital Fortress',
    description: 'Have 15 or more sites on your blocklist',
    icon: '[B15]',
    xpReward: 50
  },
  // Resisting temptation achievements
  {
    id: 'bouncer_10',
    name: 'Bouncer',
    description: 'Get blocked from distracting sites 10 times',
    icon: '[X10]',
    xpReward: 25
  },
  {
    id: 'bouncer_50',
    name: 'Brick Wall',
    description: 'Get blocked from distracting sites 50 times',
    icon: '[X50]',
    xpReward: 50
  },
  {
    id: 'bouncer_100',
    name: 'Impenetrable',
    description: 'Get blocked from distracting sites 100 times',
    icon: '[X100]',
    xpReward: 100
  },
  // Productivity score achievements
  {
    id: 'productivity_b',
    name: 'Focused Surfer',
    description: 'Achieve a B-grade (65+) productivity score',
    icon: '[B+]',
    xpReward: 50
  },
  {
    id: 'productivity_a',
    name: 'Laser Focus',
    description: 'Achieve an A-grade (80+) productivity score',
    icon: '[A+]',
    xpReward: 100
  }
];

/**
 * Get all achievements with their unlock status
 * @returns {Promise<{achievements: object[], unlockedCount: number, totalCount: number}>}
 */
async function getAchievements() {
  const result = await chrome.storage.local.get('unlockedAchievements');
  const unlocked = result.unlockedAchievements || {};

  const achievements = ACHIEVEMENTS.map(achievement => ({
    ...achievement,
    unlocked: !!unlocked[achievement.id],
    unlockedAt: unlocked[achievement.id]?.unlockedAt || null
  }));

  const unlockedCount = Object.keys(unlocked).length;

  return {
    achievements,
    unlockedCount,
    totalCount: ACHIEVEMENTS.length
  };
}

/**
 * Unlock an achievement
 * @param {string} achievementId - Achievement to unlock
 * @returns {Promise<{success: boolean, achievement: object|null, alreadyUnlocked: boolean}>}
 */
async function unlockAchievement(achievementId) {
  const result = await chrome.storage.local.get('unlockedAchievements');
  const unlocked = result.unlockedAchievements || {};

  // Check if already unlocked
  if (unlocked[achievementId]) {
    return { success: false, achievement: null, alreadyUnlocked: true };
  }

  // Find achievement definition
  const achievement = ACHIEVEMENTS.find(a => a.id === achievementId);
  if (!achievement) {
    return { success: false, achievement: null, alreadyUnlocked: false };
  }

  // Unlock the achievement
  unlocked[achievementId] = {
    unlockedAt: Date.now()
  };

  await chrome.storage.local.set({ unlockedAchievements: unlocked });

  // Award XP for unlocking
  if (achievement.xpReward) {
    await addXP(achievement.xpReward, `achievement_${achievementId}`);
  }

  console.log(`Achievement unlocked: ${achievement.name} (+${achievement.xpReward} XP)`);

  return { success: true, achievement, alreadyUnlocked: false };
}

/**
 * Check and unlock achievements based on current stats
 * Call this after relevant events
 */
async function checkAchievements() {
  const newlyUnlocked = [];

  // Get current stats
  const focusSession = await getFocusSession();
  const focusStats = await getFocusSessionStats();
  const streakInfo = await getStreakInfo();
  const xpData = await getXPData();
  const earnedTimeInfo = await getEarnedTimeInfo();

  // Check focus session achievements
  if (focusStats.todaySessions >= 1) {
    const result = await unlockAchievement('first_focus');
    if (result.success) newlyUnlocked.push(result.achievement);
  }

  // Check pomodoro master (need to track total sessions)
  const sessionHistory = await getTotalFocusSessions();
  if (sessionHistory >= 10) {
    const result = await unlockAchievement('pomodoro_master');
    if (result.success) newlyUnlocked.push(result.achievement);
  }

  // Check streak achievements
  if (streakInfo.currentStreak >= 3) {
    const result = await unlockAchievement('streak_3');
    if (result.success) newlyUnlocked.push(result.achievement);
  }
  if (streakInfo.currentStreak >= 7) {
    const result = await unlockAchievement('streak_7');
    if (result.success) newlyUnlocked.push(result.achievement);
  }
  if (streakInfo.currentStreak >= 14) {
    const result = await unlockAchievement('streak_14');
    if (result.success) newlyUnlocked.push(result.achievement);
  }
  if (streakInfo.currentStreak >= 30) {
    const result = await unlockAchievement('streak_30');
    if (result.success) newlyUnlocked.push(result.achievement);
  }

  // Check level achievements
  if (xpData.level >= 5) {
    const result = await unlockAchievement('level_5');
    if (result.success) newlyUnlocked.push(result.achievement);
  }
  if (xpData.level >= 10) {
    const result = await unlockAchievement('level_10');
    if (result.success) newlyUnlocked.push(result.achievement);
  }

  // Check todo achievements
  if (earnedTimeInfo.tasksCompleted >= 10) {
    const result = await unlockAchievement('todo_10');
    if (result.success) newlyUnlocked.push(result.achievement);
  }
  if (earnedTimeInfo.tasksCompleted >= 50) {
    const result = await unlockAchievement('todo_50');
    if (result.success) newlyUnlocked.push(result.achievement);
  }
  if (earnedTimeInfo.tasksCompleted >= 100) {
    const result = await unlockAchievement('todo_100');
    if (result.success) newlyUnlocked.push(result.achievement);
  }

  // Check focus hour achievement
  if (focusStats.todayMinutes >= 60) {
    const result = await unlockAchievement('focus_hour');
    if (result.success) newlyUnlocked.push(result.achievement);
  }

  // Check time-based achievements
  const now = new Date();
  const hour = now.getHours();

  if (focusSession.active && focusSession.phase === 'work') {
    if (hour < 7) {
      const result = await unlockAchievement('early_bird');
      if (result.success) newlyUnlocked.push(result.achievement);
    }
  }

  // Night owl is checked when session completes (after 10 PM)

  // Check blocking achievements (blocklist size + block attempts)
  const blockingUnlocked = await checkBlockingAchievements();
  newlyUnlocked.push(...blockingUnlocked);

  // Check productivity score achievements (from browser history)
  const productivityUnlocked = await checkProductivityAchievements();
  newlyUnlocked.push(...productivityUnlocked);

  return newlyUnlocked;
}

/**
 * Check for nuclear survivor achievement
 * Called when nuclear mode ends
 */
async function checkNuclearSurvivorAchievement() {
  const result = await unlockAchievement('nuclear_survivor');
  if (result.success) {
    console.log('Nuclear Survivor achievement unlocked!');
  }
  return result;
}

/**
 * Check for night owl achievement
 * Called when a focus session completes
 */
async function checkNightOwlAchievement() {
  const hour = new Date().getHours();
  if (hour >= 22) {
    const result = await unlockAchievement('night_owl');
    if (result.success) {
      console.log('Night Owl achievement unlocked!');
    }
    return result;
  }
  return { success: false };
}

/**
 * Get total focus sessions completed (all time)
 */
async function getTotalFocusSessions() {
  const result = await chrome.storage.local.get('totalFocusSessions');
  return result.totalFocusSessions || 0;
}

/**
 * Increment total focus sessions counter
 */
async function incrementTotalFocusSessions() {
  const current = await getTotalFocusSessions();
  await chrome.storage.local.set({ totalFocusSessions: current + 1 });
  return current + 1;
}

/**
 * Get total block attempts (all time)
 * Tracks how many times the user was blocked from visiting a distracting site
 */
async function getTotalBlockAttempts() {
  const result = await chrome.storage.local.get('totalBlockAttempts');
  return result.totalBlockAttempts || 0;
}

/**
 * Increment total block attempts counter
 * Called each time the blocked page is shown
 */
async function incrementBlockAttempts() {
  const current = await getTotalBlockAttempts();
  const newTotal = current + 1;
  await chrome.storage.local.set({ totalBlockAttempts: newTotal });
  await incrementBlockedPageCounter();

  // Check achievements after incrementing
  await checkBlockingAchievements();

  return newTotal;
}

/**
 * Check blocking-related achievements specifically
 * Called after a block attempt or when blocklist changes
 */
async function checkBlockingAchievements() {
  const newlyUnlocked = [];
  const settings = await getSettings();
  const blockedCount = settings.blockedSites?.length || 0;
  const blockAttempts = await getTotalBlockAttempts();

  // Blocklist size achievements
  if (blockedCount >= 1) {
    const result = await unlockAchievement('first_block');
    if (result.success) newlyUnlocked.push(result.achievement);
  }
  if (blockedCount >= 5) {
    const result = await unlockAchievement('block_5');
    if (result.success) newlyUnlocked.push(result.achievement);
  }
  if (blockedCount >= 15) {
    const result = await unlockAchievement('block_15');
    if (result.success) newlyUnlocked.push(result.achievement);
  }

  // Block attempt (resisting temptation) achievements
  if (blockAttempts >= 10) {
    const result = await unlockAchievement('bouncer_10');
    if (result.success) newlyUnlocked.push(result.achievement);
  }
  if (blockAttempts >= 50) {
    const result = await unlockAchievement('bouncer_50');
    if (result.success) newlyUnlocked.push(result.achievement);
  }
  if (blockAttempts >= 100) {
    const result = await unlockAchievement('bouncer_100');
    if (result.success) newlyUnlocked.push(result.achievement);
  }

  return newlyUnlocked;
}

/**
 * Check productivity score achievements
 * Called periodically or when browsing history analysis runs
 */
async function checkProductivityAchievements() {
  const newlyUnlocked = [];

  try {
    const productivityData = await getProductivityScore(7);
    if (productivityData.error) return newlyUnlocked;

    if (productivityData.score >= 65) {
      const result = await unlockAchievement('productivity_b');
      if (result.success) newlyUnlocked.push(result.achievement);
    }
    if (productivityData.score >= 80) {
      const result = await unlockAchievement('productivity_a');
      if (result.success) newlyUnlocked.push(result.achievement);
    }
  } catch (e) {
    console.error('Error checking productivity achievements:', e);
  }

  return newlyUnlocked;
}

// =============================================================================
// NUCLEAR MODE
// =============================================================================

/**
 * Get nuclear mode status
 * @returns {Promise<{active: boolean, expiresAt: number|null, remainingMs: number|null}>}
 */
async function getNuclearStatus() {
  const result = await chrome.storage.local.get('nuclearMode');
  const nuclear = result.nuclearMode || { active: false, expiresAt: null };

  // Check if nuclear mode has expired
  if (nuclear.active && nuclear.expiresAt && nuclear.expiresAt <= Date.now()) {
    // Nuclear mode expired, deactivate it
    await chrome.storage.local.set({ nuclearMode: { active: false, expiresAt: null } });
    return { active: false, expiresAt: null, remainingMs: null };
  }

  const remainingMs = nuclear.active && nuclear.expiresAt ? nuclear.expiresAt - Date.now() : null;

  return {
    active: nuclear.active,
    expiresAt: nuclear.expiresAt,
    remainingMs
  };
}

/**
 * Activate nuclear mode
 * @param {number} minutes - Duration in minutes
 * @returns {Promise<{success: boolean, expiresAt: number}>}
 */
async function activateNuclearMode(minutes) {
  const expiresAt = Date.now() + (minutes * 60 * 1000);

  await chrome.storage.local.set({
    nuclearMode: {
      active: true,
      expiresAt,
      activatedAt: Date.now(),
      durationMinutes: minutes
    }
  });

  // End all current temporary unblocks
  const tempUnblocks = (await chrome.storage.local.get('tempUnblocks')).tempUnblocks || {};
  const domainsToBlock = Object.keys(tempUnblocks);
  const shouldRedirectAll = domainsToBlock.includes(TEMP_UNBLOCK_ALL_KEY);

  if (domainsToBlock.length > 0) {
    // Clear all temp unblocks
    await chrome.storage.local.set({ tempUnblocks: {} });

    // Clear all related alarms
    for (const domain of domainsToBlock) {
      chrome.alarms.clear(`reblock_${domain}`);
      chrome.alarms.clear(`inactivity_${domain}`);
    }

    // Update blocking rules
    await updateBlockingRules();

    try {
      if (shouldRedirectAll) {
        await redirectTabsThatShouldNowBeBlocked('nuclear');
      } else {
        const tabs = await chrome.tabs.query({});
        const blockedPageUrl = chrome.runtime.getURL('blocked/blocked.html');
        const settings = await getSettings();

        for (const tab of tabs) {
          if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
            const tabDomain = extractDomain(tab.url);
            const isBlockedSite = settings.blockedSites.some(site => {
              const blockedDomain = site.replace(/^www\./, '');
              return tabDomain === blockedDomain || tabDomain.endsWith('.' + blockedDomain);
            });

            if (isBlockedSite) {
              await chrome.tabs.update(tab.id, {
                url: `${blockedPageUrl}?url=${encodeURIComponent(tab.url)}&reason=nuclear`
              });
            }
          }
        }
      }
    } catch (e) {
      console.error('Error redirecting tabs after nuclear mode activation:', e);
    }
  }

  // Set alarm for when nuclear mode expires
  chrome.alarms.create('nuclearModeEnd', { delayInMinutes: minutes });

  // Update badge
  await updateBadgeTimer();

  console.log(`Nuclear mode activated for ${minutes} minutes, expires at ${new Date(expiresAt).toLocaleTimeString()}`);

  return { success: true, expiresAt };
}

/**
 * Check if nuclear mode is blocking unblocks
 * @returns {Promise<boolean>}
 */
async function isNuclearModeActive() {
  const status = await getNuclearStatus();
  return status.active;
}

// =============================================================================
// EARNED TIME TRACKING
// =============================================================================

/**
 * Get current earned time bank
 * @returns {Promise<{minutes: number, tasksCompleted: number, totalEarned: number, totalUsed: number}>}
 */
async function getEarnedTimeBank() {
  const result = await chrome.storage.local.get('earnedTimeBank');
  return result.earnedTimeBank || { minutes: 0, tasksCompleted: 0, totalEarned: 0, totalUsed: 0 };
}

/**
 * Extend any active timed unblocks by the given number of minutes.
 * @param {number} minutesToAdd - Minutes to add to active timed unblocks
 * @returns {Promise<{added: number, extendedDomains: string[]}>}
 */
async function extendActiveTimedUnblocks(minutesToAdd) {
  if (minutesToAdd <= 0) {
    return { added: 0, extendedDomains: [] };
  }

  const tempUnblocks = (await chrome.storage.local.get('tempUnblocks')).tempUnblocks || {};
  const settings = await getSettings();
  const now = Date.now();
  const requestedMs = minutesToAdd * 60 * 1000;
  const windowEnd = getCurrentWindowEndTime(settings.schedule);

  let maxAddedMs = 0;
  const extendedDomains = [];

  for (const [domain, expiry] of Object.entries(tempUnblocks)) {
    if (expiry === 'unlimited' || expiry <= now) {
      continue;
    }

    let newExpiry = expiry + requestedMs;
    if (windowEnd) {
      newExpiry = Math.min(newExpiry, windowEnd);
    }

    if (newExpiry <= expiry) {
      continue;
    }

    tempUnblocks[domain] = newExpiry;
    extendedDomains.push(domain);
    maxAddedMs = Math.max(maxAddedMs, newExpiry - expiry);

    chrome.alarms.clear(`reblock_${domain}`);
    chrome.alarms.create(`reblock_${domain}`, { when: newExpiry });
  }

  if (extendedDomains.length === 0) {
    return { added: 0, extendedDomains: [] };
  }

  await chrome.storage.local.set({ tempUnblocks });
  await updateBadgeTimer();

  const addedMinutes = Math.round((maxAddedMs / 60000) * 10) / 10;
  console.log(`Extended active timed unblocks by ${addedMinutes} minutes: ${extendedDomains.join(', ')}`);

  return { added: addedMinutes, extendedDomains };
}

/**
 * Reward completed tasks with banked time and/or active session extensions.
 * @param {number} taskCount - Number of tasks completed (default 1)
 * @returns {Promise<{minutes: number, tasksCompleted: number, totalEarned: number, totalUsed: number, added: number, bankAdded: number, sessionAdded: number, rewardType: string}>}
 */
async function rewardCompletedTasks(taskCount = 1) {
  const settings = await getSettings();
  const earnedTimeSettings = settings.earnedTime || {
    enabled: false,
    minutesPerTask: 5,
    maxBankMinutes: 60,
    requireTasksToUnlock: false,
    addToActiveUnblock: false
  };

  if (!earnedTimeSettings.enabled) {
    return {
      minutes: 0,
      tasksCompleted: 0,
      totalEarned: 0,
      totalUsed: 0,
      added: 0,
      bankAdded: 0,
      sessionAdded: 0,
      rewardType: 'disabled'
    };
  }

  const requestedMinutes = taskCount * earnedTimeSettings.minutesPerTask;
  const sessionResult = earnedTimeSettings.addToActiveUnblock
    ? await extendActiveTimedUnblocks(requestedMinutes)
    : { added: 0, extendedDomains: [] };

  const bank = await getEarnedTimeBank();
  const minutesToAdd = Math.max(0, requestedMinutes - sessionResult.added);
  const maxBank = earnedTimeSettings.maxBankMinutes || 60;

  // Add minutes, capped at max bank
  const newMinutes = Math.min(bank.minutes + minutesToAdd, maxBank);
  const bankAdded = newMinutes - bank.minutes;
  const totalAdded = sessionResult.added + bankAdded;

  let rewardType = 'none';
  if (sessionResult.added > 0 && bankAdded > 0) {
    rewardType = 'split';
  } else if (sessionResult.added > 0) {
    rewardType = 'session';
  } else if (bankAdded > 0) {
    rewardType = 'bank';
  }

  const newBank = {
    minutes: newMinutes,
    tasksCompleted: bank.tasksCompleted + taskCount,
    totalEarned: (bank.totalEarned || 0) + totalAdded,
    totalUsed: (bank.totalUsed || 0) + sessionResult.added
  };

  await chrome.storage.local.set({ earnedTimeBank: newBank });
  console.log(`Earned time reward: +${totalAdded} minutes (bank: ${newBank.minutes}/${maxBank} min, active session: +${sessionResult.added} min)`);

  // Award XP for completing todos
  for (let i = 0; i < taskCount; i++) {
    await awardTodoXP();
  }

  // Check for todo-related achievements
  await checkAchievements();

  return {
    ...newBank,
    added: totalAdded,
    bankAdded,
    sessionAdded: sessionResult.added,
    rewardType,
    extendedDomains: sessionResult.extendedDomains
  };
}

/**
 * Use earned time from bank
 * @param {number} minutes - Minutes to deduct
 * @returns {Promise<{success: boolean, remaining: number, used: number}>}
 */
async function useEarnedTime(minutes) {
  const bank = await getEarnedTimeBank();

  if (bank.minutes < minutes) {
    return { success: false, remaining: bank.minutes, used: 0 };
  }

  const newBank = {
    minutes: bank.minutes - minutes,
    tasksCompleted: bank.tasksCompleted,
    totalEarned: bank.totalEarned || 0,
    totalUsed: (bank.totalUsed || 0) + minutes
  };

  await chrome.storage.local.set({ earnedTimeBank: newBank });
  console.log(`Used earned time: -${minutes} minutes (remaining: ${newBank.minutes} min)`);

  return { success: true, remaining: newBank.minutes, used: minutes };
}

/**
 * Get earned time info for UI display
 * @returns {Promise<Object>}
 */
async function getEarnedTimeInfo() {
  const settings = await getSettings();
  const earnedTimeSettings = settings.earnedTime || { enabled: false, minutesPerTask: 5, maxBankMinutes: 60, requireTasksToUnlock: false, addToActiveUnblock: false };

  if (!earnedTimeSettings.enabled) {
    return {
      enabled: false,
      minutes: 0,
      tasksCompleted: 0,
      totalEarned: 0,
      totalUsed: 0,
      minutesPerTask: 5,
      maxBankMinutes: 60,
      requireTasksToUnlock: false,
      addToActiveUnblock: false
    };
  }

  const bank = await getEarnedTimeBank();

  return {
    enabled: true,
    minutes: bank.minutes,
    tasksCompleted: bank.tasksCompleted,
    totalEarned: bank.totalEarned || 0,
    totalUsed: bank.totalUsed || 0,
    minutesPerTask: earnedTimeSettings.minutesPerTask,
    maxBankMinutes: earnedTimeSettings.maxBankMinutes,
    requireTasksToUnlock: earnedTimeSettings.requireTasksToUnlock,
    addToActiveUnblock: earnedTimeSettings.addToActiveUnblock || false
  };
}

async function getCompleteTodoProgress() {
  const settings = await getSettings();
  const methodSettings = normalizeCompleteTodoSettings(settings.unblockMethods?.completeTodo);

  if (!methodSettings.enabled) {
    return {
      enabled: false,
      mode: methodSettings.mode,
      requiredCount: methodSettings.requiredCount,
      completedCount: 0,
      remainingCount: 0,
      satisfied: false
    };
  }

  if (methodSettings.mode === 'daily') {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const since = startOfDay.toISOString();
    const until = today.toISOString();

    try {
      const module = await import('./lib/todoist.js');
      const completedTasks = await module.getCompletedTasks({ since, until, limit: 200 });
      const completedCount = completedTasks.length;
      const remainingCount = Math.max(0, methodSettings.requiredCount - completedCount);

      return {
        enabled: true,
        mode: 'daily',
        requiredCount: methodSettings.requiredCount,
        completedCount,
        remainingCount,
        satisfied: completedCount >= methodSettings.requiredCount
      };
    } catch (error) {
      console.error('Failed to get daily task completion progress:', error);
      return {
        enabled: true,
        mode: 'daily',
        requiredCount: methodSettings.requiredCount,
        completedCount: 0,
        remainingCount: methodSettings.requiredCount,
        satisfied: false,
        error: error.message
      };
    }
  }

  return {
    enabled: true,
    mode: 'single',
    requiredCount: 1,
    completedCount: 0,
    remainingCount: 1,
    satisfied: false
  };
}

/**
 * Reset earned time bank
 */
async function resetEarnedTimeBank() {
  await chrome.storage.local.set({ earnedTimeBank: { minutes: 0, tasksCompleted: 0 } });
  return { success: true };
}

// =============================================================================
// SITE CATEGORIES
// =============================================================================

/**
 * Get all site categories
 * @returns {Promise<Array>}
 */
async function getCategories() {
  const settings = await getSettings();
  return settings.categories || [];
}

/**
 * Get category templates for adding predefined categories
 * @returns {Object}
 */
function getCategoryTemplates() {
  return CATEGORY_TEMPLATES;
}

/**
 * Create a new category
 * @param {Object} category - Category object with name, icon, sites
 * @returns {Promise<{success: boolean, category: Object}>}
 */
async function createCategory(category) {
  const settings = await getSettings();
  const categories = settings.categories || [];

  // Generate unique ID
  const id = `category-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const newCategory = {
    id,
    name: category.name || 'New Category',
    icon: category.icon || 'CT',
    sites: category.sites || [],
    enabled: category.enabled || false
  };

  categories.push(newCategory);

  await saveProfileSettings({ categories });
  await updateBlockingRules();

  return { success: true, category: newCategory };
}

/**
 * Update an existing category
 * @param {string} categoryId - Category ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<{success: boolean, category: Object}>}
 */
async function updateCategory(categoryId, updates) {
  const settings = await getSettings();
  const categories = settings.categories || [];

  const index = categories.findIndex(c => c.id === categoryId);
  if (index === -1) {
    return { success: false, error: 'Category not found' };
  }

  // Merge updates
  categories[index] = {
    ...categories[index],
    ...updates,
    id: categoryId // Ensure ID doesn't change
  };

  await saveProfileSettings({ categories });
  await updateBlockingRules();

  return { success: true, category: categories[index] };
}

/**
 * Delete a category
 * @param {string} categoryId - Category ID
 * @returns {Promise<{success: boolean}>}
 */
async function deleteCategory(categoryId) {
  const settings = await getSettings();
  const categories = settings.categories || [];

  const index = categories.findIndex(c => c.id === categoryId);
  if (index === -1) {
    return { success: false, error: 'Category not found' };
  }

  categories.splice(index, 1);

  await saveProfileSettings({ categories });
  await updateBlockingRules();

  return { success: true };
}

/**
 * Toggle category enabled/disabled
 * @param {string} categoryId - Category ID
 * @returns {Promise<{success: boolean, enabled: boolean}>}
 */
async function toggleCategory(categoryId) {
  const settings = await getSettings();
  const categories = settings.categories || [];

  const category = categories.find(c => c.id === categoryId);
  if (!category) {
    return { success: false, error: 'Category not found' };
  }

  category.enabled = !category.enabled;

  await saveProfileSettings({ categories });
  await updateBlockingRules();

  return { success: true, enabled: category.enabled };
}

/**
 * Add a site to a category
 * @param {string} categoryId - Category ID
 * @param {string} site - Site domain
 * @returns {Promise<{success: boolean, sites: Array}>}
 */
async function addSiteToCategory(categoryId, site) {
  const settings = await getSettings();
  const categories = settings.categories || [];

  const category = categories.find(c => c.id === categoryId);
  if (!category) {
    return { success: false, error: 'Category not found' };
  }

  const domain = extractDomain(site);
  if (!category.sites.includes(domain)) {
    category.sites.push(domain);

    await saveProfileSettings({ categories });
    await updateBlockingRules();
  }

  return { success: true, sites: category.sites };
}

/**
 * Remove a site from a category
 * @param {string} categoryId - Category ID
 * @param {string} site - Site domain
 * @returns {Promise<{success: boolean, sites: Array}>}
 */
async function removeSiteFromCategory(categoryId, site) {
  const settings = await getSettings();
  const categories = settings.categories || [];

  const category = categories.find(c => c.id === categoryId);
  if (!category) {
    return { success: false, error: 'Category not found' };
  }

  const domain = extractDomain(site);
  category.sites = category.sites.filter(s => s !== domain);

  await saveProfileSettings({ categories });
  await updateBlockingRules();

  return { success: true, sites: category.sites };
}

/**
 * Add a category from a template
 * @param {string} templateKey - Template key (e.g., 'socialMedia')
 * @returns {Promise<{success: boolean, category: Object}>}
 */
async function addCategoryFromTemplate(templateKey) {
  const template = CATEGORY_TEMPLATES[templateKey];
  if (!template) {
    return { success: false, error: 'Template not found' };
  }

  return await createCategory({
    name: template.name,
    icon: template.icon,
    sites: [...template.sites],
    enabled: false
  });
}

/**
 * Get all sites that should be blocked from enabled categories
 * @returns {Promise<Set<string>>}
 */
async function getBlockedSitesFromCategories() {
  const settings = await getSettings();
  const categories = settings.categories || [];

  const blockedSites = new Set();
  for (const category of categories) {
    if (category.enabled) {
      for (const site of category.sites) {
        blockedSites.add(extractDomain(site));
      }
    }
  }

  return blockedSites;
}

// =============================================================================
// KEYWORD BLOCKING
// =============================================================================

/**
 * Get blocked keywords settings
 * @returns {Promise<{enabled: boolean, keywords: Array}>}
 */
async function getBlockedKeywords() {
  const settings = await getSettings();
  return settings.blockedKeywords || { enabled: false, keywords: [] };
}

/**
 * Add a blocked keyword
 * @param {string} keyword - Keyword to block
 * @param {boolean} caseSensitive - Whether matching is case-sensitive
 * @returns {Promise<{success: boolean, keywords: Array}>}
 */
async function addBlockedKeyword(keyword, caseSensitive = false) {
  const settings = await getSettings();
  const blockedKeywords = settings.blockedKeywords || { enabled: false, keywords: [] };

  const trimmedKeyword = keyword.trim();
  if (!trimmedKeyword) {
    return { success: false, error: 'Keyword cannot be empty' };
  }

  // Check if keyword already exists
  const exists = blockedKeywords.keywords.some(k =>
    k.keyword.toLowerCase() === trimmedKeyword.toLowerCase()
  );

  if (exists) {
    return { success: false, error: 'Keyword already exists' };
  }

  blockedKeywords.keywords.push({
    keyword: trimmedKeyword,
    caseSensitive
  });

  await saveProfileSettings({ blockedKeywords });
  await updateBlockingRules();

  return { success: true, keywords: blockedKeywords.keywords };
}

/**
 * Remove a blocked keyword
 * @param {string} keyword - Keyword to remove
 * @returns {Promise<{success: boolean, keywords: Array}>}
 */
async function removeBlockedKeyword(keyword) {
  const settings = await getSettings();
  const blockedKeywords = settings.blockedKeywords || { enabled: false, keywords: [] };

  const index = blockedKeywords.keywords.findIndex(k =>
    k.keyword.toLowerCase() === keyword.toLowerCase()
  );

  if (index === -1) {
    return { success: false, error: 'Keyword not found' };
  }

  blockedKeywords.keywords.splice(index, 1);

  await saveProfileSettings({ blockedKeywords });
  await updateBlockingRules();

  return { success: true, keywords: blockedKeywords.keywords };
}

/**
 * Toggle keyword blocking enabled/disabled
 * @returns {Promise<{success: boolean, enabled: boolean}>}
 */
async function toggleKeywordBlocking() {
  const settings = await getSettings();
  const blockedKeywords = settings.blockedKeywords || { enabled: false, keywords: [] };

  blockedKeywords.enabled = !blockedKeywords.enabled;

  await saveProfileSettings({ blockedKeywords });
  await updateBlockingRules();

  return { success: true, enabled: blockedKeywords.enabled };
}

/**
 * Update a keyword's settings (e.g., case sensitivity)
 * @param {string} keyword - The keyword to update
 * @param {Object} updates - Updates to apply
 * @returns {Promise<{success: boolean, keywords: Array}>}
 */
async function updateBlockedKeyword(keyword, updates) {
  const settings = await getSettings();
  const blockedKeywords = settings.blockedKeywords || { enabled: false, keywords: [] };

  const keywordObj = blockedKeywords.keywords.find(k =>
    k.keyword.toLowerCase() === keyword.toLowerCase()
  );

  if (!keywordObj) {
    return { success: false, error: 'Keyword not found' };
  }

  // Apply updates
  if (updates.caseSensitive !== undefined) {
    keywordObj.caseSensitive = updates.caseSensitive;
  }
  if (updates.keyword !== undefined) {
    keywordObj.keyword = updates.keyword.trim();
  }

  await saveProfileSettings({ blockedKeywords });
  await updateBlockingRules();

  return { success: true, keywords: blockedKeywords.keywords };
}

// =============================================================================
// URL WHITELIST
// =============================================================================

/**
 * Get allowed URLs
 * @returns {Promise<Array>}
 */
async function getAllowedUrls() {
  const settings = await getSettings();
  return settings.allowedUrls || [];
}

async function getAllowedUrlsWithReasons() {
  const [allowedUrls, result] = await Promise.all([
    getAllowedUrls(),
    chrome.storage.local.get('whitelistUrlReasons')
  ]);

  const reasonEntries = result.whitelistUrlReasons || [];
  const latestReasonByUrl = new Map();

  for (const entry of reasonEntries) {
    if (!entry?.url || !entry?.reason) {
      continue;
    }

    const existingEntry = latestReasonByUrl.get(entry.url);
    if (!existingEntry || (entry.timestamp || 0) > (existingEntry.timestamp || 0)) {
      latestReasonByUrl.set(entry.url, entry);
    }
  }

  return allowedUrls.map((url) => {
    const latestEntry = latestReasonByUrl.get(url);
    return {
      url,
      reason: latestEntry?.reason || '',
      reasonTimestamp: latestEntry?.timestamp || null
    };
  });
}

/**
 * Add a URL to the whitelist
 * @param {string} url - URL to allow
 * @returns {Promise<{success: boolean, allowedUrls: Array}>}
 */
async function addAllowedUrl(url) {
  const settings = await getSettings();
  const allowedUrls = settings.allowedUrls || [];
  const normalizedResult = normalizeAllowedUrlInput(url);
  if (!normalizedResult.success) {
    return normalizedResult;
  }

  const { normalizedUrl } = normalizedResult;

  // Check if URL already exists
  if (allowedUrls.includes(normalizedUrl)) {
    return { success: false, error: 'URL already whitelisted' };
  }

  allowedUrls.push(normalizedUrl);

  await saveProfileSettings({ allowedUrls });
  await updateBlockingRules();

  return { success: true, allowedUrls };
}

async function saveAllowedUrlReason(url, domain, reason) {
  const result = await chrome.storage.local.get('whitelistUrlReasons');
  const reasons = result.whitelistUrlReasons || [];

  let derivedDomain = normalizeTrackedDomain(domain);
  try {
    if (!isMeaningfulTrackedDomain(derivedDomain)) {
      derivedDomain = normalizeTrackedDomain(new URL(url).hostname);
    }
  } catch {
    // Keep the existing fallback domain if URL parsing fails.
  }

  const entry = {
    id: Date.now().toString(),
    url,
    domain: derivedDomain,
    reason,
    timestamp: Date.now(),
    date: new Date().toISOString()
  };

  reasons.push(entry);

  await chrome.storage.local.set({
    whitelistUrlReasons: reasons.slice(-100)
  });

  return entry;
}

/**
 * Add a URL to the whitelist and persist the user's written reason.
 * @param {string} url - URL to allow
 * @param {string} reason - Written reason for allowing it
 * @param {string} domain - Blocked domain shown on the blocked page
 * @returns {Promise<{success: boolean, allowedUrls?: Array, normalizedUrl?: string, alreadyWhitelisted?: boolean}>}
 */
async function addAllowedUrlWithReason(url, reason, domain) {
  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  if (!trimmedReason) {
    return { success: false, error: 'A written reason is required' };
  }

  const normalizedResult = normalizeAllowedUrlInput(url);
  if (!normalizedResult.success) {
    return normalizedResult;
  }

  const { normalizedUrl } = normalizedResult;
  const settings = await getSettings();
  const allowedUrls = settings.allowedUrls || [];
  const alreadyWhitelisted = allowedUrls.includes(normalizedUrl);

  if (!alreadyWhitelisted) {
    allowedUrls.push(normalizedUrl);
    await saveProfileSettings({ allowedUrls });
    await updateBlockingRules();
  }

  await saveAllowedUrlReason(normalizedUrl, domain, trimmedReason);

  return {
    success: true,
    allowedUrls,
    normalizedUrl,
    alreadyWhitelisted
  };
}

/**
 * Remove a URL from the whitelist
 * @param {string} url - URL to remove
 * @returns {Promise<{success: boolean, allowedUrls: Array}>}
 */
async function removeAllowedUrl(url) {
  const settings = await getSettings();
  const allowedUrls = settings.allowedUrls || [];

  const index = allowedUrls.indexOf(url);
  if (index === -1) {
    return { success: false, error: 'URL not found' };
  }

  allowedUrls.splice(index, 1);

  await saveProfileSettings({ allowedUrls });
  await updateBlockingRules();

  return { success: true, allowedUrls };
}

/**
 * Check if a URL is whitelisted
 * @param {string} url - URL to check
 * @returns {Promise<boolean>}
 */
async function isUrlWhitelisted(url) {
  const settings = await getSettings();
  return isUrlWhitelistedWithSettings(url, settings);
}

// =============================================================================
// PROFILES
// =============================================================================

/**
 * Get all profiles
 * @returns {Promise<Array>}
 */
async function getProfiles() {
  const data = await chrome.storage.local.get('profiles');
  if (!data.profiles || !Array.isArray(data.profiles) || data.profiles.length === 0) {
    // Initialize with default profile only if profiles don't exist
    // This should only happen on fresh install
    console.log('No profiles found, initializing with default profile');
    const defaultProfile = { ...DEFAULT_PROFILE, id: 'default' };
    await chrome.storage.local.set({ profiles: [defaultProfile], activeProfileId: 'default' });
    return [defaultProfile];
  }
  return data.profiles;
}

/**
 * Get the active profile ID
 * @returns {Promise<string>}
 */
async function getActiveProfileId() {
  const data = await chrome.storage.local.get('activeProfileId');
  return data.activeProfileId || 'default';
}

/**
 * Get the active profile
 * @returns {Promise<Object>}
 */
async function getActiveProfile() {
  const profiles = await getProfiles();
  const activeId = await getActiveProfileId();
  const profile = profiles.find(p => p.id === activeId);

  // If active profile not found, return default
  if (!profile) {
    return profiles.find(p => p.id === 'default') || profiles[0];
  }

  return profile;
}

/**
 * Set the active profile
 * @param {string} profileId - Profile ID to activate
 * @returns {Promise<{success: boolean, profile: Object}>}
 */
async function setActiveProfile(profileId) {
  const profiles = await getProfiles();
  const profile = profiles.find(p => p.id === profileId);

  if (!profile) {
    return { success: false, error: 'Profile not found' };
  }

  await chrome.storage.local.set({ activeProfileId: profileId });

  // Update blocking rules based on new profile
  await updateBlockingRules();

  return { success: true, profile };
}

/**
 * Create a new profile
 * @param {Object} profileData - Profile data
 * @returns {Promise<{success: boolean, profile: Object}>}
 */
async function createProfile(profileData) {
  const profiles = await getProfiles();

  // Generate unique ID
  const id = 'profile-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

  // Create profile with defaults
  const newProfile = {
    ...DEFAULT_PROFILE,
    ...profileData,
    id,
    blockedSites: profileData.blockedSites || [],
    allowedSites: profileData.allowedSites || [],
    categories: profileData.categories || [],
    blockedKeywords: profileData.blockedKeywords || { enabled: false, keywords: [] },
    allowedUrls: profileData.allowedUrls || [],
    schedule: profileData.schedule || DEFAULT_PROFILE.schedule,
    unblockMethods: profileData.unblockMethods || DEFAULT_PROFILE.unblockMethods,
    requireAllMethods: profileData.requireAllMethods || false
  };

  newProfile.unblockMethods.completeTodo = normalizeCompleteTodoSettings(newProfile.unblockMethods.completeTodo);

  profiles.push(newProfile);
  await chrome.storage.local.set({ profiles });

  return { success: true, profile: newProfile };
}

/**
 * Update an existing profile
 * @param {string} profileId - Profile ID
 * @param {Object} updates - Updates to apply
 * @returns {Promise<{success: boolean, profile: Object}>}
 */
async function updateProfile(profileId, updates) {
  const profiles = await getProfiles();
  const index = profiles.findIndex(p => p.id === profileId);

  if (index === -1) {
    return { success: false, error: 'Profile not found' };
  }

  // Don't allow changing the ID
  delete updates.id;

  profiles[index] = { ...profiles[index], ...updates };
  if (profiles[index].unblockMethods) {
    profiles[index].unblockMethods.completeTodo = normalizeCompleteTodoSettings(profiles[index].unblockMethods.completeTodo);
  }
  await chrome.storage.local.set({ profiles });

  // If this is the active profile, update blocking rules
  const activeId = await getActiveProfileId();
  if (profileId === activeId) {
    await updateBlockingRules();
  }

  return { success: true, profile: profiles[index] };
}

/**
 * Delete a profile
 * @param {string} profileId - Profile ID
 * @returns {Promise<{success: boolean}>}
 */
async function deleteProfile(profileId) {
  // Can't delete the default profile
  if (profileId === 'default') {
    return { success: false, error: 'Cannot delete the default profile' };
  }

  const profiles = await getProfiles();
  const index = profiles.findIndex(p => p.id === profileId);

  if (index === -1) {
    return { success: false, error: 'Profile not found' };
  }

  profiles.splice(index, 1);
  await chrome.storage.local.set({ profiles });

  // If this was the active profile, switch to default
  const activeId = await getActiveProfileId();
  if (profileId === activeId) {
    await setActiveProfile('default');
  }

  return { success: true };
}

/**
 * Create a profile from a template
 * @param {string} templateKey - Template key (work, study, relaxed)
 * @param {string} customName - Optional custom name
 * @returns {Promise<{success: boolean, profile: Object}>}
 */
async function createProfileFromTemplate(templateKey, customName = null) {
  const template = PROFILE_TEMPLATES[templateKey];
  if (!template) {
    return { success: false, error: 'Template not found' };
  }

  return await createProfile({
    name: customName || template.name,
    icon: template.icon,
    color: template.color,
    blockedSites: [...template.blockedSites],
    categories: template.categories ? template.categories.map(c => ({ ...c })) : [],
    unblockMethods: { ...template.unblockMethods }
  });
}

/**
 * Duplicate an existing profile
 * @param {string} profileId - Profile ID to duplicate
 * @param {string} newName - Name for the duplicate
 * @returns {Promise<{success: boolean, profile: Object}>}
 */
async function duplicateProfile(profileId, newName = null) {
  const profiles = await getProfiles();
  const original = profiles.find(p => p.id === profileId);

  if (!original) {
    return { success: false, error: 'Profile not found' };
  }

  // Deep copy the profile
  const duplicate = JSON.parse(JSON.stringify(original));
  delete duplicate.id;
  duplicate.name = newName || `${original.name} (Copy)`;

  return await createProfile(duplicate);
}

/**
 * Get profile templates
 * @returns {Object}
 */
function getProfileTemplates() {
  return PROFILE_TEMPLATES;
}

// =============================================================================
// BROWSER HISTORY ANALYSIS
// =============================================================================

// Site categories for classification
const SITE_CATEGORIES = {
  socialMedia: {
    name: 'Social Media',
    icon: 'SM',
    color: '#ec4899',
    domains: ['twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'snapchat.com', 'linkedin.com', 'threads.net', 'mastodon.social', 'bsky.app']
  },
  entertainment: {
    name: 'Entertainment',
    icon: 'EN',
    color: '#f97316',
    domains: ['youtube.com', 'netflix.com', 'twitch.tv', 'hulu.com', 'disneyplus.com', 'hbomax.com', 'primevideo.com', 'spotify.com', 'vimeo.com', 'dailymotion.com', 'crunchyroll.com']
  },
  news: {
    name: 'News & Media',
    icon: 'NW',
    color: '#3b82f6',
    domains: ['news.google.com', 'cnn.com', 'bbc.com', 'foxnews.com', 'nytimes.com', 'theguardian.com', 'reuters.com', 'apnews.com', 'wsj.com', 'bloomberg.com', 'techcrunch.com', 'theverge.com', 'wired.com', 'arstechnica.com']
  },
  gaming: {
    name: 'Gaming',
    icon: 'GM',
    color: '#8b5cf6',
    domains: ['steampowered.com', 'epicgames.com', 'roblox.com', 'itch.io', 'gog.com', 'ea.com', 'blizzard.com', 'playstation.com', 'xbox.com', 'nintendo.com', 'ign.com', 'gamespot.com', 'kotaku.com']
  },
  shopping: {
    name: 'Shopping',
    icon: 'SH',
    color: '#10b981',
    domains: ['amazon.com', 'ebay.com', 'etsy.com', 'walmart.com', 'target.com', 'aliexpress.com', 'wish.com', 'bestbuy.com', 'newegg.com', 'shopify.com']
  },
  forums: {
    name: 'Forums & Communities',
    icon: 'FR',
    color: '#06b6d4',
    domains: ['reddit.com', 'discord.com', 'quora.com', 'stackexchange.com', 'stackoverflow.com', 'news.ycombinator.com', 'slashdot.org', 'medium.com', 'substack.com']
  },
  productivity: {
    name: 'Productivity',
    icon: 'PR',
    color: '#22c55e',
    domains: ['google.com', 'docs.google.com', 'drive.google.com', 'notion.so', 'trello.com', 'asana.com', 'monday.com', 'slack.com', 'zoom.us', 'meet.google.com', 'teams.microsoft.com', 'github.com', 'gitlab.com', 'bitbucket.org', 'figma.com', 'canva.com', 'openai.com', 'chatgpt.com', 'claude.ai', 'perplexity.ai', 'gemini.google.com']
  },
  education: {
    name: 'Education',
    icon: 'ED',
    color: '#6366f1',
    domains: ['wikipedia.org', 'khanacademy.org', 'coursera.org', 'udemy.com', 'edx.org', 'skillshare.com', 'duolingo.com', 'quizlet.com', 'chegg.com', 'wolframalpha.com']
  },
  email: {
    name: 'Email',
    icon: 'EM',
    color: '#64748b',
    domains: ['mail.google.com', 'gmail.com', 'outlook.com', 'outlook.live.com', 'mail.yahoo.com', 'protonmail.com', 'icloud.com']
  }
};

const SITE_CATEGORY_HEURISTICS = {
  socialMedia: {
    hostKeywords: ['social', 'community', 'thread', 'timeline', 'feed', 'microblog'],
    pathKeywords: ['reel', 'reels', 'shorts', 'stories', 'story', 'post', 'posts', 'profile', 'profiles', 'status'],
    titleKeywords: ['followers', 'following', 'likes', 'comments', 'timeline', 'profile', 'posts']
  },
  entertainment: {
    hostKeywords: ['video', 'stream', 'music', 'podcast', 'movie', 'tv'],
    pathKeywords: ['watch', 'listen', 'playlist', 'album', 'episode', 'episodes', 'show', 'shows', 'movie', 'movies', 'video', 'videos', 'stream'],
    titleKeywords: ['watch', 'trailer', 'episode', 'playlist', 'listen', 'soundtrack']
  },
  news: {
    hostKeywords: ['news', 'press', 'media', 'journal', 'times', 'post', 'herald', 'chronicle'],
    pathKeywords: ['news', 'article', 'articles', 'politics', 'world', 'business', 'breaking', 'opinion'],
    titleKeywords: ['breaking news', 'analysis', 'opinion', 'live updates', 'latest news']
  },
  gaming: {
    hostKeywords: ['game', 'games', 'gaming', 'esports', 'steam', 'xbox', 'playstation', 'nintendo'],
    pathKeywords: ['game', 'games', 'gaming', 'walkthrough', 'review', 'reviews', 'dlc', 'patch-notes'],
    titleKeywords: ['game review', 'walkthrough', 'gameplay', 'esports', 'patch notes']
  },
  shopping: {
    hostKeywords: ['shop', 'store', 'market', 'cart', 'checkout', 'deal', 'deals'],
    pathKeywords: ['product', 'products', 'shop', 'store', 'cart', 'checkout', 'sale', 'deals', 'item', 'items'],
    titleKeywords: ['buy now', 'shopping cart', 'checkout', 'free shipping', 'add to cart']
  },
  forums: {
    hostKeywords: ['forum', 'forums', 'community', 'board', 'boards', 'discussion', 'discuss'],
    pathKeywords: ['thread', 'threads', 'forum', 'forums', 'discussion', 'discussions', 'community', 'communities', 'comments'],
    titleKeywords: ['discussion', 'forum', 'thread', 'community', 'comments']
  },
  productivity: {
    hostKeywords: ['docs', 'drive', 'calendar', 'workspace', 'task', 'tasks', 'project', 'projects', 'crm', 'developer', 'api'],
    pathKeywords: ['dashboard', 'docs', 'document', 'documents', 'sheet', 'sheets', 'task', 'tasks', 'project', 'projects', 'workspace', 'board', 'developer', 'reference', 'api'],
    titleKeywords: ['dashboard', 'workspace', 'project', 'task', 'meeting notes', 'kanban', 'developer documentation', 'api reference']
  },
  education: {
    hostKeywords: ['learn', 'course', 'courses', 'academy', 'school', 'university', 'edu', 'study'],
    pathKeywords: ['learn', 'course', 'courses', 'lesson', 'lessons', 'tutorial', 'tutorials', 'lecture', 'lectures', 'class', 'classes'],
    titleKeywords: ['course', 'tutorial', 'lesson', 'lecture', 'study guide']
  },
  email: {
    hostKeywords: ['mail', 'inbox', 'email', 'webmail'],
    pathKeywords: ['inbox', 'compose', 'mail', 'message', 'messages', 'email'],
    titleKeywords: ['inbox', 'compose', 'sent mail', 'drafts']
  }
};

const SITE_CATEGORY_CONTENT_KEYWORDS = {
  socialMedia: ['follow', 'followers', 'following', 'likes', 'comments', 'share', 'timeline', 'feed', 'profile', 'profiles', 'creator', 'post', 'posts', 'stories', 'reels'],
  entertainment: ['watch', 'stream', 'playlist', 'episode', 'episodes', 'trailer', 'music', 'album', 'movie', 'movies', 'show', 'shows', 'video', 'videos', 'listen'],
  news: ['breaking', 'analysis', 'headline', 'headlines', 'reporting', 'opinion', 'latest', 'article', 'articles', 'coverage', 'journalist', 'newsroom'],
  gaming: ['gameplay', 'walkthrough', 'patch', 'patches', 'review', 'reviews', 'quest', 'level', 'steam', 'xbox', 'playstation', 'nintendo', 'multiplayer', 'esports'],
  shopping: ['add to cart', 'buy now', 'checkout', 'shop', 'store', 'sale', 'discount', 'shipping', 'product', 'products', 'price', 'prices', 'wishlist'],
  forums: ['thread', 'threads', 'discussion', 'discussions', 'community', 'communities', 'comment', 'comments', 'reply', 'replies', 'posted by'],
  productivity: ['dashboard', 'workspace', 'project', 'projects', 'task', 'tasks', 'document', 'documents', 'spreadsheet', 'meeting', 'notes', 'kanban', 'api', 'reference'],
  education: ['course', 'courses', 'lesson', 'lessons', 'tutorial', 'tutorials', 'lecture', 'lectures', 'study', 'quiz', 'practice', 'learn'],
  email: ['inbox', 'compose', 'sender', 'recipients', 'drafts', 'sent', 'archive', 'message', 'messages', 'unread']
};

const SITE_CATEGORY_SCAN_VERSION = 1;
const SITE_CATEGORY_SUGGESTION_TTL_MS = 21 * 24 * 60 * 60 * 1000;
const SITE_CATEGORY_NEGATIVE_SCAN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeCategoryDomain(domain) {
  return typeof domain === 'string'
    ? domain.toLowerCase().trim().replace(/^www\./, '')
    : '';
}

function tokenizeCategoryText(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function keywordMatchesToken(tokens, keyword) {
  return tokens.some((token) => token === keyword || token.includes(keyword));
}

function scoreHeuristicKeywords(tokens, keywords = [], weight = 1) {
  let score = 0;
  for (const keyword of keywords) {
    if (keywordMatchesToken(tokens, keyword)) {
      score += weight;
    }
  }
  return score;
}

function inferCategoryFromSignals(domain, url = '', title = '') {
  const normalizedDomain = normalizeCategoryDomain(domain);
  const urlString = typeof url === 'string' ? url : '';
  let pathname = '';

  try {
    pathname = new URL(urlString).pathname || '';
  } catch {
    pathname = '';
  }

  const hostTokens = tokenizeCategoryText(normalizedDomain.replace(/\./g, ' '));
  const pathTokens = tokenizeCategoryText(pathname.replace(/[/_-]/g, ' '));
  const titleTokens = tokenizeCategoryText(title);

  let bestCategory = null;
  let bestScore = 0;

  for (const [categoryKey, signals] of Object.entries(SITE_CATEGORY_HEURISTICS)) {
    const score =
      scoreHeuristicKeywords(hostTokens, signals.hostKeywords, 3) +
      scoreHeuristicKeywords(pathTokens, signals.pathKeywords, 2) +
      scoreHeuristicKeywords(titleTokens, signals.titleKeywords, 2);

    if (score > bestScore) {
      bestScore = score;
      bestCategory = categoryKey;
    }
  }

  return bestScore >= 3 ? bestCategory : null;
}

async function getSiteCategorySuggestions() {
  const result = await chrome.storage.local.get('siteCategorySuggestions');
  return result.siteCategorySuggestions || {};
}

function getSiteCategorySuggestionTtl(entry) {
  return entry?.category ? SITE_CATEGORY_SUGGESTION_TTL_MS : SITE_CATEGORY_NEGATIVE_SCAN_TTL_MS;
}

function isFreshSiteCategorySuggestion(entry, now = Date.now()) {
  if (!entry || entry.version !== SITE_CATEGORY_SCAN_VERSION || !entry.scannedAt) {
    return false;
  }

  return (now - entry.scannedAt) < getSiteCategorySuggestionTtl(entry);
}

async function getSiteCategoryOverrides() {
  const result = await chrome.storage.local.get('siteCategoryOverrides');
  return result.siteCategoryOverrides || {};
}

function findMatchingDomainEntry(domain, entries = {}) {
  const normalizedDomain = normalizeCategoryDomain(domain);
  if (!normalizedDomain) {
    return null;
  }

  const parts = normalizedDomain.split('.');
  for (let index = 0; index < parts.length - 1; index += 1) {
    const candidate = parts.slice(index).join('.');
    if (entries[candidate]) {
      return entries[candidate];
    }
  }

  return entries[normalizedDomain] || null;
}

function findSiteCategoryOverride(domain, overrides = {}) {
  return findMatchingDomainEntry(domain, overrides);
}

function findSiteCategorySuggestion(domain, suggestions = {}, now = Date.now()) {
  const entry = findMatchingDomainEntry(domain, suggestions);
  if (!isFreshSiteCategorySuggestion(entry, now)) {
    return null;
  }

  return entry;
}

/**
 * Classify a domain into a category
 * @param {string} domain - Domain to classify
 * @returns {string|null} Category key or null
 */
function classifyDomain(domain, overrides = null) {
  const normalizedDomain = normalizeCategoryDomain(domain);

  const overrideCategory = findSiteCategoryOverride(normalizedDomain, overrides || {});
  if (overrideCategory && SITE_CATEGORIES[overrideCategory]) {
    return overrideCategory;
  }

  for (const [categoryKey, category] of Object.entries(SITE_CATEGORIES)) {
    for (const catDomain of category.domains) {
      if (normalizedDomain === catDomain || normalizedDomain.endsWith('.' + catDomain)) {
        return categoryKey;
      }
    }
  }

  return null;
}

function inferCategoryFromContentPayload(payload = {}) {
  const titleTokens = tokenizeCategoryText(payload.title || '');
  const descriptionTokens = tokenizeCategoryText(payload.description || '');
  const headingTokens = tokenizeCategoryText(payload.headings || '');
  const snippetTokens = tokenizeCategoryText(payload.snippet || '');

  let bestCategory = null;
  let bestScore = 0;
  let runnerUpScore = 0;

  for (const [categoryKey, keywords] of Object.entries(SITE_CATEGORY_CONTENT_KEYWORDS)) {
    const score =
      scoreHeuristicKeywords(titleTokens, keywords, 3) +
      scoreHeuristicKeywords(descriptionTokens, keywords, 2) +
      scoreHeuristicKeywords(headingTokens, keywords, 2) +
      scoreHeuristicKeywords(snippetTokens, keywords, 1);

    if (score > bestScore) {
      runnerUpScore = bestScore;
      bestScore = score;
      bestCategory = categoryKey;
    } else if (score > runnerUpScore) {
      runnerUpScore = score;
    }
  }

  if (!bestCategory || bestScore < 5 || bestScore < runnerUpScore + 2) {
    return {
      category: null,
      confidence: 0
    };
  }

  const confidence = Math.max(0.5, Math.min(0.96, 0.52 + (bestScore * 0.05) + ((bestScore - runnerUpScore) * 0.04)));

  return {
    category: bestCategory,
    confidence: Number(confidence.toFixed(2))
  };
}

function resolveSiteCategoryContext({ domain, url = '', title = '', overrides = null, suggestions = null }) {
  const overrideCategory = findSiteCategoryOverride(domain, overrides || {});
  if (overrideCategory && SITE_CATEGORIES[overrideCategory]) {
    return {
      category: overrideCategory,
      source: 'override',
      confidence: 1
    };
  }

  const builtInCategory = classifyDomain(domain, null);
  if (builtInCategory) {
    return {
      category: builtInCategory,
      source: 'built-in',
      confidence: 1
    };
  }

  const suggestedEntry = findSiteCategorySuggestion(domain, suggestions || {});
  if (suggestedEntry?.category && SITE_CATEGORIES[suggestedEntry.category]) {
    return {
      category: suggestedEntry.category,
      source: suggestedEntry.source || 'suggested',
      confidence: suggestedEntry.confidence || 0.7
    };
  }

  const heuristicCategory = inferCategoryFromSignals(domain, url, title);
  if (heuristicCategory) {
    return {
      category: heuristicCategory,
      source: 'heuristic',
      confidence: 0.58
    };
  }

  return {
    category: null,
    source: null,
    confidence: 0
  };
}

/**
 * Get browsing history for analysis
 * @param {number} days - Number of days to analyze (default 7)
 * @returns {Promise<Object>} Analysis results
 */
async function analyzeHistory(days = 7) {
  const endTime = Date.now();
  const startTime = endTime - (days * 24 * 60 * 60 * 1000);

  try {
    const siteCategoryOverrides = await getSiteCategoryOverrides();
    const siteCategorySuggestions = await getSiteCategorySuggestions();

    // Get history items (returns unique URLs visited in the time range)
    const historyItems = await chrome.history.search({
      text: '',
      startTime,
      endTime,
      maxResults: 10000
    });

    // Aggregate data
    const domainStats = {};
    const categoryStats = {};
    const hourlyStats = Array(24).fill(0);
    const dailyStats = {};
    let totalVisits = 0;

    // For each URL, get the actual visits within the time range
    // Process in batches to avoid overwhelming the API
    const BATCH_SIZE = 50;
    for (let i = 0; i < historyItems.length; i += BATCH_SIZE) {
      const batch = historyItems.slice(i, i + BATCH_SIZE);
      const visitResults = await Promise.all(
        batch.map(async (item) => {
          if (!item.url) return null;
          try {
            const domain = getHistoryTrackableDomain(item.url);
            if (!domain) return null;

            // Get individual visits for this URL, filtered to our time range
            const visits = await chrome.history.getVisits({ url: item.url });
            const rangeVisits = visits.filter(v => v.visitTime >= startTime && v.visitTime <= endTime);

            return { item, domain, visits: rangeVisits };
          } catch (e) {
            return null;
          }
        })
      );

      for (const result of visitResults) {
        if (!result || result.visits.length === 0) continue;

        const { domain, visits: rangeVisits } = result;
        const visitCount = rangeVisits.length;
        totalVisits += visitCount;
        const categoryResult = resolveSiteCategoryContext({
          domain,
          url: result.item?.url || '',
          title: result.item?.title || '',
          overrides: siteCategoryOverrides,
          suggestions: siteCategorySuggestions
        });

        // Domain stats
        if (!domainStats[domain]) {
          domainStats[domain] = {
            domain,
            visits: 0,
            category: null,
            categoryVotes: {},
            categorySourceVotes: {},
            categoryConfidenceVotes: {},
            lastVisit: 0
          };
        }
        domainStats[domain].visits += visitCount;
        domainStats[domain].lastVisit = Math.max(
          domainStats[domain].lastVisit,
          ...rangeVisits.map(v => v.visitTime)
        );
        if (categoryResult.category) {
          const { category, source, confidence } = categoryResult;
          domainStats[domain].categoryVotes[category] =
            (domainStats[domain].categoryVotes[category] || 0) + visitCount;
          domainStats[domain].categorySourceVotes[category] = source || null;
          domainStats[domain].categoryConfidenceVotes[category] =
            Math.max(domainStats[domain].categoryConfidenceVotes[category] || 0, confidence || 0);
        }

        // Category stats
        if (categoryResult.category) {
          const { category } = categoryResult;
          if (!categoryStats[category]) {
            categoryStats[category] = {
              ...SITE_CATEGORIES[category],
              key: category,
              visits: 0,
              uniqueDomains: new Set()
            };
          }
          categoryStats[category].visits += visitCount;
          categoryStats[category].uniqueDomains.add(domain);
        }

        // Hourly and daily distribution using actual visit timestamps
        for (const visit of rangeVisits) {
          const visitDate = new Date(visit.visitTime);
          const hour = visitDate.getHours();
          hourlyStats[hour] += 1;

          const dateKey = visitDate.toISOString().split('T')[0];
          if (!dailyStats[dateKey]) {
            dailyStats[dateKey] = 0;
          }
          dailyStats[dateKey] += 1;
        }
      }
    }

    for (const entry of Object.values(domainStats)) {
      const sortedCategories = Object.entries(entry.categoryVotes || {})
        .sort((a, b) => b[1] - a[1]);
      const resolvedCategory = sortedCategories[0]?.[0];
      const fallbackCategory = resolveSiteCategoryContext({
        domain: entry.domain,
        overrides: siteCategoryOverrides,
        suggestions: siteCategorySuggestions
      });
      entry.category = resolvedCategory || fallbackCategory.category;
      entry.categorySource = entry.category
        ? (entry.categorySourceVotes?.[entry.category] || fallbackCategory.source || null)
        : null;
      entry.categoryConfidence = entry.category
        ? (entry.categoryConfidenceVotes?.[entry.category] || fallbackCategory.confidence || 0)
        : 0;
      delete entry.categoryVotes;
      delete entry.categorySourceVotes;
      delete entry.categoryConfidenceVotes;
    }

    // Convert category uniqueDomains Set to count
    for (const category of Object.values(categoryStats)) {
      category.uniqueDomains = category.uniqueDomains.size;
    }

    // Sort domains by visits
    const topDomains = Object.values(domainStats)
      .sort((a, b) => b.visits - a.visits)
      .slice(0, 20);

    // Sort categories by visits
    const categoriesSorted = Object.values(categoryStats)
      .sort((a, b) => b.visits - a.visits);

    // Calculate percentages
    const totalCategorizedVisits = categoriesSorted.reduce((sum, c) => sum + c.visits, 0);
    const uncategorizedVisits = totalVisits - totalCategorizedVisits;

    return {
      period: {
        days,
        startTime,
        endTime,
        startDate: new Date(startTime).toISOString().split('T')[0],
        endDate: new Date(endTime).toISOString().split('T')[0]
      },
      summary: {
        totalVisits,
        uniqueDomains: Object.keys(domainStats).length,
        totalCategorizedVisits,
        uncategorizedVisits
      },
      topDomains,
      categories: categoriesSorted,
      hourlyDistribution: hourlyStats,
      dailyVisits: dailyStats
    };
  } catch (e) {
    console.error('Failed to analyze history:', e);
    return { error: e.message };
  }
}

/**
 * Get suggestions for sites to block based on history
 * @returns {Promise<Array>} Suggested sites
 */
async function getBlockSuggestions() {
  const analysis = await analyzeHistory(14); // 2 weeks of data

  if (analysis.error) {
    return { error: analysis.error };
  }

  const settings = await getSettings();
  const alreadyBlocked = new Set(settings.blockedSites.map(s => s.toLowerCase()));

  // Get distracting categories
  const distractingCategories = ['socialMedia', 'entertainment', 'gaming', 'forums', 'news'];

  const suggestions = [];

  for (const domainData of analysis.topDomains) {
    // Skip if already blocked
    if (alreadyBlocked.has(domainData.domain.toLowerCase())) continue;

    // Check if in a distracting category
    if (domainData.category && distractingCategories.includes(domainData.category)) {
      suggestions.push({
        domain: domainData.domain,
        visits: domainData.visits,
        category: domainData.category,
        categoryName: SITE_CATEGORIES[domainData.category]?.name || 'Unknown',
        reason: `High usage (${domainData.visits} visits) in ${SITE_CATEGORIES[domainData.category]?.name || 'distracting'} category`
      });
    }
  }

  // Sort by visits and limit
  return suggestions.sort((a, b) => b.visits - a.visits).slice(0, 10);
}

/**
 * Get productivity score based on history
 * @param {number} days - Days to analyze
 * @returns {Promise<Object>} Productivity metrics
 */
async function getProductivityScore(days = 7) {
  const analysis = await analyzeHistory(days);

  if (analysis.error) {
    return { error: analysis.error };
  }

  // Define productive vs distracting categories
  const productiveCategories = ['productivity', 'education', 'email'];
  const distractingCategories = ['socialMedia', 'entertainment', 'gaming', 'forums'];
  const neutralCategories = ['news', 'shopping'];

  let productiveVisits = 0;
  let distractingVisits = 0;
  let neutralVisits = 0;

  for (const category of analysis.categories) {
    if (productiveCategories.includes(category.key)) {
      productiveVisits += category.visits;
    } else if (distractingCategories.includes(category.key)) {
      distractingVisits += category.visits;
    } else if (neutralCategories.includes(category.key)) {
      neutralVisits += category.visits;
    }
  }

  const categorizedTotal = productiveVisits + distractingVisits + neutralVisits;

  // Calculate score (0-100)
  // Score = (productive - distracting) / total * 50 + 50
  // This gives 50 as neutral, higher for more productive, lower for more distracting
  let score = 50;
  if (categorizedTotal > 0) {
    const ratio = (productiveVisits - distractingVisits) / categorizedTotal;
    score = Math.round(Math.max(0, Math.min(100, 50 + ratio * 50)));
  }

  // Determine grade
  let grade, gradeLabel;
  if (score >= 80) {
    grade = 'A';
    gradeLabel = 'Excellent';
  } else if (score >= 65) {
    grade = 'B';
    gradeLabel = 'Good';
  } else if (score >= 50) {
    grade = 'C';
    gradeLabel = 'Average';
  } else if (score >= 35) {
    grade = 'D';
    gradeLabel = 'Needs Improvement';
  } else {
    grade = 'F';
    gradeLabel = 'Poor';
  }

  // Find peak hours (most active)
  const hourlyStats = analysis.hourlyDistribution;
  const peakHour = hourlyStats.indexOf(Math.max(...hourlyStats));

  // Calculate daily average
  const dailyValues = Object.values(analysis.dailyVisits);
  const avgDailyVisits = dailyValues.length > 0
    ? Math.round(dailyValues.reduce((a, b) => a + b, 0) / dailyValues.length)
    : 0;

  return {
    score,
    grade,
    gradeLabel,
    breakdown: {
      productiveVisits,
      distractingVisits,
      neutralVisits,
      uncategorizedVisits: analysis.summary.uncategorizedVisits,
      productivePercent: categorizedTotal > 0 ? Math.round(productiveVisits / categorizedTotal * 100) : 0,
      distractingPercent: categorizedTotal > 0 ? Math.round(distractingVisits / categorizedTotal * 100) : 0
    },
    insights: {
      peakHour,
      peakHourLabel: formatHour(peakHour),
      avgDailyVisits,
      totalVisits: analysis.summary.totalVisits,
      uniqueSites: analysis.summary.uniqueDomains,
      topDistractingSite: analysis.topDomains.find(d => distractingCategories.includes(d.category))?.domain || null,
      topProductiveSite: analysis.topDomains.find(d => productiveCategories.includes(d.category))?.domain || null
    },
    period: analysis.period
  };
}

/**
 * Format hour for display
 * @param {number} hour - Hour (0-23)
 * @returns {string} Formatted time
 */
function formatHour(hour) {
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:00 ${period}`;
}

function normalizeHistoryLookupUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

function trimBlockedContentTitle(title, maxLength = 140) {
  const normalized = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim() : '';
  if (!normalized) {
    return '';
  }

  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3)}...`
    : normalized;
}

function isExtensionOwnedUrl(url) {
  return typeof url === 'string'
    && (url.startsWith('chrome-extension://') || url.startsWith('moz-extension://'));
}

function isUsefulBlockedContentTitle(title) {
  const normalized = trimBlockedContentTitle(title).toLowerCase();
  if (!normalized) {
    return false;
  }

  return normalized !== 'focus mode - stay productive'
    && normalized !== 'focus mode'
    && normalized !== 'embedded content blocked';
}

function isYouTubeUrl(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '');
    return hostname === 'youtube.com' || hostname === 'm.youtube.com' || hostname === 'youtu.be';
  } catch {
    return false;
  }
}

function getYouTubeVideoId(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '');
    const path = parsed.pathname || '/';

    if (hostname === 'youtu.be') {
      return path.slice(1).split('/')[0] || '';
    }

    if (hostname === 'youtube.com' || hostname === 'm.youtube.com') {
      if (path === '/watch') {
        return parsed.searchParams.get('v') || '';
      }

      const pathMatch = path.match(/^\/(embed|shorts|live)\/([^/?#]+)/);
      if (pathMatch) {
        return pathMatch[2] || '';
      }
    }

    return '';
  } catch {
    return '';
  }
}

function getCanonicalYouTubeWatchUrl(url) {
  const videoId = getYouTubeVideoId(url);
  return videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : '';
}

async function getYouTubeHistoryTitleByVideoId(videoId) {
  if (!videoId) {
    return '';
  }

  try {
    const historyItems = await chrome.history.search({
      text: videoId,
      startTime: 0,
      maxResults: 25
    });

    const matchingItem = historyItems.find((item) => {
      return !isExtensionOwnedUrl(item.url || '')
        && getYouTubeVideoId(item.url || '') === videoId
        && isUsefulBlockedContentTitle(item.title || '');
    });
    return trimBlockedContentTitle(matchingItem?.title || '');
  } catch (error) {
    console.error('Failed to resolve YouTube history title by video id:', error);
    return '';
  }
}

async function getYouTubeOEmbedTitle(url) {
  if (!isYouTubeUrl(url)) {
    return '';
  }

  try {
    const canonicalUrl = getCanonicalYouTubeWatchUrl(url) || url;
    const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`;
    const response = await fetch(endpoint, { method: 'GET' });
    if (!response.ok) {
      return '';
    }

    const data = await response.json();
    return trimBlockedContentTitle(data?.title || '');
  } catch (error) {
    console.error('Failed to load YouTube oEmbed title:', error);
    return '';
  }
}

function getBlockedContentFallbackLabel(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '');
    const path = parsed.pathname || '/';

    if (hostname === 'youtube.com' || hostname === 'm.youtube.com' || hostname === 'youtu.be') {
      return 'YouTube video';
    }

    if (hostname === 'x.com' || hostname === 'twitter.com') {
      return path.includes('/status/') ? 'X post' : 'X page';
    }

    if (hostname === 'reddit.com') {
      return path.includes('/comments/') ? 'Reddit post' : 'Reddit page';
    }

    if (hostname === 'instagram.com') {
      return /^\/(p|reel|reels)\//.test(path) ? 'Instagram post' : 'Instagram page';
    }

    if (hostname === 'facebook.com') {
      return 'Facebook post';
    }

    if (hostname === 'tiktok.com') {
      return 'TikTok video';
    }

    if (hostname === 'linkedin.com') {
      return path.includes('/feed/update/') ? 'LinkedIn post' : 'LinkedIn page';
    }

    if (hostname === 'threads.net') {
      return 'Threads post';
    }

    return '';
  } catch {
    return '';
  }
}

async function getBlockedContentMetadata(url) {
  if (typeof url !== 'string' || !url.startsWith('http') || isExtensionOwnedUrl(url)) {
    return { title: '', source: 'none' };
  }

  const normalizedTarget = normalizeHistoryLookupUrl(getCanonicalYouTubeWatchUrl(url) || url);

  try {
    const historyItems = await chrome.history.search({
      text: getYouTubeVideoId(url) || url,
      startTime: 0,
      maxResults: 25
    });

    const exactMatch = historyItems.find((item) => {
      return !isExtensionOwnedUrl(item.url || '')
        && normalizeHistoryLookupUrl(getCanonicalYouTubeWatchUrl(item.url || '') || (item.url || '')) === normalizedTarget
        && isUsefulBlockedContentTitle(item.title || '');
    });
    const firstUsableHistoryTitle = historyItems.find((item) => {
      return !isExtensionOwnedUrl(item.url || '') && isUsefulBlockedContentTitle(item.title || '');
    })?.title || '';
    const bestTitle = trimBlockedContentTitle(exactMatch?.title || firstUsableHistoryTitle);
    if (isUsefulBlockedContentTitle(bestTitle)) {
      return { title: bestTitle, source: 'history' };
    }
  } catch (error) {
    console.error('Failed to resolve blocked content metadata:', error);
  }

  const youtubeVideoId = getYouTubeVideoId(url);
  const youtubeHistoryTitle = await getYouTubeHistoryTitleByVideoId(youtubeVideoId);
  if (youtubeHistoryTitle) {
    return { title: youtubeHistoryTitle, source: 'youtube-history-video-id' };
  }

  const youtubeTitle = await getYouTubeOEmbedTitle(url);
  if (youtubeTitle) {
    return { title: youtubeTitle, source: 'youtube-oembed' };
  }

  return { title: '', source: 'none' };
}

/**
 * Get browsing patterns by day of week
 * @param {number} days - Days to analyze
 * @returns {Promise<Object>} Pattern data
 */
async function getBrowsingPatterns(days = 30) {
  const endTime = Date.now();
  const startTime = endTime - (days * 24 * 60 * 60 * 1000);

  try {
    const siteCategoryOverrides = await getSiteCategoryOverrides();
    const siteCategorySuggestions = await getSiteCategorySuggestions();

    const historyItems = await chrome.history.search({
      text: '',
      startTime,
      endTime,
      maxResults: 10000
    });

    const dayOfWeekStats = Array(7).fill(null).map(() => ({ visits: 0, domains: new Set() }));
    const distractingCategories = ['socialMedia', 'entertainment', 'gaming', 'forums'];
    const distractingByDay = Array(7).fill(0);

    // Process in batches to get accurate time-scoped visit counts
    const BATCH_SIZE = 50;
    for (let i = 0; i < historyItems.length; i += BATCH_SIZE) {
      const batch = historyItems.slice(i, i + BATCH_SIZE);
      const visitResults = await Promise.all(
        batch.map(async (item) => {
          if (!item.url) return null;
          try {
            const domain = getHistoryTrackableDomain(item.url);
            if (!domain) return null;

            const visits = await chrome.history.getVisits({ url: item.url });
            const rangeVisits = visits.filter(v => v.visitTime >= startTime && v.visitTime <= endTime);

            return { domain, visits: rangeVisits, url: item.url, title: item.title || '' };
          } catch (e) {
            return null;
          }
        })
      );

      for (const result of visitResults) {
        if (!result || result.visits.length === 0) continue;

        const { domain, visits: rangeVisits } = result;
        const categoryResult = resolveSiteCategoryContext({
          domain,
          url: result.url,
          title: result.title,
          overrides: siteCategoryOverrides,
          suggestions: siteCategorySuggestions
        });
        const category = categoryResult.category;

        for (const visit of rangeVisits) {
          const visitDate = new Date(visit.visitTime);
          const dayOfWeek = visitDate.getDay();

          dayOfWeekStats[dayOfWeek].visits += 1;
          dayOfWeekStats[dayOfWeek].domains.add(domain);

          if (category && distractingCategories.includes(category)) {
            distractingByDay[dayOfWeek] += 1;
          }
        }
      }
    }

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    return {
      dayOfWeek: dayOfWeekStats.map((stats, index) => ({
        day: dayNames[index],
        dayIndex: index,
        visits: stats.visits,
        uniqueDomains: stats.domains.size,
        distractingVisits: distractingByDay[index],
        distractingPercent: stats.visits > 0 ? Math.round(distractingByDay[index] / stats.visits * 100) : 0
      })),
      mostActiveDay: dayNames[dayOfWeekStats.reduce((maxIdx, curr, idx, arr) => curr.visits > arr[maxIdx].visits ? idx : maxIdx, 0)],
      leastActiveDay: dayNames[dayOfWeekStats.reduce((minIdx, curr, idx, arr) => curr.visits < arr[minIdx].visits && curr.visits > 0 ? idx : minIdx, 0)],
      mostDistractedDay: dayNames[distractingByDay.reduce((maxIdx, curr, idx, arr) => curr > arr[maxIdx] ? idx : maxIdx, 0)]
    };
  } catch (e) {
    console.error('Failed to get browsing patterns:', e);
    return { error: e.message };
  }
}

/**
 * Get available site categories for reference
 * @returns {Object}
 */
function getSiteCategories() {
  return SITE_CATEGORIES;
}

async function getSiteCategoryScanStatus(domain) {
  const normalizedDomain = normalizeCategoryDomain(domain);
  if (!normalizedDomain) {
    return { shouldScan: false, reason: 'invalid-domain' };
  }

  const [overrides, suggestions] = await Promise.all([
    getSiteCategoryOverrides(),
    getSiteCategorySuggestions()
  ]);

  const overrideCategory = findSiteCategoryOverride(normalizedDomain, overrides);
  if (overrideCategory && SITE_CATEGORIES[overrideCategory]) {
    return { shouldScan: false, reason: 'manual-override', category: overrideCategory };
  }

  const builtInCategory = classifyDomain(normalizedDomain, null);
  if (builtInCategory) {
    return { shouldScan: false, reason: 'built-in-category', category: builtInCategory };
  }

  const suggestionEntry = findMatchingDomainEntry(normalizedDomain, suggestions);
  if (isFreshSiteCategorySuggestion(suggestionEntry)) {
    return {
      shouldScan: false,
      reason: suggestionEntry?.category ? 'suggestion-cached' : 'negative-cache',
      category: suggestionEntry?.category || null,
      confidence: suggestionEntry?.confidence || 0
    };
  }

  return { shouldScan: true, reason: 'uncategorized-domain' };
}

async function saveSiteCategoryContentScan(payload = {}) {
  const normalizedDomain = normalizeCategoryDomain(payload.domain);
  if (!normalizedDomain) {
    return { success: false, error: 'Domain is required' };
  }

  const [overrides, suggestions] = await Promise.all([
    getSiteCategoryOverrides(),
    getSiteCategorySuggestions()
  ]);

  const overrideCategory = findSiteCategoryOverride(normalizedDomain, overrides);
  if (overrideCategory && SITE_CATEGORIES[overrideCategory]) {
    return { success: true, skipped: true, reason: 'manual-override', category: overrideCategory };
  }

  const builtInCategory = classifyDomain(normalizedDomain, null);
  if (builtInCategory) {
    return { success: true, skipped: true, reason: 'built-in-category', category: builtInCategory };
  }

  const existingSuggestion = findMatchingDomainEntry(normalizedDomain, suggestions);
  if (isFreshSiteCategorySuggestion(existingSuggestion)) {
    return {
      success: true,
      skipped: true,
      reason: existingSuggestion.category ? 'suggestion-cached' : 'negative-cache',
      suggestion: existingSuggestion
    };
  }

  const inferred = inferCategoryFromContentPayload(payload);
  const entry = {
    domain: normalizedDomain,
    category: inferred.category,
    confidence: inferred.confidence,
    source: 'content-scan',
    scannedAt: Date.now(),
    version: SITE_CATEGORY_SCAN_VERSION,
    sampleUrl: typeof payload.url === 'string' ? payload.url.slice(0, 300) : '',
    sampleTitle: typeof payload.title === 'string' ? payload.title.slice(0, 160) : ''
  };

  suggestions[normalizedDomain] = entry;
  await chrome.storage.local.set({ siteCategorySuggestions: suggestions });

  return {
    success: true,
    suggestion: entry
  };
}

async function setSiteCategoryOverride(domain, category) {
  const normalizedDomain = normalizeCategoryDomain(domain);
  if (!normalizedDomain) {
    return { success: false, error: 'Domain is required' };
  }

  if (!SITE_CATEGORIES[category]) {
    return { success: false, error: 'Invalid category' };
  }

  const overrides = await getSiteCategoryOverrides();
  overrides[normalizedDomain] = category;
  await chrome.storage.local.set({ siteCategoryOverrides: overrides });

  return {
    success: true,
    domain: normalizedDomain,
    category
  };
}

async function removeSiteCategoryOverride(domain) {
  const normalizedDomain = normalizeCategoryDomain(domain);
  if (!normalizedDomain) {
    return { success: false, error: 'Domain is required' };
  }

  const overrides = await getSiteCategoryOverrides();
  delete overrides[normalizedDomain];
  await chrome.storage.local.set({ siteCategoryOverrides: overrides });

  return {
    success: true,
    domain: normalizedDomain
  };
}

// =============================================================================
// GOOGLE CALENDAR INTEGRATION
// =============================================================================

/**
 * Google Calendar API base URL
 */
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

/**
 * Google Calendar event colorId → hex colour mapping.
 * These are the standard event colours returned by the Calendar API.
 */
const GCAL_EVENT_COLORS = {
  '1': '#7986cb', // Lavender
  '2': '#33b679', // Sage
  '3': '#8e24aa', // Grape
  '4': '#e67c73', // Flamingo
  '5': '#f6bf26', // Banana
  '6': '#f4511e', // Tangerine
  '7': '#039be5', // Peacock
  '8': '#616161', // Graphite
  '9': '#3f51b5', // Blueberry
  '10': '#0b8043', // Basil
  '11': '#d50000', // Tomato
};

/**
 * Default calendar settings
 */
const DEFAULT_CALENDAR_SETTINGS = {
  connected: false,
  accessToken: null,
  refreshToken: null,
  tokenExpiry: null,
  email: null,
  selectedCalendars: [], // IDs of calendars to monitor
  syncEnabled: false,
  profileMapping: [], // { calendarId, eventKeywords: [], profileId }
  autoSwitchProfiles: false,
  focusEventKeywords: ['focus', 'work', 'deep work', 'coding', 'meeting', 'busy'],
  breakEventKeywords: ['break', 'lunch', 'coffee', 'personal'],
  lastSync: null,
  upcomingEvents: [], // Cached events
  calendarListCache: [],
  calendarListCacheTime: null
};

/**
 * Get calendar settings from storage
 * @returns {Promise<Object>}
 */
async function getCalendarSettings() {
  const result = await chrome.storage.local.get('calendarSettings');
  return { ...DEFAULT_CALENDAR_SETTINGS, ...result.calendarSettings };
}

/**
 * Save calendar settings to storage
 * @param {Object} settings - Settings to save
 */
async function saveCalendarSettings(settings) {
  const current = await getCalendarSettings();
  const updated = { ...current, ...settings };
  await chrome.storage.local.set({ calendarSettings: updated });
  return updated;
}

/**
 * Connect to Google Calendar using OAuth2
 * @returns {Promise<Object>}
 */
async function connectGoogleCalendar() {
  try {
    // First try the simpler getAuthToken approach (works if extension is properly configured)
    let token = null;

    try {
      token = await new Promise((resolve, reject) => {
        // Set a timeout to prevent infinite loading
        const timeout = setTimeout(() => {
          reject(new Error('OAuth timeout - please try again'));
        }, 60000); // 60 second timeout

        chrome.identity.getAuthToken({ interactive: true }, (authToken) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (!authToken) {
            reject(new Error('No token received'));
          } else {
            resolve(authToken);
          }
        });
      });
    } catch (authError) {
      console.error('getAuthToken failed:', authError);

      // Fall back to launchWebAuthFlow for development
      token = await launchWebAuthFlowForCalendar();
    }

    if (!token) {
      throw new Error('Failed to obtain access token');
    }

    // Get user info to get email
    let email = null;
    try {
      const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (userInfoResponse.ok) {
        const userInfo = await userInfoResponse.json();
        email = userInfo.email;
      }
    } catch (e) {
      console.warn('Could not fetch user email:', e);
    }

    // Save connection state
    await saveCalendarSettings({
      connected: true,
      accessToken: token,
      tokenExpiry: Date.now() + 3600000, // 1 hour
      email: email
    });

    // Fetch available calendars
    const calendars = await fetchCalendarList(token);

    return {
      success: true,
      email: email,
      calendars: calendars
    };
  } catch (e) {
    console.error('Failed to connect to Google Calendar:', e);
    return { success: false, error: e.message };
  }
}

/**
 * Launch web auth flow as fallback for development
 * @returns {Promise<string>}
 */
async function launchWebAuthFlowForCalendar() {
  // Get the extension's redirect URL
  const redirectUrl = chrome.identity.getRedirectURL();

  // Get client ID from manifest
  const manifest = chrome.runtime.getManifest();
  const clientId = manifest.oauth2?.client_id;

  if (!clientId) {
    throw new Error('No OAuth2 client_id configured in manifest.json');
  }

  const scopes = (manifest.oauth2?.scopes || []).join(' ');

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUrl);
  authUrl.searchParams.set('response_type', 'token');
  authUrl.searchParams.set('scope', scopes + ' https://www.googleapis.com/auth/userinfo.email');
  authUrl.searchParams.set('prompt', 'consent');

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      {
        url: authUrl.toString(),
        interactive: true
      },
      (responseUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!responseUrl) {
          reject(new Error('No response from auth flow'));
          return;
        }

        // Extract token from URL fragment
        const url = new URL(responseUrl);
        const hashParams = new URLSearchParams(url.hash.substring(1));
        const accessToken = hashParams.get('access_token');

        if (!accessToken) {
          reject(new Error('No access token in response'));
          return;
        }

        resolve(accessToken);
      }
    );
  });
}

/**
 * Disconnect from Google Calendar
 * @returns {Promise<Object>}
 */
async function disconnectGoogleCalendar() {
  try {
    const settings = await getCalendarSettings();

    if (settings.accessToken) {
      // Revoke the token
      await new Promise((resolve) => {
        chrome.identity.removeCachedAuthToken({ token: settings.accessToken }, resolve);
      });
    }

    // Clear all calendar settings
    await saveCalendarSettings({
      connected: false,
      accessToken: null,
      refreshToken: null,
      tokenExpiry: null,
      email: null,
      selectedCalendars: [],
      upcomingEvents: [],
      lastSync: null
    });

    // Clear calendar sync alarm
    await chrome.alarms.clear('calendar-sync');

    return { success: true };
  } catch (e) {
    console.error('Failed to disconnect from Google Calendar:', e);
    return { success: false, error: e.message };
  }
}

/**
 * Get a valid access token, refreshing if needed
 * @returns {Promise<string|null>}
 */
async function getValidCalendarToken() {
  const settings = await getCalendarSettings();

  if (!settings.connected) {
    return null;
  }

  // Check if token is still valid (with 5 min buffer)
  if (settings.accessToken && settings.tokenExpiry && Date.now() < settings.tokenExpiry - 300000) {
    return settings.accessToken;
  }

  // Token looks expired — clear Chrome's internal cache of the old token
  // first, otherwise getAuthToken may return the same stale token.
  if (settings.accessToken) {
    await new Promise(resolve => {
      chrome.identity.removeCachedAuthToken({ token: settings.accessToken }, resolve);
    });
  }

  // Now request a fresh token
  try {
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: false }, (token) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(token);
        }
      });
    });

    if (token) {
      await saveCalendarSettings({
        accessToken: token,
        tokenExpiry: Date.now() + 3600000
      });
      return token;
    }
  } catch (e) {
    console.error('Failed to refresh calendar token:', e);

    const msg = e.message || '';
    const isRevoked = msg.includes('not granted') || msg.includes('revoked');

    if (isRevoked) {
      // Consent was revoked — mark disconnected so the UI shows
      // the "Connect Calendar" button for re-authentication.
      console.log('Calendar OAuth grant revoked, marking disconnected');
      await saveCalendarSettings({
        connected: false,
        accessToken: null,
        tokenExpiry: null,
      });
      return null;
    }

    // Transient network error — fall back to the cached token; the
    // actual API call will surface a real 401 if it's truly expired.
    if (settings.accessToken) {
      console.log('Using cached calendar token as fallback');
      return settings.accessToken;
    }
  }

  return null;
}

/**
 * Force-invalidate the current token and obtain a fresh one.
 * Called after receiving a 401 from the Google Calendar API.
 * @returns {Promise<string|null>}
 */
async function forceRefreshCalendarToken() {
  const settings = await getCalendarSettings();

  if (settings.accessToken) {
    await new Promise(resolve => {
      chrome.identity.removeCachedAuthToken({ token: settings.accessToken }, resolve);
    });
  }

  // Clear stored expiry so getValidCalendarToken doesn't short-circuit
  await saveCalendarSettings({ accessToken: null, tokenExpiry: null });

  try {
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: false }, (token) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(token);
        }
      });
    });

    if (token) {
      await saveCalendarSettings({
        accessToken: token,
        tokenExpiry: Date.now() + 3600000
      });
      return token;
    }
  } catch (e) {
    console.error('Failed to force-refresh calendar token:', e);

    const msg = e.message || '';
    if (msg.includes('not granted') || msg.includes('revoked')) {
      console.log('Calendar OAuth grant revoked, marking disconnected');
      await saveCalendarSettings({
        connected: false,
        accessToken: null,
        tokenExpiry: null,
      });
    }
  }

  return null;
}

async function fetchWithRetry(url, options, maxRetries = 2) {
  let attempts = 0;
  while (attempts < maxRetries) {
    attempts++;
    try {
      const response = await fetch(url, options);
      return response;
    } catch (e) {
      if (attempts >= maxRetries) throw e;
      await new Promise(resolve => setTimeout(resolve, 500 * attempts));
    }
  }
}
/**
 * Fetch list of user's calendars
 * @param {string} token - Access token
 * @returns {Promise<Array>}
 */
async function fetchCalendarList(token, forceRefresh = false) {
  const settings = await getCalendarSettings();
  if (!forceRefresh && settings.calendarListCache.length > 0 && Date.now() - settings.calendarListCacheTime < 3600000) {
    return settings.calendarListCache;
  }
  try {
    const response = await fetchWithRetry(`${GOOGLE_CALENDAR_API}/users/me/calendarList`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error(`Calendar API error: ${response.status}`);
    }

    const data = await response.json();
    const calendars = (data.items || []).map(cal => ({
      id: cal.id,
      name: cal.summary,
      description: cal.description || '',
      color: cal.backgroundColor || '#4285f4',
      primary: cal.primary || false,
      accessRole: cal.accessRole
    }));
    await saveCalendarSettings({
      calendarListCache: calendars,
      calendarListCacheTime: Date.now()
    });
    return calendars;
  } catch (e) {
    console.error('Failed to fetch calendar list:', e);
    return [];
  }
}

/**
 * Fetch upcoming events from selected calendars
 * @param {number} days - Number of days ahead to fetch
 * @returns {Promise<Array>}
 */
async function fetchUpcomingEvents(days = 7) {
  let token = await getValidCalendarToken();
  if (!token) {
    return { error: 'Not connected to Google Calendar' };
  }

  let result = await fetchUpcomingEventsWithToken(token, days);

  // If we got 401s on all calendars, force-refresh and retry once
  if (result.got401 && result.events.length === 0) {
    const freshToken = await forceRefreshCalendarToken();
    if (freshToken && freshToken !== token) {
      result = await fetchUpcomingEventsWithToken(freshToken, days);
    }
  }

  const events = result.events;
  events.sort((a, b) => new Date(a.start) - new Date(b.start));

  if (events.length > 0 || !result.failed) {
    await saveCalendarSettings({ upcomingEvents: events, lastSync: Date.now() });
  }

  return events;
}

async function fetchUpcomingEventsWithToken(token, days) {
  const settings = await getCalendarSettings();
  const calendarsToFetch = settings.selectedCalendars.length > 0
    ? settings.selectedCalendars
    : ['primary'];

  // Build calendar-id → color map from stored calendar list
  const calList = await fetchCalendarList(token);
  const calColorMap = {};
  for (const cal of calList) {
    calColorMap[cal.id] = cal.color;
  }

  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

  const events = [];
  let failed = false;
  let got401 = false;
  await Promise.allSettled(calendarsToFetch.map(async (calendarId) => {
    try {
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '100'
      });

      const response = await fetchWithRetry(
        `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.status === 401) {
        got401 = true;
        failed = true;
        return;
      }

      if (!response.ok) {
        console.error(`Failed to fetch events from calendar ${calendarId}:`, response.status);
        failed = true;
        return;
      }

      const data = await response.json();
      const calColor = calColorMap[calendarId] || '#4285f4';

      for (const event of (data.items || [])) {
        const startTime = event.start?.dateTime || event.start?.date;
        const endTime = event.end?.dateTime || event.end?.date;

        if (!startTime || !endTime) continue;
        if (isCompletedCalendarEventTitle(event.summary)) continue;

        // Per-event colorId overrides the calendar color
        const eventColor = event.colorId
          ? (GCAL_EVENT_COLORS[event.colorId] || calColor)
          : calColor;

        events.push({
          id: event.id,
          calendarId: calendarId,
          title: (event.summary || '').trim() || '(No title)',
          description: event.description || '',
          start: startTime,
          end: endTime,
          isAllDay: !event.start?.dateTime,
          location: event.location || '',
          status: event.status,
          htmlLink: event.htmlLink,
          color: eventColor
        });
      }
    } catch (e) {
      console.error(`Error fetching events from calendar ${calendarId}:`, e);
      failed = true;
    }
  }));

  return { events, failed, got401 };
}

/**
 * Get currently active events (happening right now)
 * @returns {Promise<Array>}
 */
async function getCurrentEvents() {
  const settings = await getCalendarSettings();
  const now = Date.now();

  // Use cached events if recent (< 5 minutes old)
  let events = settings.upcomingEvents || [];
  if (!settings.lastSync || Date.now() - settings.lastSync > 300000) {
    const freshEvents = await fetchUpcomingEvents(1);
    if (!freshEvents.error) {
      events = freshEvents;
    }
  }

  // Filter to currently active events
  return events.filter(event => {
    const start = new Date(event.start).getTime();
    const end = new Date(event.end).getTime();
    return start <= now && end > now;
  });
}

/**
 * Get today's events — fetches the full day (start-of-day to end-of-day)
 * so past events still appear on the schedule. Falls back to cached
 * events when the network or token refresh is unavailable.
 * @returns {Promise<Array>}
 */
async function getTodayEvents() {
  const today = new Date();
  const todayStr = today.getFullYear() + '-' +
    String(today.getMonth() + 1).padStart(2, '0') + '-' +
    String(today.getDate()).padStart(2, '0');
  const startOfDay = new Date(today);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const token = await getValidCalendarToken();

  if (!token) {
    return filterEventsForToday(await getCachedEvents(), todayStr, startOfDay, endOfDay);
  }

  // First attempt
  let result = await fetchTodayEventsWithToken(token, todayStr, startOfDay, endOfDay);

  // If every calendar returned 401, force-refresh the token and retry once
  if (result.got401 && result.events.length === 0) {
    console.log('Got 401 from all calendars, force-refreshing token…');
    const freshToken = await forceRefreshCalendarToken();

    if (freshToken && freshToken !== token) {
      result = await fetchTodayEventsWithToken(freshToken, todayStr, startOfDay, endOfDay);
    }
  }

  // If still no events after retry, fall back to cache
  if (result.events.length === 0 && result.failed) {
    console.log('Calendar fetch failed after retry, using cached events');
    return filterEventsForToday(await getCachedEvents(), todayStr, startOfDay, endOfDay);
  }

  const filtered = filterEventsForToday(result.events, todayStr, startOfDay, endOfDay);

  if (result.events.length > 0) {
    await saveCalendarSettings({ upcomingEvents: result.events, lastSync: Date.now() });
  }

  return filtered;
}

/**
 * Get the events to show on the new tab card.
 * Shows only remaining timed events for today; if none remain and there are
 * no all-day events for today, it falls forward to tomorrow's events.
 * @returns {Promise<{title: string, displayDate: string, events: Array}>}
 */
async function getNewTabEvents() {
  const now = new Date();
  const todayInfo = getDayInfo(now);
  const tomorrowBase = new Date(todayInfo.startOfDay);
  tomorrowBase.setDate(tomorrowBase.getDate() + 1);
  const tomorrowInfo = getDayInfo(tomorrowBase);

  const cachedEvents = await getCachedEvents();
  const settings = await getCalendarSettings();

  let events = cachedEvents;
  let payload = buildNewTabEventsPayload(events, todayInfo, tomorrowInfo, now);

  const cacheStale = !settings.lastSync || Date.now() - settings.lastSync > 300000;
  if (cacheStale || payload.events.length === 0) {
    const freshEvents = await fetchEventsForDisplayRange(todayInfo.startOfDay, tomorrowInfo.endOfDay);
    if (!freshEvents.error) {
      events = freshEvents;
      payload = buildNewTabEventsPayload(events, todayInfo, tomorrowInfo, now);
    }
  }

  return payload;
}

/**
 * Fetch today's events from all selected calendars using a given token.
 * @returns {Promise<{events: Array, failed: boolean, got401: boolean}>}
 */
async function fetchTodayEventsWithToken(token, todayStr, startOfDay, endOfDay) {
  return await fetchEventsForRangeWithToken(token, startOfDay, endOfDay, {
    logLabel: 'today\'s events',
    emptyTitleFallback: '(No title)'
  });
}

async function fetchEventsForDisplayRange(startOfRange, endOfRange) {
  let token = await getValidCalendarToken();
  if (!token) {
    return { error: 'Not connected to Google Calendar' };
  }

  let result = await fetchEventsForRangeWithToken(token, startOfRange, endOfRange, {
    logLabel: 'new tab events',
    emptyTitleFallback: '(No title)'
  });

  if (result.got401 && result.events.length === 0) {
    const freshToken = await forceRefreshCalendarToken();
    if (freshToken && freshToken !== token) {
      result = await fetchEventsForRangeWithToken(freshToken, startOfRange, endOfRange, {
        logLabel: 'new tab events',
        emptyTitleFallback: '(No title)'
      });
    }
  }

  const events = result.events || [];
  events.sort((a, b) => new Date(a.start) - new Date(b.start));

  if (events.length > 0 || !result.failed) {
    await saveCalendarSettings({ upcomingEvents: events, lastSync: Date.now() });
  }

  return events;
}

async function fetchEventsForRangeWithToken(token, startOfRange, endOfRange, { logLabel, emptyTitleFallback }) {
  const settings = await getCalendarSettings();
  const calendarsToFetch = settings.selectedCalendars.length > 0
    ? settings.selectedCalendars
    : ['primary'];

  // Build calendar-id → color map from stored calendar list
  const calList = await fetchCalendarList(token);
  const calColorMap = {};
  for (const cal of calList) {
    calColorMap[cal.id] = cal.color;
  }

  const timeMin = startOfRange.toISOString();
  const timeMax = endOfRange.toISOString();

  const allEvents = [];
  let fetchFailed = false;
  let got401 = false;
  await Promise.allSettled(calendarsToFetch.map(async (calendarId) => {
    try {
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '100'
      });

      const response = await fetchWithRetry(
        `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.status === 401) {
        got401 = true;
        fetchFailed = true;
        return;
      }

      if (!response.ok) {
        console.error(`Failed to fetch ${logLabel} from calendar ${calendarId}:`, response.status);
        fetchFailed = true;
        return;
      }

      const data = await response.json();
      const calColor = calColorMap[calendarId] || '#4285f4';

      for (const event of (data.items || [])) {
        const startTime = event.start?.dateTime || event.start?.date;
        const endTime = event.end?.dateTime || event.end?.date;

        if (!startTime || !endTime) continue;

        const title = (event.summary || '').trim();
        if (isCompletedCalendarEventTitle(title)) continue;

        // Per-event colorId overrides the calendar color
        const eventColor = event.colorId
          ? (GCAL_EVENT_COLORS[event.colorId] || calColor)
          : calColor;

        allEvents.push({
          id: event.id,
          calendarId: calendarId,
          title: title || emptyTitleFallback,
          description: event.description || '',
          start: startTime,
          end: endTime,
          isAllDay: !event.start?.dateTime,
          location: event.location || '',
          status: event.status,
          htmlLink: event.htmlLink,
          color: eventColor
        });
      }
    } catch (e) {
      console.error(`Error fetching ${logLabel} from calendar ${calendarId}:`, e);
      fetchFailed = true;
    }
  }));

  return { events: allEvents, failed: fetchFailed, got401 };
}

/**
 * Filter a list of events down to those that fall on a given day.
 */
function filterEventsForToday(events, todayStr, startOfDay, endOfDay) {
  return filterEventsForDay(events, todayStr, startOfDay, endOfDay);
}

function filterEventsForDay(events, dayStr, startOfDay, endOfDay) {
  const filtered = (events || []).filter(event => {
    const title = (event.title || '').trim();
    if (isCompletedCalendarEventTitle(title)) return false;

    if (event.isAllDay) {
      const eventStartDate = event.start.split('T')[0];
      const eventEndDate = event.end.split('T')[0];
      return eventStartDate <= dayStr && eventEndDate > dayStr;
    }

    const start = new Date(event.start).getTime();
    const end = new Date(event.end).getTime();
    // Include events that overlap with today at all
    return start < endOfDay.getTime() && end > startOfDay.getTime();
  });

  filtered.sort((a, b) => new Date(a.start) - new Date(b.start));
  return filtered;
}

function isCompletedCalendarEventTitle(title) {
  const trimmedTitle = (title || '').trim();
  return trimmedTitle.startsWith('✓') || trimmedTitle.startsWith('✔');
}

function filterEventsForNewTabToday(events, dayInfo, now) {
  return filterEventsForDay(events, dayInfo.dayStr, dayInfo.startOfDay, dayInfo.endOfDay)
    .filter(event => {
      if (event.isAllDay) return true;
      return new Date(event.end).getTime() > now.getTime();
    });
}

function buildNewTabEventsPayload(events, todayInfo, tomorrowInfo, now) {
  const todaysEvents = filterEventsForNewTabToday(events, todayInfo, now);
  if (todaysEvents.length > 0) {
    return {
      title: 'Today\'s Schedule',
      displayDate: formatDisplayDate(todayInfo.startOfDay),
      events: todaysEvents
    };
  }

  const tomorrowsEvents = filterEventsForDay(events, tomorrowInfo.dayStr, tomorrowInfo.startOfDay, tomorrowInfo.endOfDay);
  if (tomorrowsEvents.length > 0) {
    return {
      title: 'Tomorrow\'s Schedule',
      displayDate: formatDisplayDate(tomorrowInfo.startOfDay),
      events: tomorrowsEvents
    };
  }

  return {
    title: 'Today\'s Schedule',
    displayDate: formatDisplayDate(todayInfo.startOfDay),
    events: []
  };
}

function getDayInfo(date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const dayStr = startOfDay.getFullYear() + '-' +
    String(startOfDay.getMonth() + 1).padStart(2, '0') + '-' +
    String(startOfDay.getDate()).padStart(2, '0');

  return { dayStr, startOfDay, endOfDay };
}

function formatDisplayDate(date) {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Get cached upcoming events from storage.
 */
async function getCachedEvents() {
  const settings = await getCalendarSettings();
  return settings.upcomingEvents || [];
}

/**
 * Score how well a keyword matches text
 * Higher score = better match
 * @param {string} text - Text to search in (lowercase)
 * @param {string} keyword - Keyword to match (lowercase)
 * @returns {number} - Score (0 = no match)
 */
function scoreKeywordMatch(text, keyword) {
  if (!text.includes(keyword)) {
    return 0;
  }

  // Base score is keyword length (longer = more specific = better)
  let score = keyword.length;

  // Check for word boundary match (much better than substring)
  // Use regex to check if keyword appears as a complete word
  const wordBoundaryRegex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  if (wordBoundaryRegex.test(text)) {
    score += 100; // Strong bonus for exact word match
  }

  return score;
}

/**
 * Find the best matching keyword from a list
 * @param {string} text - Text to search in
 * @param {string[]} keywords - Keywords to match
 * @returns {{keyword: string, score: number}|null}
 */
function findBestKeywordMatch(text, keywords) {
  const lowerText = text.toLowerCase();
  let bestMatch = null;

  for (const keyword of keywords) {
    const lowerKeyword = keyword.toLowerCase();
    const score = scoreKeywordMatch(lowerText, lowerKeyword);

    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { keyword, score };
    }
  }

  return bestMatch;
}

/**
 * Determine the best category for an event based on keyword matching
 * @param {Object} event - Calendar event
 * @returns {'focus'|'break'|null}
 */
function categorizeEventByKeywords(event) {
  const settings = getCalendarSettings();
  const focusKeywords = settings.focusEventKeywords || ['focus', 'work', 'deep work', 'coding', 'meeting', 'busy'];
  const breakKeywords = settings.breakEventKeywords || ['break', 'lunch', 'coffee', 'personal'];

  const text = `${event.title} ${event.description}`;

  const focusMatch = findBestKeywordMatch(text, focusKeywords);
  const breakMatch = findBestKeywordMatch(text, breakKeywords);

  // No matches
  if (!focusMatch && !breakMatch) {
    return null;
  }

  // Only one category matched
  if (focusMatch && !breakMatch) {
    return 'focus';
  }
  if (breakMatch && !focusMatch) {
    return 'break';
  }

  // Both matched - return the one with higher score
  return focusMatch.score >= breakMatch.score ? 'focus' : 'break';
}

/**
 * Check if an event matches focus keywords
 * @param {Object} event - Calendar event
 * @returns {boolean}
 */
function isEventFocusTime(event) {
  const category = categorizeEventByKeywords(event);
  return category === 'focus';
}

/**
 * Check if an event matches break keywords
 * @param {Object} event - Calendar event
 * @returns {boolean}
 */
function isEventBreakTime(event) {
  const category = categorizeEventByKeywords(event);
  return category === 'break';
}

/**
 * Get suggested profile based on current calendar events
 * @returns {Promise<Object|null>}
 */
async function getSuggestedProfileFromCalendar() {
  const calendarSettings = await getCalendarSettings();

  if (!calendarSettings.connected || !calendarSettings.autoSwitchProfiles) {
    return null;
  }

  const currentEvents = await getCurrentEvents();

  if (currentEvents.length === 0) {
    return null;
  }

  // Check profile mappings first - find the best match across all events
  if (calendarSettings.profileMapping && calendarSettings.profileMapping.length > 0) {
    let bestMappingMatch = null;

    for (const event of currentEvents) {
      const text = `${event.title} ${event.description}`;

      for (const mapping of calendarSettings.profileMapping) {
        // Find the best keyword match for this mapping
        const keywordMatch = findBestKeywordMatch(text, mapping.eventKeywords);

        if (keywordMatch) {
          if (!bestMappingMatch || keywordMatch.score > bestMappingMatch.score) {
            bestMappingMatch = {
              profileId: mapping.profileId,
              event: event,
              score: keywordMatch.score
            };
          }
        }

        // Calendar ID match (lower priority than keyword match)
        if (mapping.calendarId === event.calendarId && !bestMappingMatch) {
          bestMappingMatch = {
            profileId: mapping.profileId,
            event: event,
            score: 1
          };
        }
      }
    }

    if (bestMappingMatch) {
      return { profileId: bestMappingMatch.profileId, event: bestMappingMatch.event };
    }
  }

  // Fall back to keyword-based detection
  for (const event of currentEvents) {
    if (isEventFocusTime(event)) {
      // Suggest a strict profile like "Work"
      const profiles = await getProfiles();
      const workProfile = profiles.find(p =>
        p.name.toLowerCase().includes('work') ||
        p.name.toLowerCase().includes('focus')
      );
      if (workProfile) {
        return { profileId: workProfile.id, event: event };
      }
    }

    if (isEventBreakTime(event)) {
      // Suggest a relaxed profile
      const profiles = await getProfiles();
      const relaxedProfile = profiles.find(p =>
        p.name.toLowerCase().includes('relax') ||
        p.name.toLowerCase().includes('break')
      );
      if (relaxedProfile) {
        return { profileId: relaxedProfile.id, event: event };
      }
    }
  }

  return null;
}

/**
 * Auto-switch profile based on calendar events
 * Called by alarm
 */
async function checkCalendarAndSwitchProfile() {
  const calendarSettings = await getCalendarSettings();

  if (!calendarSettings.connected || !calendarSettings.autoSwitchProfiles) {
    return;
  }

  const suggestion = await getSuggestedProfileFromCalendar();

  if (suggestion) {
    const currentProfile = await getCurrentProfile();

    if (currentProfile.id !== suggestion.profileId) {
      await switchProfile(suggestion.profileId);
      console.log(`Auto-switched to profile ${suggestion.profileId} due to calendar event: ${suggestion.event.title}`);
    }
  }
}

/**
 * Start calendar sync alarm
 */
async function startCalendarSync() {
  const settings = await getCalendarSettings();

  if (!settings.connected || !settings.syncEnabled) {
    await chrome.alarms.clear('calendar-sync');
    return;
  }

  // Sync every 5 minutes
  await chrome.alarms.create('calendar-sync', {
    periodInMinutes: 5
  });

  // Also do an immediate sync
  await fetchUpcomingEvents(7);

  // Check for profile switching
  if (settings.autoSwitchProfiles) {
    await checkCalendarAndSwitchProfile();
  }
}

/**
 * Handle calendar sync alarm
 */
async function handleCalendarSyncAlarm() {
  await fetchUpcomingEvents(7);
  await checkCalendarAndSwitchProfile();
}

/**
 * Update calendar settings (calendars to sync, keywords, mappings)
 * @param {Object} updates - Settings to update
 */
async function updateCalendarSettings(updates) {
  const updated = await saveCalendarSettings(updates);

  // Restart sync if enabled
  if (updated.syncEnabled) {
    await startCalendarSync();
  }

  return updated;
}

/**
 * Get calendar connection status and settings
 * @returns {Promise<Object>}
 */
async function getCalendarStatus() {
  const settings = await getCalendarSettings();

  return {
    connected: settings.connected,
    email: settings.email,
    syncEnabled: settings.syncEnabled,
    autoSwitchProfiles: settings.autoSwitchProfiles,
    selectedCalendars: settings.selectedCalendars,
    focusEventKeywords: settings.focusEventKeywords,
    breakEventKeywords: settings.breakEventKeywords,
    profileMapping: settings.profileMapping,
    lastSync: settings.lastSync,
    upcomingEventsCount: (settings.upcomingEvents || []).length
  };
}

// Initialize rules and badge on service worker wake-up
setTimeout(() => {
  updateBlockingRules();
  startBadgeTimer();
  startUsageTracking();
  scheduleMidnightReset();
  scheduleBedtimeReminderAlarm();
}, 100);

// Update badge when storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && (changes.tempUnblocks || changes.settings)) {
    updateBadgeTimer();
  }
});
