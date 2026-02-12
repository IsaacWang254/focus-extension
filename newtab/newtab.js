/**
 * New Tab Page
 * Shows clock, greeting, motivational quote, Google Calendar events, and Todoist tasks
 */

import * as todoist from '../lib/todoist.js';
import { getDailyQuote } from './quotes.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const INITIAL_TASK_COUNT = 8;
const EXPANDED_TASK_COUNT = 20;

const WEATHER_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

const DEFAULTS = {
  newtabShowWeather: true,
  newtabShowQuotes: true,
  newtabShowCalendar: true,
  newtabShowTodos: true,
  newtabBgColor: 'default',
};

// =============================================================================
// STATE
// =============================================================================

let allTasks = [];
let tasksExpanded = false;
let completedToday = [];

// =============================================================================
// THEME (same pattern as blocked.js / options.js)
// =============================================================================

async function loadTheme() {
  const result = await chrome.storage.local.get('theme');
  let theme = result.theme;
  if (!theme) {
    theme = 'light';
    await chrome.storage.local.set({ theme: 'light' });
  }
  document.documentElement.setAttribute('data-theme', theme);
}

function setupThemeToggle() {
  const toggle = document.getElementById('theme-toggle');
  toggle.addEventListener('click', async () => {
    const root = document.documentElement;
    const currentTheme = root.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', newTheme);
    await chrome.storage.local.set({ theme: newTheme });
  });
}

// =============================================================================
// ICONS
// =============================================================================

function setupIcons() {
  document.getElementById('theme-icon-light').innerHTML = Icons.sun;
  document.getElementById('theme-icon-dark').innerHTML = Icons.moon;
  document.getElementById('settings-icon').innerHTML = Icons.settings;
  document.getElementById('calendar-icon').innerHTML = Icons.calendar;
  document.getElementById('todos-icon').innerHTML = Icons.list;
  document.getElementById('completed-icon').innerHTML = Icons.checkCircle;
}

// =============================================================================
// CLOCK & GREETING
// =============================================================================

function updateClock() {
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  document.getElementById('clock').textContent = `${hours}:${minutes}`;
}

function updateGreeting() {
  const hour = new Date().getHours();
  let greeting;
  if (hour < 12) {
    greeting = 'Good morning';
  } else if (hour < 18) {
    greeting = 'Good afternoon';
  } else {
    greeting = 'Good evening';
  }
  document.getElementById('greeting').textContent = greeting;
}

function startClock() {
  updateClock();
  updateGreeting();
  updateDate();
  // Update every second for the clock
  setInterval(updateClock, 1000);
  // Update greeting every minute (in case hour changes)
  setInterval(updateGreeting, 60000);
}

function updateDate() {
  const now = new Date();
  const formatted = now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  document.getElementById('calendar-date').textContent = formatted;
}

// =============================================================================
// QUOTES
// =============================================================================

function loadQuote() {
  const quote = getDailyQuote();
  document.getElementById('quote-text').textContent = quote.text;
  document.getElementById('quote-author').textContent = quote.author;
}

// =============================================================================
// WEATHER
// =============================================================================

/**
 * WMO Weather Code → icon key + description
 * Uses is_day to distinguish sun/moon variants
 */
