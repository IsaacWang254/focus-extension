/**
 * Focus Extension - Blocked Page Logic
 * Displays Todoist todos and handles unblock methods
 */

import * as todoist from '../lib/todoist.js';

// =============================================================================
// STATE
// =============================================================================

let settings = null;
let blockedDomain = '';
let originalUrl = '';  // Store the full original URL
let completedMethods = {
  timer: false,
  completeTodo: false,
  typePhrase: false,
  typeReason: false,
  mathProblem: false,
  password: false
};
let completedTodosCount = 0;
let timerEndTime = null;
let timerInterval = null;
let mathProblem = { a: 0, b: 0, op: '+', answer: 0 };
let currentRandomPhrase = '';
let currentReason = ''; // Store the reason for unblocking
let earnedTimeInfo = null; // Store earned time info
let completeTodoProgress = null;

const COMMON_REASON_WORDS = new Set([
  'a', 'about', 'after', 'am', 'an', 'and', 'because', 'before', 'but', 'for',
  'from', 'have', 'i', 'if', 'in', 'into', 'is', 'it', 'just', 'me', 'my',
  'need', 'now', 'of', 'on', 'or', 'our', 'quick', 'really', 'so', 'that',
  'the', 'this', 'to', 'today', 'urgent', 'we', 'with', 'work'
]);

function getReasonValidation(text, minLength) {
  const trimmed = text.trim();

  if (trimmed.length < minLength) {
    return {
      isValid: false,
      message: `Write at least ${minLength} characters.`
    };
  }

  if (/(.)\1{5,}/.test(trimmed)) {
    return {
      isValid: false,
      message: 'Avoid repeated characters like "aaaaaa".'
    };
  }

  const words = trimmed.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g) || [];
  if (words.length < 8) {
    return {
      isValid: false,
      message: 'Write at least 8 words.'
    };
  }

  const uniqueWords = new Set(words.map(word => word.toLowerCase()));
  if (uniqueWords.size < 5) {
    return {
      isValid: false,
      message: 'Use a few different words, not the same one repeated.'
    };
  }

  const lettersOnly = trimmed.replace(/[^A-Za-z]/g, '');
  if (!lettersOnly) {
    return {
      isValid: false,
      message: 'Use letters and words, not only symbols or numbers.'
    };
  }

  const lettersRatio = lettersOnly.length / trimmed.length;
  if (lettersRatio < 0.65) {
    return {
      isValid: false,
      message: 'Use mostly words instead of numbers or symbols.'
    };
  }

  const vowelCount = (lettersOnly.match(/[AEIOUYaeiouy]/g) || []).length;
  const vowelRatio = vowelCount / lettersOnly.length;
  if (vowelRatio < 0.22 || vowelRatio > 0.75) {
    return {
      isValid: false,
      message: 'Write a natural sentence with readable words.'
    };
  }

  const commonWordMatches = words.filter(word => COMMON_REASON_WORDS.has(word.toLowerCase())).length;
  if (commonWordMatches < 2) {
    return {
      isValid: false,
      message: 'Write a short sentence in plain language.'
    };
  }

  return {
    isValid: true,
    message: 'Reason looks good.'
  };
}

function preventBulkTextEntry(input, { maxLengthDelta = 1 } = {}) {
  if (!input) {
    return;
  }

  let lastValue = input.value || '';

  input.addEventListener('paste', (event) => {
    event.preventDefault();
  });

  input.addEventListener('drop', (event) => {
    event.preventDefault();
  });

  input.addEventListener('beforeinput', (event) => {
    if (event.inputType === 'insertFromPaste' || event.inputType === 'insertFromDrop') {
      event.preventDefault();
    }
  });

  input.addEventListener('input', () => {
    const currentValue = input.value;
    const delta = currentValue.length - lastValue.length;

    if (delta > maxLengthDelta) {
      input.value = lastValue;
      input.classList.add('error');
      setTimeout(() => input.classList.remove('error'), 300);
      return;
    }

    lastValue = input.value;
  });
}

function getIcon(name, fallback = '') {
  if (typeof Icons !== 'undefined' && Icons && Icons[name]) {
    return Icons[name];
  }

  return fallback;
}

function showInitializationFallback(error) {
  console.error('Blocked page initialization failed:', error);

  const domainEl = document.getElementById('blocked-domain');
  if (domainEl) {
    domainEl.textContent = blockedDomain || 'this site';
  }

  const authSection = document.getElementById('auth-required');
  const authMessage = authSection?.querySelector('.auth-message');
  if (authSection && authMessage) {
    authSection.style.display = 'block';
    authMessage.innerHTML = `
      <h2>Site blocked in incognito</h2>
      <p>Focus blocked this site, but the page UI failed to load fully. Please reload this tab or open extension settings.</p>
      <button id="fallback-open-settings" class="btn btn-primary">Open Settings</button>
    `;
    document.getElementById('fallback-open-settings')?.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
  }

  const unblockButton = document.getElementById('unblock-button');
  if (unblockButton) {
    unblockButton.disabled = true;
  }
}

// =============================================================================
// TOAST NOTIFICATIONS
// =============================================================================

/**
 * Show a toast notification
 * @param {string} message - The message to display (can include HTML)
 * @param {string} type - Toast type: 'success', 'warning', 'error'
 * @param {number} duration - Duration in ms (default 3000)
 */
