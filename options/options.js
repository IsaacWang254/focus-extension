/**
 * Settings — vanilla page for the stripped-down extension.
 * Sections: Todoist, Google Calendar, New tab, Appearance.
 * Every change autosaves to chrome.storage.local; the new tab picks it up
 * through its storage.onChanged listener.
 */

import { loadTheme, isThemeSyncEnabled, setupBrowserThemeSyncListener } from '../lib/theme.js';
import * as todoist from '../lib/todoist.js';

const sendMessage = (message) => chrome.runtime.sendMessage(message);
const el = (id) => document.getElementById(id);

let settings = {};

// ---------------------------------------------------------------------------
// Autosave status ("Saved" next to each section label, aria-live polite)
// ---------------------------------------------------------------------------

const savedTimers = {};
function markSaved(id) {
  const node = el(id);
  if (!node) return;
  node.textContent = 'Saved';
  clearTimeout(savedTimers[id]);
  savedTimers[id] = setTimeout(() => { node.textContent = ''; }, 1500);
}

// ---------------------------------------------------------------------------
// New-tab settings — mirrored into the `settings` object (read by the new tab
// via GET_SETTINGS) and to top-level keys (read by weather + the visibility
// storage listener).
// ---------------------------------------------------------------------------

const NEWTAB_KEYS = ['newtabShowTodos', 'newtabShowCalendar', 'newtabShowWeather', 'newtabTempUnit'];

async function saveNewtabSettings(patch) {
  settings = { ...settings, ...patch };
  const topLevel = {};
  for (const key of NEWTAB_KEYS) {
    if (key in patch) topLevel[key] = patch[key];
  }
  await chrome.storage.local.set({ settings, ...topLevel });
  markSaved('newtab-saved');
}

function bindSwitch(id, key) {
  el(id).addEventListener('change', async (event) => {
    await saveNewtabSettings({ [key]: event.target.checked });
  });
}

async function initNewtabSection() {
  const stored = await chrome.storage.local.get('settings');
  settings = stored.settings || {};
  el('show-tasks').checked = settings.newtabShowTodos !== false;
  el('show-calendar').checked = settings.newtabShowCalendar !== false;
  el('show-weather').checked = settings.newtabShowWeather !== false;

  bindSwitch('show-tasks', 'newtabShowTodos');
  bindSwitch('show-calendar', 'newtabShowCalendar');
  bindSwitch('show-weather', 'newtabShowWeather');

  setSegment('temp', settings.newtabTempUnit === 'F' ? 'F' : 'C');
  document.querySelectorAll('.seg-btn[data-unit]').forEach((button) => {
    button.addEventListener('click', () => {
      setSegment('temp', button.dataset.unit);
      saveNewtabSettings({ newtabTempUnit: button.dataset.unit });
    });
  });
}

function setSegment(kind, value) {
  const selector = kind === 'temp' ? '.seg-btn[data-unit]' : '.seg-btn[data-theme-option]';
  const attr = kind === 'temp' ? 'unit' : 'themeOption';
  document.querySelectorAll(selector).forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset[attr] === value));
  });
}

// ---------------------------------------------------------------------------
// Appearance — System maps to themeSyncWithBrowser; Light/Dark set `theme`.
// ---------------------------------------------------------------------------

async function initAppearance() {
  const stored = await chrome.storage.local.get(['theme', 'themeSyncWithBrowser']);
  const sync = isThemeSyncEnabled(stored.themeSyncWithBrowser);
  setSegment('theme', sync ? 'system' : (stored.theme === 'dark' ? 'dark' : 'light'));

  document.querySelectorAll('.seg-btn[data-theme-option]').forEach((button) => {
    button.addEventListener('click', async () => {
      const choice = button.dataset.themeOption;
      setSegment('theme', choice);
      if (choice === 'system') {
        await chrome.storage.local.set({ themeSyncWithBrowser: true });
      } else {
        await chrome.storage.local.set({ themeSyncWithBrowser: false, theme: choice });
      }
      await loadTheme();
      markSaved('appearance-saved');
    });
  });
}

// ---------------------------------------------------------------------------
// Todoist
// ---------------------------------------------------------------------------

function renderTodoist(connected) {
  const status = el('todoist-status');
  status.textContent = connected ? 'Connected' : 'Not connected';
  status.classList.toggle('is-connected', connected);
  el('todoist-btn').textContent = connected ? 'Disconnect' : 'Connect';
}

async function initTodoist() {
  renderTodoist(await todoist.isAuthenticated());
  el('todoist-btn').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      if (await todoist.isAuthenticated()) {
        await todoist.logout();
        renderTodoist(false);
      } else {
        await todoist.authenticate();
        renderTodoist(true);
      }
      markSaved('todoist-saved');
    } catch (error) {
      console.error('Todoist connection change failed:', error);
      renderTodoist(await todoist.isAuthenticated());
    } finally {
      button.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
// Google Calendar
// ---------------------------------------------------------------------------

function renderCalendar(connected, email) {
  const status = el('calendar-status');
  status.textContent = connected ? `Connected${email ? ` — ${email}` : ''}` : 'Not connected';
  status.classList.toggle('is-connected', connected);
  el('calendar-btn').textContent = connected ? 'Disconnect' : 'Connect';
  el('calendar-list').hidden = !connected;
}

async function renderCalendarList(selectedCalendars) {
  const list = await sendMessage({ type: 'GET_CALENDAR_LIST' });
  const container = el('calendar-list-items');
  container.replaceChildren();
  if (!Array.isArray(list) || !list.length) return;

  const selected = new Set(selectedCalendars || []);
  for (const cal of list) {
    const label = document.createElement('label');
    label.className = 'st-cal';
    const dot = document.createElement('span');
    dot.className = 'st-cal-dot';
    dot.style.background = cal.color || 'var(--nt-rule)';
    const name = document.createElement('span');
    name.className = 'st-cal-name';
    name.textContent = cal.name || cal.id;
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = selected.size ? selected.has(cal.id) : true;
    box.setAttribute('aria-label', `Show ${name.textContent} on the new tab`);
    box.addEventListener('change', async () => {
      const ids = [...container.querySelectorAll('input[type="checkbox"]')]
        .map((input, index) => input.checked ? list[index].id : null)
        .filter(Boolean);
      await sendMessage({ type: 'UPDATE_CALENDAR_SETTINGS', settings: { selectedCalendars: ids } });
      markSaved('calendar-saved');
    });
    label.append(dot, name, box);
    container.append(label);
  }
}

async function refreshCalendarSection() {
  const status = await sendMessage({ type: 'GET_CALENDAR_STATUS' });
  const connected = Boolean(status?.connected);
  renderCalendar(connected, status?.email);
  if (connected) await renderCalendarList(status?.selectedCalendars);
}

async function initCalendar() {
  await refreshCalendarSection();
  el('calendar-btn').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const status = await sendMessage({ type: 'GET_CALENDAR_STATUS' });
      if (status?.connected) {
        await sendMessage({ type: 'DISCONNECT_GOOGLE_CALENDAR' });
        renderCalendar(false);
      } else {
        const result = await sendMessage({ type: 'CONNECT_GOOGLE_CALENDAR' });
        if (result?.error) throw new Error(result.error);
      }
      await refreshCalendarSection();
      markSaved('calendar-saved');
    } catch (error) {
      console.error('Calendar connection change failed:', error);
      await refreshCalendarSection();
    } finally {
      button.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  await loadTheme();
  setupBrowserThemeSyncListener();
  await Promise.all([initTodoist(), initCalendar(), initNewtabSection(), initAppearance()]);
});