function getWeatherInfo(code, isDay) {
  const map = {
    0:  { icon: isDay ? 'sun' : 'moon', desc: 'Clear' },
    1:  { icon: isDay ? 'partlyCloudy' : 'moon', desc: 'Mostly clear' },
    2:  { icon: 'partlyCloudy', desc: 'Partly cloudy' },
    3:  { icon: 'cloud', desc: 'Overcast' },
    45: { icon: 'cloudFog', desc: 'Fog' },
    48: { icon: 'cloudFog', desc: 'Rime fog' },
    51: { icon: 'cloudRain', desc: 'Light drizzle' },
    53: { icon: 'cloudRain', desc: 'Drizzle' },
    55: { icon: 'cloudRain', desc: 'Heavy drizzle' },
    61: { icon: 'cloudRain', desc: 'Light rain' },
    63: { icon: 'cloudRain', desc: 'Rain' },
    65: { icon: 'cloudRain', desc: 'Heavy rain' },
    71: { icon: 'cloudSnow', desc: 'Light snow' },
    73: { icon: 'cloudSnow', desc: 'Snow' },
    75: { icon: 'cloudSnow', desc: 'Heavy snow' },
    77: { icon: 'cloudSnow', desc: 'Snow grains' },
    80: { icon: 'cloudRain', desc: 'Light showers' },
    81: { icon: 'cloudRain', desc: 'Showers' },
    82: { icon: 'cloudRain', desc: 'Heavy showers' },
    85: { icon: 'cloudSnow', desc: 'Snow showers' },
    86: { icon: 'cloudSnow', desc: 'Heavy snow showers' },
    95: { icon: 'cloudLightning', desc: 'Thunderstorm' },
    96: { icon: 'cloudLightning', desc: 'Thunderstorm w/ hail' },
    99: { icon: 'cloudLightning', desc: 'Thunderstorm w/ heavy hail' },
  };
  return map[code] || { icon: 'cloud', desc: 'Unknown' };
}

async function getCoordinates() {
  // Try cached coordinates first
  const cached = await chrome.storage.local.get(['weatherLat', 'weatherLon']);
  if (cached.weatherLat != null && cached.weatherLon != null) {
    return { lat: cached.weatherLat, lon: cached.weatherLon };
  }

  // Request geolocation
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        // Cache coordinates
        await chrome.storage.local.set({ weatherLat: lat, weatherLon: lon });
        resolve({ lat, lon });
      },
      (err) => {
        reject(new Error(err.code === 1 ? 'Location permission denied' : 'Unable to get location'));
      },
      { timeout: 10000, maximumAge: 300000 }
    );
  });
}