function showToast(message, type = 'success', duration = 3000) {
  const container = document.getElementById('toast-container');

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  // Icon based on type (using SVG icons)
  let icon = '';
  switch (type) {
    case 'success':
      icon = getIcon('check', '✓');
      break;
    case 'warning':
      icon = getIcon('alertTriangle', '!');
      break;
    case 'error':
      icon = getIcon('x', '✕');
      break;
    default:
      icon = getIcon('info', 'i');
  }

  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-message">${message}</span>
  `;

  container.appendChild(toast);

  // Remove toast after duration
  setTimeout(() => {
    toast.remove();
  }, duration);
}

// =============================================================================
// ICON INITIALIZATION
// =============================================================================

/**
 * Initialize all SVG icons on the page
 */
function initializeIcons() {
  // Theme toggle icons
  const themeIconLight = document.getElementById('theme-icon-light');
  const themeIconDark = document.getElementById('theme-icon-dark');
  if (themeIconLight) themeIconLight.innerHTML = getIcon('sun', '☀');
  if (themeIconDark) themeIconDark.innerHTML = getIcon('moon', '◐');

  // Unblock method icons
  const methodIcons = {
    'method-timer-icon': getIcon('timer', '⏱'),
    'method-todo-icon': getIcon('check', '✓'),
    'method-phrase-icon': getIcon('pencil', '✎'),
    'method-math-icon': getIcon('plus', '+'),
    'method-password-icon': getIcon('lock', 'P'),
    'method-reason-icon': getIcon('messageCircle', 'R')
  };

  for (const [id, icon] of Object.entries(methodIcons)) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = icon;
  }
}

// =============================================================================
// INITIALIZATION
// =============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Initialize SVG icons first
    initializeIcons();

    // Load theme first to avoid flash
    await loadTheme();

    // Setup theme toggle
    setupThemeToggle();
    setupBrowserThemeSyncListener();

    // Load and display motivational quote
    await loadQuote();

    // Parse the blocked URL from query params
    const params = new URLSearchParams(window.location.search);
    originalUrl = params.get('url') || '';
    const fallbackDomain = params.get('domain') || '';
    const referrerUrl = document.referrer || '';

    // Extract domain from the full URL for display
    try {
      if (originalUrl.startsWith('http')) {
        const urlObj = new URL(originalUrl);
        blockedDomain = urlObj.hostname.replace(/^www\./, '');
      } else if (referrerUrl.startsWith('http')) {
        const referrerObj = new URL(referrerUrl);
        blockedDomain = referrerObj.hostname.replace(/^www\./, '');
      } else if (fallbackDomain) {
        blockedDomain = fallbackDomain;
      } else {
        blockedDomain = originalUrl;
      }
    } catch {
      blockedDomain = originalUrl || 'unknown site';
    }

    // Display blocked domain
    document.getElementById('blocked-domain').textContent = blockedDomain;

    // Track this block attempt for achievements
    try {
      await chrome.runtime.sendMessage({ type: 'TRACK_BLOCK_ATTEMPT' });
    } catch (e) {
      // Silently ignore - non-critical for page functionality
    }

    // Load settings
    settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    if (!settings || settings.error) {
      throw new Error(settings?.error || 'Failed to load settings');
    }

    // Update schedule info card
    updateScheduleInfoCard();

    // Update daily limit info card
    await updateDailyLimitInfoCard();

    // Update earned time info card
    await updateEarnedTimeInfoCard();

    // Load task completion progress for todo-based unlocks
    await loadCompleteTodoProgress();

    // Check authentication and load todos
    const isAuthenticated = await todoist.isAuthenticated();

    if (isAuthenticated) {
      showTodosSection();
      loadTodos();
    } else {
      showAuthSection();
    }

    updateCompleteTodoUI();

    // Setup unblock methods
    await setupUnblockMethods();

    // Setup event listeners
    setupEventListeners();
  } catch (error) {
    showInitializationFallback(error);
  }
});

// =============================================================================
// MOTIVATIONAL QUOTES
// =============================================================================

async function loadQuote() {
  try {
    // Get the quote of the day for consistency
    const quote = await chrome.runtime.sendMessage({ type: 'GET_QUOTE_OF_DAY' });

    if (quote) {
      document.getElementById('quote-text').textContent = `"${quote.text}"`;
      document.getElementById('quote-author').textContent = `— ${quote.author}`;
      document.getElementById('quote-section').style.display = 'block';
    }
  } catch (e) {
    console.error('Failed to load quote:', e);
    // Hide quote section on error
    document.getElementById('quote-section').style.display = 'none';
  }
}

// =============================================================================
// THEME
// =============================================================================

const ACCENT_COLOR_CSS_VARIABLES = [
  '--indigo',
  '--indigo-foreground',
  '--indigo-hover',
  '--indigo-subtle',
  '--indigo-50',
  '--indigo-100',
  '--indigo-200',
  '--indigo-800',
  '--indigo-900'
];

function clearAccentColorOverrides() {
  const rootStyle = document.documentElement.style;
  ACCENT_COLOR_CSS_VARIABLES.forEach(variable => rootStyle.removeProperty(variable));
}

async function loadTheme() {
  try {
    const result = await chrome.storage.local.get(['theme', 'brutalistEnabled', 'themeSyncWithBrowser']);
    let base = result.theme;
    const brutalist = result.brutalistEnabled || false;
    const syncWithBrowser = result.themeSyncWithBrowser !== false;

    // If no theme is saved, default to light
    if (!base) {
      base = 'light';
      await chrome.storage.local.set({ theme: 'light' });
    }

    base = getEffectiveThemeBase(base, syncWithBrowser);
    const resolved = resolveThemeVariant(base, { brutalist });
    document.documentElement.setAttribute('data-theme', resolved);
    await applyAccentColorFromStorage();
  } catch (e) {
    console.error('Failed to load theme:', e);
  }
}

function resolveThemeVariant(base, { brutalist = false } = {}) {
  if (brutalist) {
    return base === 'dark' ? 'brutalist-dark' : 'brutalist';
  }

  return base === 'dark' ? 'dashboard-dark' : 'dashboard-light';
}

function getBrowserThemeBase() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getEffectiveThemeBase(base, syncWithBrowser) {
  return syncWithBrowser ? getBrowserThemeBase() : base;
}

function isThemeSyncEnabled(value) {
  return value !== false;
}

/**
 * Load accent color from storage and apply as CSS custom properties.
 */
async function applyAccentColorFromStorage() {
  try {
    const result = await chrome.storage.local.get('accentColor');
    const hex = result.accentColor || '#6366f1';
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    if (theme.startsWith('brutalist') || theme.startsWith('dashboard')) {
      clearAccentColorOverrides();
      return;
    }

    const isDark = theme === 'dark';
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    const mix = (rgb, amt, dir) => {
      const t = dir === 'lighten' ? 255 : 0;
      return { r: rgb.r + (t - rgb.r) * amt, g: rgb.g + (t - rgb.g) * amt, b: rgb.b + (t - rgb.b) * amt };
    };
    const toHex = (r, g, b) => '#' + [r, g, b].map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
    const s = document.documentElement.style;
    const rgb = { r, g, b };

    if (isDark) {
      const lighter = mix(rgb, 0.25, 'lighten');
      const mainHex = toHex(lighter.r, lighter.g, lighter.b);
      const fgDark = (0.299 * lighter.r + 0.587 * lighter.g + 0.114 * lighter.b) / 255 > 0.5 ? '#09090b' : '#ffffff';
      s.setProperty('--indigo', mainHex);
      s.setProperty('--indigo-foreground', fgDark);
      s.setProperty('--indigo-hover', hex);
      s.setProperty('--indigo-subtle', `rgba(${r}, ${g}, ${b}, 0.15)`);
      const s50 = mix(rgb, 0.90, 'darken'), s100 = mix(rgb, 0.85, 'darken'), s200 = mix(rgb, 0.75, 'darken');
      const s800 = mix(rgb, 0.25, 'lighten'), s900 = mix(rgb, 0.40, 'lighten');
      s.setProperty('--indigo-50', toHex(s50.r, s50.g, s50.b));
      s.setProperty('--indigo-100', toHex(s100.r, s100.g, s100.b));
      s.setProperty('--indigo-200', toHex(s200.r, s200.g, s200.b));
      s.setProperty('--indigo-800', toHex(s800.r, s800.g, s800.b));
      s.setProperty('--indigo-900', toHex(s900.r, s900.g, s900.b));
    } else {
      const darker = mix(rgb, 0.15, 'darken');
      const fg = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? '#09090b' : '#ffffff';
      s.setProperty('--indigo', hex);
      s.setProperty('--indigo-foreground', fg);
      s.setProperty('--indigo-hover', toHex(darker.r, darker.g, darker.b));
      s.setProperty('--indigo-subtle', `rgba(${r}, ${g}, ${b}, 0.08)`);
      const s50 = mix(rgb, 0.92, 'lighten'), s100 = mix(rgb, 0.85, 'lighten'), s200 = mix(rgb, 0.72, 'lighten');
      const s800 = mix(rgb, 0.55, 'darken'), s900 = mix(rgb, 0.65, 'darken');
      s.setProperty('--indigo-50', toHex(s50.r, s50.g, s50.b));
      s.setProperty('--indigo-100', toHex(s100.r, s100.g, s100.b));
      s.setProperty('--indigo-200', toHex(s200.r, s200.g, s200.b));
      s.setProperty('--indigo-800', toHex(s800.r, s800.g, s800.b));
      s.setProperty('--indigo-900', toHex(s900.r, s900.g, s900.b));
    }
  } catch (e) {
    // Silently fail — default CSS values remain
  }
}

function setupThemeToggle() {
  const toggle = document.getElementById('theme-toggle');
  toggle.addEventListener('click', async () => {
    const root = document.documentElement;

    // Read storage to get base theme and brutalist state
    const result = await chrome.storage.local.get(['theme', 'brutalistEnabled', 'themeSyncWithBrowser']);
    const storedBase = result.theme || 'light';
    const brutalist = result.brutalistEnabled || false;
    const syncWithBrowser = isThemeSyncEnabled(result.themeSyncWithBrowser);
    const currentBase = getEffectiveThemeBase(storedBase, syncWithBrowser);

    // Toggle the base theme
    const newBase = currentBase === 'dark' ? 'light' : 'dark';

    // Resolve the actual data-theme value
    const resolved = resolveThemeVariant(newBase, { brutalist });
    root.setAttribute('data-theme', resolved);

    // Save the base theme
    try {
      await chrome.storage.local.set({ theme: newBase, themeSyncWithBrowser: false });
    } catch (e) {
      console.error('Failed to save theme:', e);
    }

    // Re-apply accent color for the new theme
    await applyAccentColorFromStorage();
  });
}

function setupBrowserThemeSyncListener() {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', async () => {
    const result = await chrome.storage.local.get('themeSyncWithBrowser');
    if (!isThemeSyncEnabled(result.themeSyncWithBrowser)) return;
    await loadTheme();
  });
}

// =============================================================================
// UI SECTIONS
// =============================================================================

function showAuthSection() {
  document.getElementById('auth-required').style.display = 'block';
  document.getElementById('todos-section').style.display = 'none';
}

function showTodosSection() {
  document.getElementById('auth-required').style.display = 'none';
  document.getElementById('todos-section').style.display = 'block';
}

// =============================================================================
// TODOS
// =============================================================================

// Track all tasks and display state
let allTasks = [];
let labelsMap = new Map();
let showingAllTasks = false;
const INITIAL_TASK_COUNT = 5;
const EXPANDED_TASK_COUNT = 15;

async function loadTodos() {
  const loadingEl = document.getElementById('todos-loading');
  const errorEl = document.getElementById('todos-error');
  const listEl = document.getElementById('todos-list');
  const noTodosEl = document.getElementById('no-todos');

  loadingEl.style.display = 'flex';
  errorEl.style.display = 'none';
  listEl.innerHTML = '';
  noTodosEl.style.display = 'none';
  showingAllTasks = false;

  // Remove existing show more button if present
  const existingShowMore = document.getElementById('show-more-tasks');
  if (existingShowMore) existingShowMore.remove();

  try {
    // Fetch tasks and labels in parallel
    const [tasks, labels] = await Promise.all([
      todoist.getTasksWithSubtasks(),
      todoist.getLabelsMap()
    ]);

    allTasks = tasks;
    labelsMap = labels;

    loadingEl.style.display = 'none';

    if (allTasks.length === 0) {
      noTodosEl.style.display = 'block';
      return;
    }

    // Sort by priority (highest first) then by due date
    allTasks.sort((a, b) => {
      // Priority: 4 is highest in Todoist API
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      // Then by due date
      if (a.due && b.due) {
        return new Date(a.due.date) - new Date(b.due.date);
      }
      if (a.due) return -1;
      if (b.due) return 1;
      return 0;
    });

    // Update task count badge
    const countBadge = document.getElementById('task-count-badge');
    if (countBadge) {
      countBadge.textContent = allTasks.length;
      countBadge.title = `${allTasks.length} task${allTasks.length !== 1 ? 's' : ''} total`;
    }

    // Render initial tasks
    renderTasks(INITIAL_TASK_COUNT);

  } catch (error) {
    loadingEl.style.display = 'none';
    errorEl.style.display = 'block';
    document.getElementById('error-message').textContent = error.message;
  }
}

function renderTasks(count) {
  const listEl = document.getElementById('todos-list');
  const todosSection = document.getElementById('todos-section');

  // Clear existing tasks
  listEl.innerHTML = '';

  // Remove existing show more button
  const existingShowMore = document.getElementById('show-more-tasks');
  if (existingShowMore) existingShowMore.remove();

  // Render tasks up to count
  const displayTasks = allTasks.slice(0, count);
  displayTasks.forEach(task => {
    listEl.appendChild(createTodoElement(task));
  });

  // Add show more/less button if there are more tasks
  if (allTasks.length > INITIAL_TASK_COUNT) {
    const showMoreBtn = document.createElement('button');
    showMoreBtn.id = 'show-more-tasks';
    showMoreBtn.className = 'btn btn-ghost show-more-btn';

    if (count < allTasks.length && count === INITIAL_TASK_COUNT) {
      const remaining = Math.min(allTasks.length - INITIAL_TASK_COUNT, EXPANDED_TASK_COUNT - INITIAL_TASK_COUNT);
      showMoreBtn.innerHTML = `Show ${remaining} more task${remaining > 1 ? 's' : ''} <span class="show-more-icon">↓</span>`;
      showMoreBtn.addEventListener('click', () => {
        showingAllTasks = true;
        renderTasks(EXPANDED_TASK_COUNT);
      });
    } else if (showingAllTasks) {
      showMoreBtn.innerHTML = `Show less <span class="show-more-icon">↑</span>`;
      showMoreBtn.addEventListener('click', () => {
        showingAllTasks = false;
        renderTasks(INITIAL_TASK_COUNT);
        // Scroll to top of todos section
        todosSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    // Insert after the list
    listEl.after(showMoreBtn);
  }
}

function createTodoElement(task, isSubtask = false) {
  const li = document.createElement('li');
  li.className = `todo-item ${todoist.getPriorityClass(task.priority)}${isSubtask ? ' subtask' : ''}`;
  li.dataset.taskId = task.id;

  // Checkbox - circular Todoist style
  const checkbox = document.createElement('div');
  checkbox.className = 'todo-checkbox';
  checkbox.setAttribute('role', 'checkbox');
  checkbox.setAttribute('aria-checked', 'false');
  checkbox.setAttribute('tabindex', '0');
  checkbox.title = 'Complete task';

  // Handle click
  checkbox.addEventListener('click', (e) => {
    e.stopPropagation();
    completeTask(task.id, li, checkbox);
  });

  // Handle keyboard
  checkbox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      completeTask(task.id, li, checkbox);
    }
  });

  // Content
  const content = document.createElement('div');
  content.className = 'todo-content';

  const text = document.createElement('div');
  text.className = 'todo-text';
  text.textContent = task.content;

  content.appendChild(text);

  // Description (if present)
  if (task.description && task.description.trim()) {
    const description = document.createElement('div');
    description.className = 'todo-description';
    description.textContent = task.description;
    content.appendChild(description);
  }

  // Meta info container
  const meta = document.createElement('div');
  meta.className = 'todo-meta';
  let hasMeta = false;

  // Due date badge
  if (task.due) {
    const due = document.createElement('span');
    due.className = 'todo-due';
    const dueText = todoist.formatDueDate(task);
    due.textContent = dueText;

    if (dueText === 'Overdue') {
      due.classList.add('overdue');
    } else if (dueText === 'Today' || dueText.startsWith('Today')) {
      due.classList.add('today');
    }

    meta.appendChild(due);
    hasMeta = true;
  }

  // Labels/tags
  if (task.labels && task.labels.length > 0) {
    const labelsContainer = document.createElement('div');
    labelsContainer.className = 'todo-labels';

    for (const labelName of task.labels) {
      const labelEl = document.createElement('span');
      labelEl.className = 'todo-label';
      labelEl.textContent = labelName;

      // Get label color from cache
      const labelInfo = labelsMap.get(labelName.toLowerCase());
      if (labelInfo && labelInfo.color) {
        labelEl.setAttribute('data-color', labelInfo.color);
      }

      labelsContainer.appendChild(labelEl);
    }

    meta.appendChild(labelsContainer);
    hasMeta = true;
  }

  // Subtask count indicator (for parent tasks with subtasks)
  if (!isSubtask && task.subtasks && task.subtasks.length > 0) {
    const subtaskCount = document.createElement('span');
    subtaskCount.className = 'subtask-count';
    subtaskCount.textContent = `${task.subtasks.length} subtask${task.subtasks.length > 1 ? 's' : ''}`;
    meta.appendChild(subtaskCount);
    hasMeta = true;
  }

  if (hasMeta) {
    content.appendChild(meta);
  }

  // Subtasks (if present and not already a subtask) - nested inside content
  if (!isSubtask && task.subtasks && task.subtasks.length > 0) {
    const subtasksList = document.createElement('ul');
    subtasksList.className = 'subtasks-list';

    task.subtasks.forEach(subtask => {
      subtasksList.appendChild(createTodoElement(subtask, true));
    });

    content.appendChild(subtasksList);
  }

  li.appendChild(checkbox);
  li.appendChild(content);

  return li;
}

async function completeTask(taskId, listItem, checkbox) {
  // Prevent double-clicks
  if (checkbox.classList.contains('completed')) return;

  // Optimistic UI update with animation
  checkbox.classList.add('completed');
  checkbox.setAttribute('aria-checked', 'true');
  listItem.classList.add('completed');

  // Add a satisfying haptic-like visual feedback
  checkbox.style.transform = 'scale(1.1)';
  setTimeout(() => {
    checkbox.style.transform = 'scale(1)';
  }, 150);

  try {
    await todoist.completeTask(taskId);

    // Increment completed count
    completedTodosCount++;

    // Award earned time if feature is enabled
    if (earnedTimeInfo && earnedTimeInfo.enabled) {
      const result = await chrome.runtime.sendMessage({ type: 'ADD_EARNED_TIME', taskCount: 1 });
      if (result && result.added > 0) {
        // Update local earned time info
        earnedTimeInfo.minutes = result.minutes;
        earnedTimeInfo.tasksCompleted = result.tasksCompleted;
        earnedTimeInfo.totalEarned = result.totalEarned;
        earnedTimeInfo.totalUsed = result.totalUsed;

        const rewardMessage = getEarnedTimeToastMessage(result);
        showToast(rewardMessage, 'success');

        // Update the earned time info card
        await updateEarnedTimeInfoCard();

        // If we were showing insufficient earned time, check if we can now show normal methods
        const insufficientSection = document.getElementById('insufficient-earned-time');
        if (insufficientSection && insufficientSection.style.display === 'block' && earnedTimeInfo.minutes > 0) {
          // Refresh the page to show unblock methods
          location.reload();
        }
      }
    } else {
      // Show simple completion toast when earned time is not enabled
      showToast('Task completed!', 'success', 2000);
    }

    // Check if completeTodo method is satisfied
    if (settings.unblockMethods.completeTodo.enabled && !completedMethods.completeTodo) {
      if (settings.unblockMethods.completeTodo.mode === 'daily') {
        await loadCompleteTodoProgress();
        updateCompleteTodoUI();

        if (completeTodoProgress?.satisfied) {
          completedMethods.completeTodo = true;
          updateMethodStatus('method-todo', 'todo-status', true);
          checkUnblockReady();

          const dailyGoalLocked = document.getElementById('daily-task-goal-locked');
          if (dailyGoalLocked && dailyGoalLocked.style.display === 'block') {
            location.reload();
          }
        }
      } else {
        completedMethods.completeTodo = true;
        updateMethodStatus('method-todo', 'todo-status', true);
        checkUnblockReady();
      }
    }

    // Remove the item after animation completes
    setTimeout(() => {
      listItem.style.opacity = '0';
      listItem.style.transform = 'translateX(20px) scale(0.95)';
      listItem.style.transition = 'all 0.3s ease';
      listItem.style.maxHeight = listItem.offsetHeight + 'px';

      setTimeout(() => {
        listItem.style.maxHeight = '0';
        listItem.style.padding = '0';
        listItem.style.margin = '0';
        listItem.style.borderWidth = '0';

        setTimeout(() => listItem.remove(), 200);
      }, 150);
    }, 600);

  } catch (error) {
    // Revert on error
    checkbox.classList.remove('completed');
    checkbox.setAttribute('aria-checked', 'false');
    listItem.classList.remove('completed');
    showToast('Failed to complete task. Please try again.', 'error');
    console.error('Failed to complete task:', error);
  }
}

function formatMinutes(value) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : `${rounded.toFixed(1)}`;
}

function getEarnedTimeToastMessage(result) {
  const totalAdded = formatMinutes(result.added || 0);
  const sessionAdded = formatMinutes(result.sessionAdded || 0);
  const bankAdded = formatMinutes(result.bankAdded || 0);

  if (result.rewardType === 'session') {
    return `<strong>+${totalAdded} min</strong> added to your current unblock`;
  }

  if (result.rewardType === 'split') {
    return `<strong>+${sessionAdded} min</strong> added to this unblock, <strong>+${bankAdded} min</strong> banked`;
  }

  return `<strong>+${totalAdded} min</strong> earned! Bank: ${formatMinutes(result.minutes || 0)} min`;
}

// =============================================================================
// UNBLOCK METHODS
// =============================================================================

/**
 * Check if current time is within an allowed time window according to schedule
 * @param {object} schedule - The schedule settings
 * @returns {boolean} True if currently in an allowed time window
 */
function isInAllowedTimeWindow(schedule) {
  if (!schedule || !schedule.enabled) {
    return true; // Schedule not enabled, always allow unblocking
  }

  const now = new Date();
  const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday

  // Check if today is an active day for the schedule
  if (!schedule.activeDays.includes(currentDay)) {
    return true; // Schedule doesn't apply today, allow unblocking
  }

  // If no time windows defined, nothing is allowed
  if (!schedule.allowedTimes || schedule.allowedTimes.length === 0) {
    return false;
  }

  // Get current time in HH:MM format
  const currentTime = now.toTimeString().slice(0, 5); // "HH:MM"

  // Check each allowed time window
  for (const window of schedule.allowedTimes) {
    if (isTimeInRange(currentTime, window.start, window.end)) {
      return true; // Currently in an allowed window
    }
  }

  return false; // Not in any allowed window
}

/**
 * Check if a time is within a range
 * @param {string} time - Time to check (HH:MM)
 * @param {string} start - Start time (HH:MM)
 * @param {string} end - End time (HH:MM)
 * @returns {boolean} True if time is within range
 */
function isTimeInRange(time, start, end) {
  // Handle overnight ranges (e.g., 22:00 to 06:00)
  if (start <= end) {
    // Normal range (e.g., 09:00 to 17:00)
    return time >= start && time <= end;
  } else {
    // Overnight range (e.g., 22:00 to 06:00)
    return time >= start || time <= end;
  }
}

/**
 * Update the schedule info card below todos
 */
function updateScheduleInfoCard() {
  const container = document.getElementById('schedule-info');

  if (!container) {
    return;
  }

  const iconEl = document.getElementById('schedule-info-icon');
  const statusEl = document.getElementById('schedule-info-status');
  const detailEl = document.getElementById('schedule-info-detail');

  const schedule = settings.schedule;

  // Only show if schedule is enabled
  if (!schedule || !schedule.enabled) {
    container.style.display = 'none';
    return;
  }

  // Check if there are any time windows configured
  if (!schedule.allowedTimes || schedule.allowedTimes.length === 0) {
    container.style.display = 'none';
    return;
  }

  const now = new Date();
  const currentDay = now.getDay();
  const activeDays = schedule.activeDays || [];
  const isActiveDay = activeDays.includes(currentDay);

  if (!isActiveDay) {
    // Not an active day - no restrictions, show info card
    container.style.display = 'block';
    if (iconEl) iconEl.innerHTML = getIcon('checkCircle', '✓');
    if (statusEl) statusEl.textContent = 'Schedule paused today';
    const nextDayText = getNextActiveDayText(schedule);
    if (detailEl) detailEl.textContent = nextDayText || 'Resumes on next active day';
    container.classList.add('allowed');
    return;
  }

  const canUnblock = isInAllowedTimeWindow(schedule);

  if (canUnblock) {
    // In allowed window - show info card
    container.style.display = 'block';
    if (iconEl) iconEl.innerHTML = getIcon('checkCircle', '✓');
    if (statusEl) statusEl.textContent = 'Unblock methods available';
    if (detailEl) detailEl.textContent = getWindowEndText(schedule);
    container.classList.add('allowed');
  } else {
    // Outside allowed window - hide info card, will show full schedule-locked section
    container.style.display = 'none';
  }
}

/**
 * Get text showing when current allowed window ends
 */
function getWindowEndText(schedule) {
  const now = new Date();
  const currentTime = now.toTimeString().slice(0, 5);

  for (const window of schedule.allowedTimes) {
    if (isTimeInRange(currentTime, window.start, window.end)) {
      const [h, m] = window.end.split(':').map(Number);
      return `Until ${formatTime12Hour(h, m)}`;
    }
  }
  return '';
}

/**
 * Get text showing when next allowed window opens (for the info card)
 */
function getNextWindowTextForCard(schedule) {
  const nextWindow = getNextAllowedWindow(schedule);

  if (!nextWindow) {
    return 'No upcoming windows';
  }

  const [h, m] = nextWindow.start.split(':').map(Number);

  if (nextWindow.dayLabel === 'Today') {
    return `Opens at ${formatTime12Hour(h, m)}`;
  } else {
    return `Opens ${nextWindow.dayLabel} at ${formatTime12Hour(h, m)}`;
  }
}

/**
 * Get text showing when schedule resumes on next active day
 */
function getNextActiveDayText(schedule) {
  const now = new Date();
  const currentDay = now.getDay();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Sort windows by start time
  const sortedWindows = [...schedule.allowedTimes].sort((a, b) => a.start.localeCompare(b.start));

  for (let i = 1; i <= 7; i++) {
    const nextDay = (currentDay + i) % 7;
    if (schedule.activeDays && schedule.activeDays.includes(nextDay)) {
      const dayName = i === 1 ? 'Tomorrow' : dayNames[nextDay];
      if (sortedWindows.length > 0) {
        const [h, m] = sortedWindows[0].start.split(':').map(Number);
        return `Resumes ${dayName} at ${formatTime12Hour(h, m)}`;
      }
      return `Resumes ${dayName}`;
    }
  }
  return '';
}

/**
 * Format time in 12-hour format
 */
function formatTime12Hour(hours, minutes) {
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const displayMinutes = minutes.toString().padStart(2, '0');
  return `${displayHours}:${displayMinutes} ${period}`;
}

async function loadCompleteTodoProgress() {
  try {
    completeTodoProgress = await chrome.runtime.sendMessage({ type: 'GET_COMPLETE_TODO_PROGRESS' });
  } catch (error) {
    completeTodoProgress = null;
    console.error('Failed to load task completion progress:', error);
  }
}

function updateCompleteTodoUI() {
  const methodHintEl = document.getElementById('todo-method-hint');
  const progressEl = document.getElementById('todo-progress');
  const progressCountEl = document.getElementById('todo-progress-count');
  const progressFillEl = document.getElementById('todo-progress-fill');

  if (!methodHintEl) {
    return;
  }

  const todoSettings = settings?.unblockMethods?.completeTodo || {};
  const mode = todoSettings.mode || 'single';
  const requiredCount = Math.max(1, todoSettings.requiredCount || 3);

  if (mode === 'daily') {
    const completedCount = completeTodoProgress?.completedCount || 0;
    const percentage = Math.min((completedCount / requiredCount) * 100, 100);
    methodHintEl.textContent = `Complete ${requiredCount} tasks today to unlock time-based access.`;
    if (progressEl) progressEl.style.display = 'block';
    if (progressCountEl) progressCountEl.textContent = `${completedCount} / ${requiredCount}`;
    if (progressFillEl) progressFillEl.style.width = `${percentage}%`;
  } else {
    methodHintEl.textContent = 'Complete at least one task from the list above to unlock.';
    if (progressEl) progressEl.style.display = 'none';
  }
}

/**
 * Update the daily limit info card
 */
async function updateDailyLimitInfoCard() {
  const container = document.getElementById('daily-limit-info');

  if (!container) {
    return;
  }

  // Get daily usage info from background
  const usageInfo = await chrome.runtime.sendMessage({ type: 'GET_DAILY_USAGE' });

  if (!usageInfo || !usageInfo.enabled) {
    container.style.display = 'none';
    return;
  }

  const iconEl = document.getElementById('daily-limit-info-icon');
  const statusEl = document.getElementById('daily-limit-info-status');
  const detailEl = document.getElementById('daily-limit-info-detail');

  container.style.display = 'block';

  if (usageInfo.exceeded) {
    // Daily limit exceeded
    if (iconEl) iconEl.innerHTML = getIcon('clock', '⏱');
    if (statusEl) statusEl.textContent = 'Daily limit reached';
    if (detailEl) detailEl.textContent = `${usageInfo.usedMinutes} / ${usageInfo.limitMinutes} min used`;
    container.classList.remove('available');
    container.classList.add('exceeded');
  } else {
    // Daily limit not exceeded, show remaining
    if (iconEl) iconEl.innerHTML = getIcon('clock', '⏱');
    if (statusEl) statusEl.textContent = `${usageInfo.remainingMinutes} min remaining today`;
    if (detailEl) detailEl.textContent = `${usageInfo.usedMinutes} / ${usageInfo.limitMinutes} min used`;
    container.classList.remove('exceeded');
    container.classList.add('available');
  }
}

/**
 * Update the earned time info card
 */
async function updateEarnedTimeInfoCard() {
  const container = document.getElementById('earned-time-info');

  if (!container) {
    return;
  }

  // Get earned time info from background
  earnedTimeInfo = await chrome.runtime.sendMessage({ type: 'GET_EARNED_TIME' });

  if (!earnedTimeInfo || !earnedTimeInfo.enabled) {
    container.style.display = 'none';
    return;
  }

  const iconEl = document.getElementById('earned-time-info-icon');
  const statusEl = document.getElementById('earned-time-info-status');
  const detailEl = document.getElementById('earned-time-info-detail');

  container.style.display = 'block';

  if (earnedTimeInfo.requireTasksToUnlock && earnedTimeInfo.minutes <= 0) {
    // No earned time and it's required
    if (iconEl) iconEl.innerHTML = getIcon('zap', '⚡');
    if (statusEl) statusEl.textContent = 'No earned time';
    if (detailEl) detailEl.textContent = `Complete tasks to earn ${earnedTimeInfo.minutesPerTask} min each`;
    container.classList.remove('available');
    container.classList.add('empty');
  } else if (earnedTimeInfo.minutes > 0) {
    // Has earned time
    if (iconEl) iconEl.innerHTML = getIcon('zap', '⚡');
    if (statusEl) statusEl.textContent = `${earnedTimeInfo.minutes} min earned`;
    if (detailEl) detailEl.textContent = `${earnedTimeInfo.tasksCompleted} tasks completed`;
    container.classList.remove('empty');
    container.classList.add('available');
  } else {
    // Earned time enabled but not required, bank is empty
    if (iconEl) iconEl.innerHTML = getIcon('zap', '⚡');
    if (statusEl) statusEl.textContent = 'Earn bonus time';
    if (detailEl) detailEl.textContent = `Complete tasks to earn ${earnedTimeInfo.minutesPerTask} min each`;
    container.classList.remove('empty', 'available');
  }

  // Update time button availability indicators
  updateTimeButtonsAvailability();
}

/**
 * Update time buttons to show availability based on earned time
 */
function updateTimeButtonsAvailability() {
  // Only show indicators if earned time is enabled and has a balance
  if (!earnedTimeInfo || !earnedTimeInfo.enabled) {
    return;
  }

  const availableMinutes = earnedTimeInfo.minutes;
  const buttons = document.querySelectorAll('.time-btn:not(.time-btn-unlimited)');

  buttons.forEach(btn => {
    const minutes = parseFloat(btn.dataset.minutes);
    const availabilityIndicator = btn.querySelector('.time-btn-availability');

    // Remove existing indicator
    if (availabilityIndicator) {
      availabilityIndicator.remove();
    }

    // Only show indicators when earned time is required or has a balance
    if (earnedTimeInfo.requireTasksToUnlock || availableMinutes > 0) {
      // Add availability indicator
      if (minutes <= availableMinutes) {
        btn.classList.remove('insufficient-time');
        btn.classList.add('sufficient-time');
      } else {
        btn.classList.add('insufficient-time');
        btn.classList.remove('sufficient-time');
      }
    } else {
      btn.classList.remove('insufficient-time', 'sufficient-time');
    }
  });

  // Also update the custom time input visual state
  updateCustomTimeAvailability();
}

/**
 * Update custom time input availability indicator
 */
function updateCustomTimeAvailability() {
  const customInput = document.getElementById('custom-time');
  if (!customInput || !earnedTimeInfo || !earnedTimeInfo.enabled) {
    return;
  }

  const customMinutes = parseFloat(customInput.value) || 0;
  const availableMinutes = earnedTimeInfo.minutes;

  if (earnedTimeInfo.requireTasksToUnlock || availableMinutes > 0) {
    if (customMinutes > 0 && customMinutes <= availableMinutes) {
      customInput.classList.remove('insufficient-time');
      customInput.classList.add('sufficient-time');
    } else if (customMinutes > availableMinutes) {
      customInput.classList.add('insufficient-time');
      customInput.classList.remove('sufficient-time');
    } else {
      customInput.classList.remove('insufficient-time', 'sufficient-time');
    }
  } else {
    customInput.classList.remove('insufficient-time', 'sufficient-time');
  }
}

/**
 * Show the daily limit exceeded section
 */
async function showDailyLimitExceeded() {
  // Get daily usage info
  const usageInfo = await chrome.runtime.sendMessage({ type: 'GET_DAILY_USAGE' });

  // Hide the section header
  document.querySelector('#unblock-section .section-header').style.display = 'none';

  // Hide individual unblock methods
  document.querySelectorAll('.unblock-methods .method').forEach(el => el.style.display = 'none');
  document.getElementById('no-methods').style.display = 'none';
  document.getElementById('schedule-locked').style.display = 'none';
  document.getElementById('daily-task-goal-locked').style.display = 'none';
  document.querySelector('.time-limit-section').style.display = 'none';
  document.querySelector('.unblock-action').style.display = 'none';

  // Show daily limit exceeded section
  const exceededSection = document.getElementById('daily-limit-exceeded');
  exceededSection.style.display = 'block';

  // Update usage display
  if (usageInfo) {
    document.getElementById('daily-limit-used').textContent = usageInfo.usedMinutes;
    document.getElementById('daily-limit-total').textContent = usageInfo.limitMinutes;
  }

  // Setup link to settings
  const settingsLink = document.getElementById('open-options-daily-limit');
  if (settingsLink) {
    settingsLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }
}

/**
 * Show the insufficient earned time section
 */
/**
 * Show the nuclear mode active section
 */
async function showNuclearModeActive(nuclearStatus) {
  // Hide the section header
  document.querySelector('#unblock-section .section-header').style.display = 'none';

  // Hide individual unblock methods
  document.querySelectorAll('.unblock-methods .method').forEach(el => el.style.display = 'none');
  document.getElementById('no-methods').style.display = 'none';
  document.getElementById('schedule-locked').style.display = 'none';
  document.getElementById('daily-limit-exceeded').style.display = 'none';
  document.getElementById('daily-task-goal-locked').style.display = 'none';
  document.getElementById('insufficient-earned-time').style.display = 'none';
  document.querySelector('.time-limit-section').style.display = 'none';
  document.querySelector('.unblock-action').style.display = 'none';

  // Show nuclear mode section
  const nuclearSection = document.getElementById('nuclear-mode-active');
  nuclearSection.style.display = 'block';

  // Start countdown timer
  if (nuclearStatus.expiresAt) {
    startNuclearCountdown(nuclearStatus.expiresAt);
  }
}

let nuclearCountdownInterval = null;

/**
 * Start the countdown timer for nuclear mode
 */
function startNuclearCountdown(expiresAt) {
  // Clear any existing interval
  if (nuclearCountdownInterval) {
    clearInterval(nuclearCountdownInterval);
  }

  function updateCountdown() {
    const now = Date.now();
    const remaining = Math.max(0, expiresAt - now);

    if (remaining <= 0) {
      // Nuclear mode ended! Reload the page
      clearInterval(nuclearCountdownInterval);
      location.reload();
      return;
    }

    const totalSeconds = Math.floor(remaining / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    document.getElementById('nuclear-hours').textContent = hours.toString().padStart(2, '0');
    document.getElementById('nuclear-minutes').textContent = minutes.toString().padStart(2, '0');
    document.getElementById('nuclear-seconds').textContent = seconds.toString().padStart(2, '0');
  }

  // Update immediately, then every second
  updateCountdown();
  nuclearCountdownInterval = setInterval(updateCountdown, 1000);
}

/**
 * Show the insufficient earned time section
 */
async function showInsufficientEarnedTime() {
  // Get earned time info
  const earnedInfo = earnedTimeInfo || await chrome.runtime.sendMessage({ type: 'GET_EARNED_TIME' });

  // Hide the section header
  document.querySelector('#unblock-section .section-header').style.display = 'none';

  // Hide individual unblock methods (but keep Complete Todo visible so user can earn time)
  document.querySelectorAll('.unblock-methods .method').forEach(el => {
    // Keep the todo method visible so users can complete tasks
    if (el.id !== 'method-todo') {
      el.style.display = 'none';
    }
  });
  document.getElementById('no-methods').style.display = 'none';
  document.getElementById('schedule-locked').style.display = 'none';
  document.getElementById('daily-limit-exceeded').style.display = 'none';
  document.getElementById('daily-task-goal-locked').style.display = 'none';
  document.querySelector('.time-limit-section').style.display = 'none';
  document.querySelector('.unblock-action').style.display = 'none';

  // Show insufficient earned time section
  const insufficientSection = document.getElementById('insufficient-earned-time');
  insufficientSection.style.display = 'block';

  // Update earned time display
  if (earnedInfo) {
    document.getElementById('earned-time-bank-minutes').textContent = earnedInfo.minutes;
    document.getElementById('earned-time-per-task').textContent = earnedInfo.minutesPerTask;
  }

  // Setup link to settings
  const settingsLink = document.getElementById('open-options-earned-time');
  if (settingsLink) {
    settingsLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }
}

async function showDailyTaskGoalLocked() {
  const progress = completeTodoProgress || await chrome.runtime.sendMessage({ type: 'GET_COMPLETE_TODO_PROGRESS' });
  completeTodoProgress = progress;

  document.querySelector('#unblock-section .section-header').style.display = 'none';

  document.querySelectorAll('.unblock-methods .method').forEach(el => {
    if (el.id !== 'method-todo') {
      el.style.display = 'none';
    }
  });
  document.getElementById('no-methods').style.display = 'none';
  document.getElementById('schedule-locked').style.display = 'none';
  document.getElementById('daily-limit-exceeded').style.display = 'none';
  document.getElementById('insufficient-earned-time').style.display = 'none';
  document.querySelector('.time-limit-section').style.display = 'none';
  document.querySelector('.unblock-action').style.display = 'none';

  const lockedSection = document.getElementById('daily-task-goal-locked');
  lockedSection.style.display = 'block';

  document.getElementById('daily-task-progress-count').textContent = progress?.completedCount || 0;
  document.getElementById('daily-task-progress-required').textContent = progress?.requiredCount || 0;

  const remaining = progress?.remainingCount || 0;
  const hint = document.getElementById('daily-task-progress-hint');
  if (hint) {
    hint.textContent = remaining > 0
      ? `Complete ${remaining} more task${remaining === 1 ? '' : 's'} from Todoist to continue.`
      : 'Task goal complete. Reload if the unlock controls do not appear yet.';
  }

  const settingsLink = document.getElementById('open-options-daily-task-goal');
  if (settingsLink) {
    settingsLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }
}

async function setupUnblockMethods() {
  const methods = settings.unblockMethods;
  const schedule = settings.schedule;

  // Check if nuclear mode is active
  const nuclearStatus = await chrome.runtime.sendMessage({ type: 'GET_NUCLEAR_STATUS' });
  if (nuclearStatus && nuclearStatus.active) {
    await showNuclearModeActive(nuclearStatus);
    return;
  }

  // Check if daily limit is exceeded
  const usageInfo = await chrome.runtime.sendMessage({ type: 'GET_DAILY_USAGE' });
  if (usageInfo && usageInfo.enabled && usageInfo.exceeded) {
    await showDailyLimitExceeded();
    return;
  }

  // Check if earned time is required but user has none
  const earnedInfo = await chrome.runtime.sendMessage({ type: 'GET_EARNED_TIME' });
  earnedTimeInfo = earnedInfo;
  if (earnedInfo && earnedInfo.enabled && earnedInfo.requireTasksToUnlock && earnedInfo.minutes <= 0) {
    await showInsufficientEarnedTime();
    return;
  }

  if (methods.completeTodo.enabled && methods.completeTodo.mode === 'daily') {
    completeTodoProgress = completeTodoProgress || await chrome.runtime.sendMessage({ type: 'GET_COMPLETE_TODO_PROGRESS' });
    updateCompleteTodoUI();

    if (!completeTodoProgress?.satisfied) {
      await showDailyTaskGoalLocked();
      return;
    }

    completedMethods.completeTodo = true;
    updateMethodStatus('method-todo', 'todo-status', true);
  }

  // Check if we're in an allowed time window
  const canUnblock = isInAllowedTimeWindow(schedule);

  // If schedule is enabled and we're outside allowed times, show locked message
  if (schedule && schedule.enabled && !canUnblock) {
    showScheduleLocked(schedule);
    return;
  }

  let anyMethodEnabled = false;

  // Update require mode badge
  const requireBadge = document.getElementById('require-mode');
  requireBadge.textContent = settings.requireAllMethods ? 'Complete all' : 'Complete any one';

  // Show unlimited button if allowed in settings
  if (settings.allowUnlimitedTime) {
    document.querySelector('.time-btn-unlimited').style.display = 'inline-block';
  }

  // Timer method
  if (methods.timer.enabled) {
    document.getElementById('method-timer').style.display = 'block';
    anyMethodEnabled = true;
    startTimer(getTimerDurationSeconds(methods.timer));
  }

  // Complete todo method
  if (methods.completeTodo.enabled) {
    document.getElementById('method-todo').style.display = 'block';
    anyMethodEnabled = true;
    updateCompleteTodoUI();
  }

  // Type phrase method
  if (methods.typePhrase.enabled) {
    document.getElementById('method-phrase').style.display = 'block';

    if (methods.typePhrase.useRandomString) {
      // Generate random string
      generateRandomPhrase(methods.typePhrase.randomLength || 30);
      document.getElementById('new-phrase').style.display = 'inline-block';
      document.querySelector('#method-phrase .method-hint').textContent = 'Type the following random string exactly:';
    } else {
      document.getElementById('required-phrase').textContent = `"${methods.typePhrase.phrase}"`;
    }
    anyMethodEnabled = true;
  }

  // Math problem method
  if (methods.mathProblem.enabled) {
    document.getElementById('method-math').style.display = 'block';
    anyMethodEnabled = true;
    generateMathProblem();
  }

  // Password method
  if (methods.password.enabled) {
    document.getElementById('method-password').style.display = 'block';
    anyMethodEnabled = true;
  }

  // Type reason method
  if (methods.typeReason?.enabled) {
    document.getElementById('method-reason').style.display = 'block';
    const minLength = methods.typeReason.minLength || 50;
    document.getElementById('reason-min-chars').textContent = minLength;
    document.getElementById('reason-validation-message').textContent = `Write at least ${minLength} characters and use real words.`;
    anyMethodEnabled = true;
  }

  // Show "no methods" message if none enabled
  if (!anyMethodEnabled) {
    document.getElementById('no-methods').style.display = 'block';
    // If no methods are enabled, allow immediate unblock
    document.getElementById('unblock-button').disabled = false;
    document.getElementById('unblock-hint').textContent = 'No unblock methods configured';
  }
}

/**
 * Show the schedule locked message when outside allowed time windows
 */
function showScheduleLocked(schedule) {
  // Hide the entire section header (including "Unblock This Site")
  document.querySelector('#unblock-section .section-header').style.display = 'none';

  // Hide individual unblock methods instead of the whole container
  document.querySelectorAll('.unblock-methods .method').forEach(el => el.style.display = 'none');
  document.getElementById('no-methods').style.display = 'none';
  document.getElementById('daily-task-goal-locked').style.display = 'none';
  document.querySelector('.time-limit-section').style.display = 'none';
  document.querySelector('.unblock-action').style.display = 'none';

  // Show schedule locked section
  const lockedSection = document.getElementById('schedule-locked');
  lockedSection.style.display = 'block';

  // Calculate and display countdown to next allowed window
  const nextWindow = getNextAllowedWindow(schedule);
  if (nextWindow) {
    // Show when the next window starts
    document.getElementById('schedule-next-window').textContent =
      `Next window: ${nextWindow.dayLabel} at ${formatTime(nextWindow.start)}`;

    // Start countdown timer
    startScheduleCountdown(nextWindow.timestamp);
  } else {
    // No upcoming windows (shouldn't happen normally)
    document.getElementById('schedule-countdown-timer').textContent = '--:--:--';
    document.getElementById('schedule-next-window').textContent = 'No upcoming windows scheduled';
  }

  // Setup link to settings
  document.getElementById('open-options-schedule').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

/**
 * Get the next allowed time window
 */
function getNextAllowedWindow(schedule) {
  if (!schedule.allowedTimes || schedule.allowedTimes.length === 0) {
    return null;
  }

  const now = new Date();
  const currentDay = now.getDay();
  const currentTime = now.toTimeString().slice(0, 5);
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Sort time windows by start time to ensure we find the actual next window
  const sortedWindows = [...schedule.allowedTimes].sort((a, b) => {
    return a.start.localeCompare(b.start);
  });

  // Check up to 7 days ahead
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const checkDay = (currentDay + dayOffset) % 7;

    // Skip if this day is not in active days
    if (!schedule.activeDays.includes(checkDay)) {
      continue;
    }

    // Check all time windows for this day (now sorted)
    for (const window of sortedWindows) {
      // If it's today, only consider windows that haven't started yet
      if (dayOffset === 0 && window.start <= currentTime) {
        continue;
      }

      // Calculate the timestamp for this window
      const targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + dayOffset);
      const [hours, minutes] = window.start.split(':').map(Number);
      targetDate.setHours(hours, minutes, 0, 0);

      return {
        start: window.start,
        end: window.end,
        day: checkDay,
        dayLabel: dayOffset === 0 ? 'Today' : dayOffset === 1 ? 'Tomorrow' : dayNames[checkDay],
        timestamp: targetDate.getTime()
      };
    }
  }

  return null;
}

let scheduleCountdownInterval = null;

/**
 * Start the countdown timer to next allowed window
 */
function startScheduleCountdown(targetTimestamp) {
  // Clear any existing interval
  if (scheduleCountdownInterval) {
    clearInterval(scheduleCountdownInterval);
  }

  function updateCountdown() {
    const now = Date.now();
    const remaining = Math.max(0, targetTimestamp - now);

    if (remaining <= 0) {
      // Time's up! Reload the page to show unblock methods
      clearInterval(scheduleCountdownInterval);
      location.reload();
      return;
    }

    const totalSeconds = Math.floor(remaining / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    document.getElementById('countdown-hours').textContent = hours.toString().padStart(2, '0');
    document.getElementById('countdown-minutes').textContent = minutes.toString().padStart(2, '0');
    document.getElementById('countdown-seconds').textContent = seconds.toString().padStart(2, '0');
  }

  // Update immediately, then every second
  updateCountdown();
  scheduleCountdownInterval = setInterval(updateCountdown, 1000);
}

/**
 * Format time from 24h to 12h format
 */
function formatTime(time) {
  const [hours, minutes] = time.split(':').map(Number);
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
}

// Timer Method - only counts when page is visible and focused
let timerRemainingSeconds = 0;
let timerTotalSeconds = 0;
let isPageVisible = !document.hidden && document.hasFocus();

function getTimerDurationSeconds(timerSettings) {
  if (!timerSettings) return 5 * 60;

  if (timerSettings.unit === 'seconds' && Number.isFinite(Number(timerSettings.value))) {
    return Math.max(1, Math.round(Number(timerSettings.value)));
  }

  if (Number.isFinite(Number(timerSettings.value))) {
    return Math.max(1, Math.round(Number(timerSettings.value) * 60));
  }

  if (Number.isFinite(Number(timerSettings.minutes))) {
    return Math.max(1, Math.round(Number(timerSettings.minutes) * 60));
  }

  return 5 * 60;
}

function startTimer(totalSeconds) {
  timerTotalSeconds = totalSeconds;
  timerRemainingSeconds = timerTotalSeconds;

  // Initialize progress bar to 0% width (shows empty track)
  document.getElementById('timer-progress').style.width = '0%';

  // Listen for visibility changes (tab switches)
  document.addEventListener('visibilitychange', handleVisibilityChange);
  // Listen for window focus/blur (app switches, minimizing, etc.)
  window.addEventListener('blur', handleWindowBlur);
  window.addEventListener('focus', handleWindowFocus);

  updateTimerDisplay();
  timerInterval = setInterval(timerTick, 1000);
}

function updatePageVisible(visible) {
  isPageVisible = visible;

  // Update the timer hint when visibility changes
  const timerMethod = document.getElementById('method-timer');
  const existingPausedHint = timerMethod.querySelector('.timer-paused-hint');

  if (!isPageVisible && !completedMethods.timer) {
    // Show paused indicator
    if (!existingPausedHint) {
      const hint = document.createElement('div');
      hint.className = 'timer-paused-hint';
      hint.textContent = 'Timer paused - switch back to continue';
      timerMethod.querySelector('.method-content').appendChild(hint);
    }
  } else {
    // Remove paused indicator
    if (existingPausedHint) {
      existingPausedHint.remove();
    }
  }
}

function handleVisibilityChange() {
  updatePageVisible(!document.hidden && document.hasFocus());
}

function handleWindowBlur() {
  updatePageVisible(false);
}

function handleWindowFocus() {
  // Only mark visible if the document itself isn't hidden (e.g. tab is active)
  if (!document.hidden) {
    updatePageVisible(true);
  }
}

function timerTick() {
  // Only count down if page is visible
  if (isPageVisible && timerRemainingSeconds > 0) {
    timerRemainingSeconds--;
    updateTimerDisplay();
  }
}

function updateTimerDisplay() {
  const mins = Math.floor(timerRemainingSeconds / 60);
  const secs = timerRemainingSeconds % 60;

  document.getElementById('timer-minutes').textContent = mins.toString().padStart(2, '0');
  document.getElementById('timer-seconds').textContent = secs.toString().padStart(2, '0');

  // Update progress bar
  const elapsed = timerTotalSeconds - timerRemainingSeconds;
  const progress = (elapsed / timerTotalSeconds) * 100;
  document.getElementById('timer-progress').style.width = `${progress}%`;

  // Check if timer completed
  if (timerRemainingSeconds <= 0) {
    clearInterval(timerInterval);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('blur', handleWindowBlur);
    window.removeEventListener('focus', handleWindowFocus);
    completedMethods.timer = true;
    updateMethodStatus('method-timer', 'timer-status', true);
    checkUnblockReady();
  }
}

// Math Problem Method
function generateMathProblem() {
  const operations = ['+', '-', '*'];
  const op = operations[Math.floor(Math.random() * operations.length)];

  let a, b, answer;

  switch (op) {
    case '+':
      a = Math.floor(Math.random() * 50) + 10;
      b = Math.floor(Math.random() * 50) + 10;
      answer = a + b;
      break;
    case '-':
      a = Math.floor(Math.random() * 50) + 30;
      b = Math.floor(Math.random() * 30) + 1;
      answer = a - b;
      break;
    case '*':
      a = Math.floor(Math.random() * 12) + 2;
      b = Math.floor(Math.random() * 12) + 2;
      answer = a * b;
      break;
  }

  mathProblem = { a, b, op, answer };
  document.getElementById('math-problem').textContent = `${a} ${op} ${b} = ?`;
  document.getElementById('math-input').value = '';
  document.getElementById('math-input').classList.remove('success', 'error');
}

// Random Phrase Generation
function generateRandomPhrase(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';

  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  currentRandomPhrase = result;
  document.getElementById('required-phrase').textContent = result;
  document.getElementById('phrase-input').value = '';
  document.getElementById('phrase-input').classList.remove('success', 'error');

  // Reset completion state
  completedMethods.typePhrase = false;
  updateMethodStatus('method-phrase', 'phrase-status', false);
  checkUnblockReady();
}

// Update method status
function updateMethodStatus(methodId, statusId, isComplete) {
  const methodEl = document.getElementById(methodId);
  const statusEl = document.getElementById(statusId);

  if (isComplete) {
    methodEl.classList.add('completed');
    statusEl.textContent = 'Completed';
    statusEl.classList.add('success');
  } else {
    methodEl.classList.remove('completed');
    statusEl.textContent = '';
    statusEl.classList.remove('success');
  }
}

// Track if unblock is already enabled to avoid redundant checks
let unblockEnabled = false;

// Check if unblock is ready
function checkUnblockReady() {
  // If already enabled, no need to check again
  if (unblockEnabled) {
    return;
  }

  const methods = settings.unblockMethods;
  const enabledMethods = [];

  if (methods.timer.enabled) enabledMethods.push('timer');
  if (methods.completeTodo.enabled) enabledMethods.push('completeTodo');
  if (methods.typePhrase.enabled) enabledMethods.push('typePhrase');
  if (methods.typeReason?.enabled) enabledMethods.push('typeReason');
  if (methods.mathProblem.enabled) enabledMethods.push('mathProblem');
  if (methods.password.enabled) enabledMethods.push('password');

  // If no methods enabled, allow unblock
  if (enabledMethods.length === 0) {
    enableUnblock();
    return;
  }

  let isReady;

  if (settings.requireAllMethods) {
    // ALL methods must be completed
    isReady = enabledMethods.every(method => completedMethods[method]);
  } else {
    // ANY method can unlock
    isReady = enabledMethods.some(method => completedMethods[method]);
  }

  if (isReady) {
    enableUnblock();
  }
}

function enableUnblock() {
  const button = document.getElementById('unblock-button');
  const hint = document.getElementById('unblock-hint');

  unblockEnabled = true;
  button.disabled = false;
  hint.textContent = 'Select your time limit and click to continue';
}

// Get selected time limit in minutes (0 = unlimited)
function getSelectedTimeLimit() {
  const selectedBtn = document.querySelector('.time-btn.selected');
  const customInput = document.getElementById('custom-time');

  if (customInput.value && parseFloat(customInput.value) > 0) {
    return parseFloat(customInput.value);
  }

  if (selectedBtn) {
    return parseFloat(selectedBtn.dataset.minutes);
  }

  return 30; // Default 30 minutes
}

// =============================================================================
// EVENT LISTENERS
// =============================================================================

function setupEventListeners() {
  // Auth button
  document.getElementById('auth-button').addEventListener('click', async () => {
    try {
      await todoist.authenticate();
      showTodosSection();
      loadTodos();
    } catch (error) {
      console.error('Authentication failed:', error);
    }
  });

  // Open options links
  document.getElementById('open-options')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('open-options-unblock')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('settings-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Refresh todos
  document.getElementById('refresh-todos').addEventListener('click', loadTodos);

  // Retry button
  document.getElementById('retry-button').addEventListener('click', loadTodos);

  // Go back
  document.getElementById('go-back').addEventListener('click', (e) => {
    e.preventDefault();
    history.back();
  });

  // Time limit buttons
  document.querySelectorAll('.time-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Deselect all buttons
      document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('selected'));
      // Select clicked button
      btn.classList.add('selected');
      // Clear custom input
      document.getElementById('custom-time').value = '';
    });
  });

  // Custom time input
  document.getElementById('custom-time').addEventListener('input', () => {
    // Deselect preset buttons when custom is being used
    document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('selected'));
    // Update availability indicator for custom input
    updateCustomTimeAvailability();
  });

  // Type phrase input
  const phraseInput = document.getElementById('phrase-input');
  preventBulkTextEntry(phraseInput);
  phraseInput.addEventListener('input', () => {
    // Get required phrase (either custom phrase or random string)
    const phraseSettings = settings.unblockMethods.typePhrase;
    const useRandomString = phraseSettings.useRandomString;

    // For random strings, comparison is case-sensitive; for custom phrases, case-insensitive
    const required = useRandomString ? currentRandomPhrase : phraseSettings.phrase.toLowerCase();
    const typed = useRandomString ? phraseInput.value : phraseInput.value.toLowerCase();

    if (typed === required) {
      phraseInput.classList.remove('error');
      phraseInput.classList.add('success');
      completedMethods.typePhrase = true;
      updateMethodStatus('method-phrase', 'phrase-status', true);
      checkUnblockReady();
    } else {
      phraseInput.classList.remove('success');
      if (phraseInput.value.length > 0 && !required.startsWith(typed)) {
        phraseInput.classList.add('error');
      } else {
        phraseInput.classList.remove('error');
      }
    }
  });

  // Math input
  const mathInput = document.getElementById('math-input');
  preventBulkTextEntry(mathInput);
  mathInput.addEventListener('input', () => {
    const answer = parseInt(mathInput.value, 10);

    if (answer === mathProblem.answer) {
      mathInput.classList.remove('error');
      mathInput.classList.add('success');
      completedMethods.mathProblem = true;
      updateMethodStatus('method-math', 'math-status', true);
      checkUnblockReady();
    } else if (mathInput.value.length > 0) {
      mathInput.classList.remove('success');
      // Only show error if the partial number can't possibly be correct
      const answerStr = mathProblem.answer.toString();
      if (!answerStr.startsWith(mathInput.value) && mathInput.value.length >= answerStr.length) {
        mathInput.classList.add('error');
      } else {
        mathInput.classList.remove('error');
      }
    }
  });

  // New math problem button
  document.getElementById('new-math').addEventListener('click', () => {
    completedMethods.mathProblem = false;
    updateMethodStatus('method-math', 'math-status', false);
    generateMathProblem();
    checkUnblockReady();
  });

  // New random phrase button
  document.getElementById('new-phrase').addEventListener('click', () => {
    const length = settings.unblockMethods.typePhrase.randomLength || 30;
    generateRandomPhrase(length);
  });

  // Password input
  const passwordInput = document.getElementById('password-input');
  preventBulkTextEntry(passwordInput);
  passwordInput.addEventListener('input', () => {
    const correct = settings.unblockMethods.password.value;
    const entered = passwordInput.value;

    if (entered === correct) {
      passwordInput.classList.remove('error');
      passwordInput.classList.add('success');
      completedMethods.password = true;
      updateMethodStatus('method-password', 'password-status', true);
      checkUnblockReady();
    } else {
      passwordInput.classList.remove('success');
    }
  });

  // Reason textarea input
  const reasonInput = document.getElementById('reason-input');
  const reasonCharCount = document.getElementById('reason-char-count');
  const reasonValidationMessage = document.getElementById('reason-validation-message');

  preventBulkTextEntry(reasonInput);
  reasonInput.addEventListener('input', () => {
    const text = reasonInput.value;
    const charCount = text.length;
    const minLength = settings.unblockMethods.typeReason?.minLength || 50;
    const validation = getReasonValidation(text, minLength);

    // Update character counter
    reasonCharCount.textContent = charCount;

    // Store the reason
    currentReason = text;

    reasonValidationMessage.textContent = validation.message;
    reasonValidationMessage.classList.toggle('error', !validation.isValid && charCount > 0);
    reasonValidationMessage.classList.toggle('success', validation.isValid);

    if (validation.isValid) {
      reasonInput.classList.remove('error');
      reasonInput.classList.add('success');
      completedMethods.typeReason = true;
      updateMethodStatus('method-reason', 'reason-status', true);
      checkUnblockReady();
    } else {
      reasonInput.classList.remove('success');
      if (charCount > 0) {
        reasonInput.classList.add('error');
      } else {
        reasonInput.classList.remove('error');
        reasonValidationMessage.classList.remove('error', 'success');
        reasonValidationMessage.textContent = `Write at least ${minLength} characters and use real words.`;
      }
      completedMethods.typeReason = false;
      updateMethodStatus('method-reason', 'reason-status', false);
    }
  });

  // Unblock button
  const unblockButton = document.getElementById('unblock-button');
  unblockButton.addEventListener('click', async () => {
    // Prevent double-clicks
    if (unblockButton.dataset.navigating === 'true') return;
    unblockButton.dataset.navigating = 'true';
    unblockButton.textContent = 'Redirecting...';

    // Get the selected time limit
    const minutes = getSelectedTimeLimit();

    try {
      // Save reason if typeReason method is enabled and completed
      if (settings.unblockMethods.typeReason?.enabled && completedMethods.typeReason && currentReason) {
        await chrome.runtime.sendMessage({
          type: 'SAVE_UNBLOCK_REASON',
          domain: blockedDomain,
          reason: currentReason
        });
      }

      const result = await chrome.runtime.sendMessage({
        type: 'TEMPORARY_UNBLOCK',
        site: blockedDomain,
        minutes: minutes
      });

      // Check if unblock was rejected due to daily limit
      if (result && result.error === 'daily_limit_exceeded') {
        unblockButton.dataset.navigating = 'false';
        unblockButton.textContent = 'Continue to Site';
        await showDailyLimitExceeded();
        return;
      }

      // Check if unblock was rejected due to nuclear mode
      if (result && result.error === 'nuclear_mode_active') {
        unblockButton.dataset.navigating = 'false';
        unblockButton.textContent = 'Continue to Site';
        const nuclearStatus = await chrome.runtime.sendMessage({ type: 'GET_NUCLEAR_STATUS' });
        await showNuclearModeActive(nuclearStatus);
        return;
      }

      // Check if unblock was rejected due to insufficient earned time
      if (result && result.error === 'insufficient_earned_time') {
        unblockButton.dataset.navigating = 'false';
        unblockButton.textContent = 'Continue to Site';
        await showInsufficientEarnedTime();
        return;
      }

      // Small delay to ensure rules are updated before navigation
      await new Promise(resolve => setTimeout(resolve, 200));

      // Navigate to the original URL (full URL if available, otherwise just domain)
      const targetUrl = originalUrl.startsWith('http')
        ? originalUrl
        : `https://${blockedDomain}`;
      window.location.href = targetUrl;
    } catch (error) {
      console.error('Failed to unblock:', error);
      unblockButton.dataset.navigating = 'false';
      unblockButton.textContent = 'Continue to Site';
    }
  });
}