async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather API error: ${res.status}`);
  return res.json();
}

async function loadWeather() {
  const loadingEl = document.getElementById('weather-loading');
  const contentEl = document.getElementById('weather-content');
  const errorEl = document.getElementById('weather-error');
  const errorTextEl = document.getElementById('weather-error-text');

  try {
    // Check cache first
    const cache = await chrome.storage.local.get(['weatherCache', 'weatherCacheTime']);
    const now = Date.now();

    let data;
    if (cache.weatherCache && cache.weatherCacheTime && (now - cache.weatherCacheTime < WEATHER_CACHE_TTL)) {
      data = cache.weatherCache;
    } else {
      const coords = await getCoordinates();
      data = await fetchWeather(coords.lat, coords.lon);

      // Cache the result
      await chrome.storage.local.set({
        weatherCache: data,
        weatherCacheTime: now,
      });
    }

    // Parse data
    const current = data.current;
    const daily = data.daily;
    const temp = Math.round(current.temperature_2m);
    const weatherCode = current.weather_code;
    const isDay = current.is_day === 1;
    const high = Math.round(daily.temperature_2m_max[0]);
    const low = Math.round(daily.temperature_2m_min[0]);
    const info = getWeatherInfo(weatherCode, isDay);

    // Render
    const iconHtml = Icons[info.icon] || Icons.cloud;
    document.getElementById('weather-icon').innerHTML = iconHtml;
    document.getElementById('weather-temp').textContent = `${temp}°`;
    document.getElementById('weather-desc').textContent = info.desc;
    document.getElementById('weather-highlow').textContent = `H:${high}° L:${low}°`;

    loadingEl.classList.add('hidden');
    contentEl.classList.remove('hidden');
  } catch (err) {
    console.error('Failed to load weather:', err);
    loadingEl.classList.add('hidden');
    errorEl.classList.remove('hidden');
    errorTextEl.textContent = err.message === 'Location permission denied'
      ? 'Enable location to see weather'
      : 'Weather unavailable';
  }
}

// =============================================================================
// SETTINGS
// =============================================================================

async function loadSettings() {
  const result = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const settings = { ...DEFAULTS, ...result };

  // Apply toggle states
  document.getElementById('toggle-weather').checked = settings.newtabShowWeather;
  document.getElementById('toggle-quotes').checked = settings.newtabShowQuotes;
  document.getElementById('toggle-calendar').checked = settings.newtabShowCalendar;
  document.getElementById('toggle-todos').checked = settings.newtabShowTodos;

  // Apply visibility
  applyVisibility(settings);

  // Apply background color
  applyBgColor(settings.newtabBgColor);
  setSwatchSelected(settings.newtabBgColor);
}

function applyVisibility(settings) {
  const weatherSection = document.getElementById('weather-section');
  const quoteSection = document.getElementById('quote-section');
  const calendarPanel = document.getElementById('calendar-panel');
  const todosPanel = document.getElementById('todos-panel');
  const completedPanel = document.getElementById('completed-panel');
  const contentPanels = document.getElementById('content-panels');

  weatherSection.classList.toggle('hidden', !settings.newtabShowWeather);
  quoteSection.classList.toggle('hidden', !settings.newtabShowQuotes);
  calendarPanel.classList.toggle('hidden', !settings.newtabShowCalendar);
  todosPanel.classList.toggle('hidden', !settings.newtabShowTodos);

  // Completed panel is tied to the todos toggle
  completedPanel.classList.toggle('hidden', !settings.newtabShowTodos);

  // Hide the content-panels container if all panels are hidden
  const allHidden = !settings.newtabShowCalendar && !settings.newtabShowTodos;
  contentPanels.classList.toggle('hidden', allHidden);
}

function setupSettings() {
  const settingsBtn = document.getElementById('settings-btn');
  const dropdown = document.getElementById('settings-dropdown');
  const menu = document.getElementById('settings-menu');

  // Toggle dropdown
  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });

  // Close on click outside
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target)) {
      dropdown.classList.remove('open');
    }
  });

  // Prevent dropdown close when clicking inside menu
  menu.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  // Setting toggles
  const toggles = [
    { id: 'toggle-weather', key: 'newtabShowWeather' },
    { id: 'toggle-quotes', key: 'newtabShowQuotes' },
    { id: 'toggle-calendar', key: 'newtabShowCalendar' },
    { id: 'toggle-todos', key: 'newtabShowTodos' },
  ];

  for (const { id, key } of toggles) {
    document.getElementById(id).addEventListener('change', async (e) => {
      const value = e.target.checked;
      await chrome.storage.local.set({ [key]: value });

      // Read all settings to apply visibility correctly
      const result = await chrome.storage.local.get(Object.keys(DEFAULTS));
      const settings = { ...DEFAULTS, ...result };
      applyVisibility(settings);
    });
  }

  // Background color swatches
  setupBgColorPicker();
}

// =============================================================================
// BACKGROUND COLOR
// =============================================================================

function applyBgColor(color) {
  if (color === 'default') {
    document.body.style.backgroundColor = '';
  } else {
    document.body.style.backgroundColor = color;
  }
}

function setSwatchSelected(color) {
  const swatches = document.querySelectorAll('.color-swatch');
  swatches.forEach(s => s.classList.remove('selected'));

  // Find matching preset swatch
  const match = document.querySelector(`.color-swatch[data-color="${color}"]`);
  if (match) {
    match.classList.add('selected');
  } else if (color !== 'default') {
    // Custom color — select the custom swatch and update its input
    const customSwatch = document.querySelector('.swatch-custom');
    customSwatch.classList.add('selected');
    document.getElementById('custom-color-input').value = color;
  }
}

function setupBgColorPicker() {
  const swatchContainer = document.getElementById('color-swatches');
  const customInput = document.getElementById('custom-color-input');

  // Click on preset swatches
  swatchContainer.addEventListener('click', async (e) => {
    const swatch = e.target.closest('.color-swatch:not(.swatch-custom)');
    if (!swatch) return;

    const color = swatch.dataset.color;
    await chrome.storage.local.set({ newtabBgColor: color });
    applyBgColor(color);
    setSwatchSelected(color);
  });

  // Custom color input
  customInput.addEventListener('input', async (e) => {
    const color = e.target.value;
    await chrome.storage.local.set({ newtabBgColor: color });
    applyBgColor(color);
    setSwatchSelected(color);
  });
}

// =============================================================================
// GOOGLE CALENDAR
// =============================================================================

async function loadCalendar() {
  const connectEl = document.getElementById('calendar-connect');
  const loadingEl = document.getElementById('calendar-loading');
  const emptyEl = document.getElementById('calendar-empty');
  const listEl = document.getElementById('event-list');

  try {
    // Check if calendar is connected
    const status = await chrome.runtime.sendMessage({ type: 'GET_CALENDAR_STATUS' });

    if (!status || !status.connected) {
      connectEl.classList.remove('hidden');
      loadingEl.classList.add('hidden');
      return;
    }

    // Connected — hide prompt, show loading
    connectEl.classList.add('hidden');
    loadingEl.classList.remove('hidden');

    // Fetch today's events
    const events = await chrome.runtime.sendMessage({ type: 'GET_TODAY_EVENTS' });

    loadingEl.classList.add('hidden');

    if (!events || events.length === 0) {
      emptyEl.classList.remove('hidden');
      return;
    }

    renderEvents(events, listEl);
  } catch (err) {
    console.error('Failed to load calendar:', err);
    loadingEl.classList.add('hidden');
    emptyEl.classList.remove('hidden');
  }
}

function renderEvents(events, listEl) {
  const now = new Date();

  // Separate all-day and timed events
  const allDayEvents = events.filter(e => e.isAllDay);
  const timedEvents = events.filter(e => !e.isAllDay);

  // Sort timed events by start time
  timedEvents.sort((a, b) => new Date(a.start) - new Date(b.start));

  listEl.innerHTML = '';

  // Render all-day events first
  for (const event of allDayEvents) {
    const li = createEventItem(event, now, true);
    listEl.appendChild(li);
  }

  // Render timed events
  for (const event of timedEvents) {
    const li = createEventItem(event, now, false);
    listEl.appendChild(li);
  }
}

function createEventItem(event, now, isAllDay) {
  const li = document.createElement('li');
  li.className = 'event-item';

  // Check if current event
  if (!isAllDay) {
    const start = new Date(event.start);
    const end = new Date(event.end);
    if (now >= start && now < end) {
      li.classList.add('event-current');
    }
  }

  // Color dot
  const dot = document.createElement('span');
  dot.className = 'event-color-dot';
  dot.style.backgroundColor = event.color || 'var(--indigo)';
  li.appendChild(dot);

  // Details
  const details = document.createElement('div');
  details.className = 'event-details';

  const title = document.createElement('div');
  title.className = 'event-title';
  title.textContent = event.title;
  details.appendChild(title);

  if (isAllDay) {
    const badge = document.createElement('span');
    badge.className = 'event-allday';
    badge.textContent = 'All day';
    details.appendChild(badge);
  } else {
    const time = document.createElement('div');
    time.className = 'event-time';
    const startTime = formatTime(new Date(event.start));
    const endTime = formatTime(new Date(event.end));
    time.textContent = `${startTime} - ${endTime}`;
    details.appendChild(time);
  }

  li.appendChild(details);
  return li;
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function setupCalendarConnect() {
  const btn = document.getElementById('calendar-connect-btn');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Connecting...';
    try {
      await chrome.runtime.sendMessage({ type: 'CONNECT_GOOGLE_CALENDAR' });
      // Reload calendar section
      await loadCalendar();
    } catch (err) {
      console.error('Failed to connect calendar:', err);
      btn.disabled = false;
      btn.textContent = 'Connect Calendar';
    }
  });
}

// =============================================================================
// COMPLETED TASKS (from Todoist API)
// =============================================================================

async function fetchCompletedToday() {
  const loadingEl = document.getElementById('completed-loading');
  const emptyEl = document.getElementById('completed-empty');

  try {
    const authenticated = await todoist.isAuthenticated();
    if (!authenticated) return;

    loadingEl.classList.remove('hidden');
    emptyEl.classList.add('hidden');

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const since = startOfDay.toISOString();
    const until = now.toISOString();

    const tasks = await todoist.getCompletedTasks({ since, until, limit: 50 });
    completedToday = tasks.map(t => ({
      id: t.id || t.task_id,
      content: t.content,
    }));

    loadingEl.classList.add('hidden');
    renderCompletedSection();
  } catch (err) {
    console.error('Failed to fetch completed tasks:', err);
    loadingEl.classList.add('hidden');
    renderCompletedSection();
  }
}

function renderCompletedSection() {
  const countEl = document.getElementById('completed-count');
  const emptyEl = document.getElementById('completed-empty');
  const listEl = document.getElementById('completed-list');

  countEl.textContent = completedToday.length;

  if (completedToday.length === 0) {
    emptyEl.classList.remove('hidden');
    listEl.classList.add('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  listEl.classList.remove('hidden');

  // Render the list
  listEl.innerHTML = '';
  for (const task of completedToday) {
    const li = document.createElement('li');
    li.className = 'completed-item';

    // Checkmark circle
    const check = document.createElement('span');
    check.className = 'completed-item-check';
    check.innerHTML = Icons.check;
    li.appendChild(check);

    // Task content
    const content = document.createElement('span');
    content.className = 'completed-item-content';
    content.textContent = task.content;
    li.appendChild(content);

    listEl.appendChild(li);
  }
}

// =============================================================================
// TODOIST
// =============================================================================

async function loadTodos() {
  const connectEl = document.getElementById('todos-connect');
  const loadingEl = document.getElementById('todos-loading');
  const emptyEl = document.getElementById('todos-empty');
  const listEl = document.getElementById('todo-list');
  const showMoreBtn = document.getElementById('todos-show-more');

  try {
    // Check if authenticated
    const authenticated = await todoist.isAuthenticated();

    if (!authenticated) {
      connectEl.classList.remove('hidden');
      loadingEl.classList.add('hidden');
      return;
    }

    // Authenticated — hide prompt, show loading
    connectEl.classList.add('hidden');
    loadingEl.classList.remove('hidden');

    // Fetch tasks
    const tasks = await todoist.getTasksWithSubtasks();

    loadingEl.classList.add('hidden');

    // Sort: priority desc, then due date asc (no due = last)
    allTasks = sortTasks(tasks);

    if (allTasks.length === 0) {
      emptyEl.classList.remove('hidden');
      return;
    }

    renderTodos(listEl, showMoreBtn);
  } catch (err) {
    console.error('Failed to load todos:', err);
    loadingEl.classList.add('hidden');

    // If auth expired, show connect prompt
    if (err.message && err.message.includes('Authentication expired')) {
      connectEl.classList.remove('hidden');
    } else {
      emptyEl.classList.remove('hidden');
    }
  }
}

function sortTasks(tasks) {
  return tasks.sort((a, b) => {
    // Priority: higher first (4 = urgent, 1 = normal)
    if (b.priority !== a.priority) return b.priority - a.priority;

    // Due date: earlier first, no due date last
    const aDue = a.due ? (a.due.datetime || a.due.date) : null;
    const bDue = b.due ? (b.due.datetime || b.due.date) : null;

    if (aDue && bDue) return new Date(aDue) - new Date(bDue);
    if (aDue && !bDue) return -1;
    if (!aDue && bDue) return 1;
    return 0;
  });
}

function renderTodos(listEl, showMoreBtn) {
  const limit = tasksExpanded ? EXPANDED_TASK_COUNT : INITIAL_TASK_COUNT;
  const visibleTasks = allTasks.slice(0, limit);

  listEl.innerHTML = '';

  for (const task of visibleTasks) {
    const li = createTodoItem(task);
    listEl.appendChild(li);
  }

  // Show more button
  if (allTasks.length > INITIAL_TASK_COUNT) {
    showMoreBtn.classList.remove('hidden');
    showMoreBtn.textContent = tasksExpanded
      ? `Show less`
      : `Show more (${allTasks.length - INITIAL_TASK_COUNT} more)`;
  } else {
    showMoreBtn.classList.add('hidden');
  }
}

function createTodoItem(task) {
  const li = document.createElement('li');
  li.className = 'todo-item';
  li.dataset.taskId = task.id;

  // Checkbox
  const checkbox = document.createElement('button');
  checkbox.className = `todo-checkbox ${todoist.getPriorityClass(task.priority)}`;
  checkbox.title = 'Complete task';
  checkbox.addEventListener('click', () => completeTask(task.id, li, checkbox));
  li.appendChild(checkbox);

  // Details
  const details = document.createElement('div');
  details.className = 'todo-details';

  const content = document.createElement('div');
  content.className = 'todo-content';
  content.textContent = task.content;
  details.appendChild(content);

  // Meta (due date)
  const dueStr = todoist.formatDueDate(task);
  if (dueStr) {
    const meta = document.createElement('div');
    meta.className = 'todo-meta';

    const due = document.createElement('span');
    due.className = 'todo-due';
    due.textContent = dueStr;

    if (dueStr === 'Overdue') due.classList.add('overdue');
    if (dueStr === 'Today' || dueStr.startsWith('Today')) due.classList.add('today');

    meta.appendChild(due);
    details.appendChild(meta);
  }

  li.appendChild(details);
  return li;
}

async function completeTask(taskId, li, checkbox) {
  // Prevent double-click
  if (checkbox.classList.contains('checked')) return;

  checkbox.classList.add('checked');

  try {
    await todoist.completeTask(taskId);

    // Re-fetch completed tasks from Todoist API
    fetchCompletedToday();

    // Animate removal
    li.classList.add('completing');
    setTimeout(() => {
      // Remove from allTasks
      allTasks = allTasks.filter(t => t.id !== taskId);

      // Re-render
      const listEl = document.getElementById('todo-list');
      const showMoreBtn = document.getElementById('todos-show-more');
      renderTodos(listEl, showMoreBtn);

      // Show empty state if needed
      if (allTasks.length === 0) {
        document.getElementById('todos-empty').classList.remove('hidden');
      }
    }, 300);
  } catch (err) {
    console.error('Failed to complete task:', err);
    checkbox.classList.remove('checked');
  }
}

function setupTodosConnect() {
  const btn = document.getElementById('todos-connect-btn');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Connecting...';
    try {
      await todoist.authenticate();
      // Reload todos section
      await loadTodos();
    } catch (err) {
      console.error('Failed to connect Todoist:', err);
      btn.disabled = false;
      btn.textContent = 'Connect Todoist';
    }
  });
}

function setupShowMore() {
  const btn = document.getElementById('todos-show-more');
  btn.addEventListener('click', () => {
    tasksExpanded = !tasksExpanded;
    const listEl = document.getElementById('todo-list');
    renderTodos(listEl, btn);
  });
}

// =============================================================================
// INIT
// =============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  // Load theme first to avoid flash
  await loadTheme();

  // Setup icons
  setupIcons();

  // Setup interactions
  setupThemeToggle();
  setupSettings();
  setupCalendarConnect();
  setupTodosConnect();
  setupShowMore();

  // Start clock
  startClock();

  // Load quote
  loadQuote();

  // Load settings and apply visibility
  await loadSettings();

  // Load data (in parallel)
  loadCalendar();
  loadTodos();
  loadWeather();
  fetchCompletedToday();
});
