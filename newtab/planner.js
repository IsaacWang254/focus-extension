import * as todoist from '../lib/todoist.js';
import {
  flattenTasks,
  normalizeEvents,
  selectHomepageTasks,
  toLocalDateKey
} from './planner-model.js';
import { clearCurrentTaskState, loadCurrentTaskState, PLANNER_STATE_KEY, saveCurrentTaskState } from './planner-state.js';
import { createTaskRow, taskPriorityStyle } from './planner-tasks.js';
import { normalizePlannerEventsPayload } from './planner-calendar.js';
import { createPlannerCalendarData } from './planner-calendar-data.js';
import { centerTimelineOnNow, renderDayTimeline } from './planner-timeline.js';
import { setActionAvailable, setButtonPending, setIconButton } from './planner-controls.js';
import {
  buildUpdateTaskPayload,
  createLatestRequestGuard,
  describeCreatedTask,
  insertCompletion,
  matchSuggestions,
  nextCurrentTaskIdAfterCompletion,
  tokenAtCaret
} from './planner-actions.js';

let api;
let tasks = [];
let projects = new Map();
let labelsList = null;
let labelsRequest = null;
let currentTaskId = '';
let todayEvents = [];
let plannerStarted = false;
let activeDrawerTrigger = null;
let plannerScrollPosition = 0;
const taskRequestGuard = createLatestRequestGuard();
const calendarRequestGuard = createLatestRequestGuard();
const pendingTaskIds = new Set();
const CALENDAR_REFRESH_INTERVAL = 5 * 60 * 1000;
let lastCalendarAttemptAt = 0;
let lastCalendarAttemptDate = '';
let loadedCalendarDate = '';
let timelineUserAnchored = false;
let pendingTimelineRecenter = false;
let calendarData = null;
let homeTimelineScrollTop = 0;
let quickAddAutocomplete = null;

const storage = {
  get: keys => typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local.get(keys) : api.getLocal(keys),
  set: values => typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local.set(values) : api.setLocal(values),
  remove: keys => typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local.remove(keys) : api.setLocal({ [keys]: null })
};

function element(id) {
  return document.getElementById(id);
}

function setHidden(id, hidden) {
  element(id)?.classList.toggle('hidden', hidden);
}

function setAction(id, available, options) {
  const target = element(id);
  if (!target) return;
  setActionAvailable(target, available);
  if (options) setIconButton(target, options);
}

function setText(id, value) {
  const target = element(id);
  if (target) target.textContent = value;
}

function setPlannerStatus(kind, message = '') {
  setText(`${kind}-status`, message);
  setHidden(`${kind}-status`, !message);
}

// The shared per-date calendar store: the homepage reads through it so the
// 5-minute freshness gate, in-flight coalescing and scoped invalidation apply
// uniformly.
function getCalendarData() {
  if (!calendarData) {
    calendarData = createPlannerCalendarData({
      gateMs: CALENDAR_REFRESH_INTERVAL,
      now: () => Date.now(),
      send: async date => {
        const raw = await api.sendRuntimeMessage({ type: 'GET_PLANNER_EVENTS', date });
        if (raw?.error && !raw?.events?.length && !raw?.disconnected) {
          const result = normalizePlannerEventsPayload(raw, date);
          result.error = raw.error;
          result.status = raw.status ?? null;
          return result;
        }
        const result = normalizePlannerEventsPayload(raw, date);
        result.error = raw?.error ?? null;
        result.status = raw?.status ?? null;
        return result;
      }
    });
    refreshCalendarScope();
  }
  return calendarData;
}

async function refreshCalendarScope() {
  try {
    const stored = await storage.get(['calendarSettings']);
    calendarData?.setScope(calendarScopeKey(stored?.calendarSettings));
  } catch { /* scope seeding is best-effort */ }
}

function calendarScopeKey(settings) {
  const s = settings || {};
  const selected = [...(Array.isArray(s.selectedCalendars) ? s.selectedCalendars : [])].map(String).sort().join(',');
  return [s.email || '', selected, s.cacheRevision ?? '', Intl.DateTimeFormat().resolvedOptions().timeZone].join('|');
}

async function loadTaskData() {
  if (!api.isVisible('newtabShowTodos')) return;
  const requestId = taskRequestGuard.begin();
  if (!tasks.length) setPlannerStatus('tasks', 'Loading tasks…');
  try {
    const authenticated = await todoist.isAuthenticated();
    if (!taskRequestGuard.isLatest(requestId)) return;
    if (!authenticated) {
      tasks = [];
      currentTaskId = '';
      setPlannerStatus('tasks', 'Connect Todoist to plan your day.');
      setAction('todos-connect-btn', true, { icon: globalThis.Icons?.link, label: 'Connect Todoist' });
      renderTasks();
      return;
    }
    setAction('todos-connect-btn', false);
    const [loadedTasks, loadedProjects, token] = await Promise.all([
      todoist.getTasksWithSubtasks({ staleWhileRevalidate: true }),
      todoist.getProjects().catch(() => []),
      todoist.getToken()
    ]);
    if (!taskRequestGuard.isLatest(requestId)) return;
    tasks = loadedTasks;
    projects = new Map(loadedProjects.map(project => [String(project.id), project]));
    const state = await loadCurrentTaskState(storage, token);
    currentTaskId = state?.taskId || '';
    const flat = flattenTasks(tasks);
    if (currentTaskId && !flat.some(task => String(task.id) === String(currentTaskId))) {
      currentTaskId = '';
      await clearCurrentTaskState(storage);
    }
    setPlannerStatus('tasks', '');
    renderTasks();
  } catch (error) {
    if (!taskRequestGuard.isLatest(requestId)) return;
    console.error('Failed to load planner tasks:', error);
    setPlannerStatus('tasks', tasks.length ? 'Showing saved tasks.' : 'Tasks are unavailable.');
    renderTasks();
  }
}

async function loadCalendarData({ force = false, recenter = false } = {}) {
  if (!api.isVisible('newtabShowCalendar')) return;
  const today = toLocalDateKey();
  const data = getCalendarData();
  const cached = data.peek(today);
  if (!force && cached && Date.now() - cached.attemptedAt < CALENDAR_REFRESH_INTERVAL) {
    renderCalendar({ recenter });
    return;
  }
  const requestId = calendarRequestGuard.begin();
  lastCalendarAttemptAt = Date.now();
  lastCalendarAttemptDate = today;
  if (!todayEvents.length) setPlannerStatus('calendar', 'Loading schedule…');
  try {
    const status = await api.sendRuntimeMessage({ type: 'GET_CALENDAR_STATUS' });
    if (!calendarRequestGuard.isLatest(requestId)) return;
    if (!status?.connected) {
      todayEvents = [];
      loadedCalendarDate = today;
      setPlannerStatus('calendar', 'Connect Google Calendar to see today.');
      setAction('calendar-connect-btn', true, { icon: globalThis.Icons?.link, label: 'Connect Google Calendar' });
      renderCalendar({ recenter });
      return;
    }
    setAction('calendar-connect-btn', false);
    const todayPayload = await data.getDay(today, { force });
    if (!calendarRequestGuard.isLatest(requestId) || today !== toLocalDateKey()) return;
    todayEvents = normalizeEvents(todayPayload.events);
    loadedCalendarDate = today;
    if (todayPayload.disconnected) {
      setPlannerStatus('calendar', 'Your Calendar connection expired. Reconnect to refresh it.');
      setAction('calendar-connect-btn', true, { icon: globalThis.Icons?.refresh, label: 'Reconnect Google Calendar' });
      renderCalendar({ recenter });
      return;
    }
    if (todayPayload.error) {
      setPlannerStatus('calendar', todayEvents.length ? 'Showing saved schedule.' : 'Calendar is unavailable. Reload the extension and try again.');
      renderCalendar({ recenter });
      return;
    }
    setPlannerStatus('calendar', todayPayload.stale ? 'Showing saved schedule.' : todayPayload.partial ? 'Some calendars are unavailable.' : '');
    renderCalendar({ recenter });
  } catch (error) {
    if (!calendarRequestGuard.isLatest(requestId)) return;
    console.error('Failed to load planner calendar:', error);
    setPlannerStatus('calendar', todayEvents.length ? 'Showing saved schedule.' : 'Calendar is unavailable. Reload the extension and try again.');
    renderCalendar({ recenter });
  }
}

function renderTasks() {
  const now = new Date();
  const list = element('task-list');
  if (!list) return;
  const { tasks: rows, currentIsOverride } = selectHomepageTasks(tasks, currentTaskId, now);
  // Re-rendering detaches the row a just-closed modal returned focus to;
  // re-focus the same task's copy button by id afterwards.
  const focusTaskId = document.activeElement?.closest?.('#task-list .planner-task-row')?.dataset?.taskId;
  const focusWasOpen = document.activeElement?.classList?.contains('task-open');
  const focusWasVisible = focusWasOpen && document.activeElement?.matches?.(':focus-visible');
  list.innerHTML = '';
  rows.forEach((task, index) => {
    list.appendChild(createTaskRow(task, {
      projects, now,
      home: true,
      current: currentIsOverride && String(task.id) === String(currentTaskId),
      hint: index === 0 ? (currentIsOverride ? 'Current task' : 'Suggested task') : '',
      pending: pendingTaskIds.has(String(task.id)),
      onComplete: completeTask,
      onMakeCurrent: makeTaskCurrent,
      onEdit: (t, trigger, viaKeyboard) => openEditModal(t, trigger, viaKeyboard)
    }));
  });
  setHidden('task-list-empty', list.children.length > 0 || Boolean(element('tasks-status')?.textContent));
  // A storage-refresh re-render right after a save would drop the flash —
  // re-apply it while the window is open.
  if (flashState.until > Date.now() && flashState.taskId) {
    list.querySelector(`.planner-task-row[data-task-id="${CSS.escape(flashState.taskId)}"]`)
      ?.classList.add('is-flash');
  }
  if (focusWasOpen && focusTaskId && typeof document.querySelector === 'function' && globalThis.CSS?.escape) {
    const fresh = list.querySelector(`.planner-task-row[data-task-id="${CSS.escape(focusTaskId)}"] .task-open`);
    // Preserve the ring modality — a mouse-initiated save must not flash a
    // keyboard ring on the freshly rendered row.
    if (fresh) {
      try { fresh.focus({ focusVisible: focusWasVisible }); }
      catch { fresh.focus(); }
    }
  }
}

function renderCalendar({ recenter = false } = {}) {
  const viewport = element('timeline-viewport');
  const allDay = element('timeline-all-day');
  const empty = element('timeline-empty');
  const unavailable = element('timeline-unavailable');
  if (!viewport || !allDay || !empty) return;
  const result = renderDayTimeline({ viewport, allDay, empty, unavailable }, todayEvents, {
    date: loadedCalendarDate || toLocalDateKey(),
    now: new Date(),
    hasStatus: Boolean(element('calendar-status')?.textContent)
  });
  // A focused block that lost its Open link (now too small, or the event has
  // no calendar link) moves focus to the Google Calendar action.
  if (viewport.querySelector?.('[data-focus-lost]')) {
    for (const node of viewport.querySelectorAll('[data-focus-lost]')) delete node.dataset.focusLost;
    element('view-schedule-btn')?.focus?.({ preventScroll: true });
  }
  if (!result.hasEvents) {
    timelineUserAnchored = false;
  }
  if (recenter && !timelineUserAnchored) {
    const modalOpen = !element('edit-modal')?.classList.contains('hidden');
    const timelineFocused = viewport.contains(document.activeElement);
    if (modalOpen || timelineFocused) {
      pendingTimelineRecenter = true;
    } else {
      pendingTimelineRecenter = false;
      requestAnimationFrame(() => centerTimelineOnNow(viewport, result.marker));
    }
  }
  updateBackToNow();
}

// The floating Back to now button is offered only once the user has taken
// over scrolling AND the Now marker is off-canvas; its glyph points toward
// the marker. Evaluated on scroll (rAF-throttled in setupActions) and after
// every render (minute ticks move the marker too).
function updateBackToNow() {
  const viewport = element('timeline-viewport');
  const backToNow = element('back-to-now-btn');
  if (!backToNow) return;
  const marker = viewport?.querySelector?.('[data-timeline-now="true"]');
  let direction = 'up';
  let show = false;
  if (timelineUserAnchored && marker?.getBoundingClientRect && viewport?.getBoundingClientRect) {
    const vr = viewport.getBoundingClientRect();
    const mr = marker.getBoundingClientRect();
    if (mr.bottom < vr.top - 1) { show = true; direction = 'up'; }
    else if (mr.top > vr.bottom + 1) { show = true; direction = 'down'; }
  }
  if (show) {
    backToNow.dataset.direction = direction;
    setIconButton(backToNow, { icon: direction === 'up' ? globalThis.Icons?.chevronUp : globalThis.Icons?.chevronDown });
  }
  setActionAvailable(backToNow, show);
}

async function makeTaskCurrent(task) {
  const token = await todoist.getToken();
  await saveCurrentTaskState(storage, token, task.id);
  currentTaskId = String(task.id);
  renderTasks();
}

async function completeTask(task, button) {
  const taskId = String(task.id);
  if (button.disabled || pendingTaskIds.has(taskId)) return;
  pendingTaskIds.add(taskId);
  button.disabled = true;
  button.classList.add('is-pending');
  try {
    await todoist.completeTask(task.id);
    const nextCurrentTaskId = nextCurrentTaskIdAfterCompletion(currentTaskId, task.id);
    if (nextCurrentTaskId !== currentTaskId) {
      currentTaskId = nextCurrentTaskId;
      await clearCurrentTaskState(storage);
    }
    await loadTaskData();
  } catch (error) {
    console.error('Failed to complete task:', error);
    button.disabled = false;
    button.classList.remove('is-pending');
  } finally {
    pendingTaskIds.delete(taskId);
    renderTasks();
  }
}

function openOverlayScaffold() {
  activeDrawerTrigger = document.activeElement === document.body ? null : document.activeElement;
  plannerScrollPosition = window.scrollY;
  // The homepage timeline's own scroll position is preserved separately
  // from the page scroll lock and restored when the overlay closes.
  homeTimelineScrollTop = element('timeline-viewport')?.scrollTop ?? homeTimelineScrollTop;
  document.body.style.setProperty('--planner-scroll-top', `${-plannerScrollPosition}px`);
  document.body.classList.add('planner-open');
  document.documentElement.classList.add('planner-open');
}

function closeOverlayScaffold() {
  document.body.classList.remove('planner-open');
  document.documentElement.classList.remove('planner-open');
  document.body.style.removeProperty('--planner-scroll-top');
  window.scrollTo(0, plannerScrollPosition);
  const homeViewport = element('timeline-viewport');
  if (homeViewport) homeViewport.scrollTop = homeTimelineScrollTop;
}

// The modality the current overlay was opened with: pointer-opened overlays
// return focus without a :focus-visible ring; keyboard-opened ones keep it.
let overlayOpenedByKeyboard = true;

function restoreOverlayFocus() {
  // A null trigger means the overlay was opened via ⌘K with the page focused:
  // leave focus on the page rather than forcing it to a control.
  let restoreTarget = null;
  if (activeDrawerTrigger) {
    restoreTarget = activeDrawerTrigger.isConnected ? activeDrawerTrigger : null;
    if (!restoreTarget) {
      // The row re-rendered while the overlay was open (task-data refresh):
      // focus the same task's fresh row button by id, else the Add button.
      const taskId = activeDrawerTrigger.closest?.('.planner-task-row')?.dataset?.taskId;
      if (taskId && typeof document.querySelector === 'function') {
        restoreTarget = document.querySelector(
          `#task-list .planner-task-row[data-task-id="${CSS.escape(taskId)}"] .task-open`
        ) || null;
      }
      if (!restoreTarget) restoreTarget = element('add-task-btn');
    }
  }
  const focusVisible = overlayOpenedByKeyboard;
  overlayOpenedByKeyboard = true;
  if (restoreTarget?.focus) {
    try {
      restoreTarget.focus({ focusVisible });
    } catch {
      restoreTarget.focus();
    }
  }
  if (pendingTimelineRecenter && !element('timeline-viewport')?.contains(document.activeElement)) {
    pendingTimelineRecenter = false;
    requestAnimationFrame(() => centerTimelineOnNow(
      element('timeline-viewport'),
      element('timeline-viewport')?.querySelector('[data-timeline-now="true"]')
    ));
  }
}

function editModalIsOpen() {
  return !element('edit-modal')?.classList.contains('hidden');
}

function openEditModal(task, trigger, viaKeyboard = true) {
  const modal = element('edit-modal');
  if (!modal) return;
  if (modal.classList.contains('hidden')) {
    overlayOpenedByKeyboard = viaKeyboard;
    openOverlayScaffold();
    if (trigger) activeDrawerTrigger = trigger;
  }
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  // Clear any in-flight save state left on the persistent shell.
  delete modal.dataset.saving;
  const modalBody = element('edit-modal-body');
  if (modalBody) modalBody.inert = false;
  modal.querySelector('.edit-modal-panel')?.removeAttribute('aria-busy');
  const closeBtn = element('edit-modal-close');
  if (closeBtn) closeBtn.disabled = false;
  renderTaskEditForm(task);
}

function closeEditModal() {
  const modal = element('edit-modal');
  if (!modal || modal.classList.contains('hidden')) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  closeOverlayScaffold();
  restoreOverlayFocus();
}

// Bottom-centre "Task updated" toast — fixed position, auto-hides.
let toastTimer = null;
function showToast(text) {
  let toast = element('nt-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'nt-toast';
    toast.className = 'nt-toast';
    toast.setAttribute('role', 'status');
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

// Briefly hold the hover wash on the saved row (~1.2s); renderTasks re-applies
// it if a refresh replaces the row inside the window.
const flashState = { taskId: '', until: 0 };
function flashTaskRow(taskId) {
  flashState.taskId = String(taskId);
  flashState.until = Date.now() + 1250;
  const row = document.querySelector(
    `#task-list .planner-task-row[data-task-id="${CSS.escape(flashState.taskId)}"]`);
  if (!row) return;
  row.classList.add('is-flash');
  setTimeout(() => {
    flashState.until = 0;
    row.classList.remove('is-flash');
  }, 1250);
}

function ensureLabels() {
  if (!labelsRequest) {
    labelsRequest = todoist.getLabels()
      .then(list => { labelsList = list; return list; })
      .catch(() => { labelsList = []; return labelsList; });
  }
  return labelsRequest;
}

function projectPath(project) {
  const parts = [];
  const seen = new Set();
  let current = project;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    parts.unshift(current.name);
    current = current.parent_id ? projects.get(String(current.parent_id)) : null;
  }
  return parts.join(' / ');
}

// Spinner swap for the text submit buttons (same size, aria-busy).
function setFormPending(button, pending) {
  if (!button) return;
  if (pending) {
    button.dataset.pendingLabel = button.textContent;
    button.textContent = '';
    const spinner = document.createElement('span');
    spinner.className = 'planner-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    button.appendChild(spinner);
    button.setAttribute('aria-busy', 'true');
    button.disabled = true;
  } else {
    if (button.dataset.pendingLabel !== undefined) {
      button.textContent = button.dataset.pendingLabel;
      delete button.dataset.pendingLabel;
    }
    button.removeAttribute('aria-busy');
    button.disabled = false;
  }
}

// P1…P4 flag toggles in Todoist order/colours. getP() returns the displayed
// number; onPick(n) receives the picked or toggled-off value.
function buildPriorityRow(getP, onPick) {
  const row = document.createElement('div');
  row.className = 'qa-priority';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Priority');
  const buttons = [];
  for (let n = 1; n <= 4; n++) {
    const style = taskPriorityStyle(5 - n); // P1 = API priority 4 (urgent)
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'qa-flag';
    button.textContent = `P${n}`;
    button.setAttribute('aria-label', `Priority ${n}`);
    button.setAttribute('aria-pressed', 'false');
    button.style.setProperty('--flag-color', style.color);
    button.addEventListener('click', () => {
      const next = getP() === n ? null : n;
      onPick(next);
      sync();
    });
    buttons.push(button);
    row.appendChild(button);
  }
  function sync() {
    const current = getP();
    buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(current === i + 1)));
  }
  sync();
  row.sync = sync;
  return row;
}

// #project/@label autocomplete bound to a composer input; the listbox renders
// inside `container` (the quick-add panel) or next to the input.
function attachQuickAddAutocomplete(input, { onChange = () => {}, container = null } = {}) {
  const wrap = container || input.closest('.task-composer-wrap') || input.parentElement;
  const list = document.createElement('div');
  list.className = 'qa-suggest';
  list.id = 'quick-add-suggest';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  wrap.appendChild(list);
  let items = [];
  let index = -1;
  let token = null;

  const pool = kind => kind === '#'
    ? [...projects.values()].map(p => ({ name: p.name, color: p.color, label: projectPath(p), match: projectPath(p) }))
    : (labelsList || []).map(l => ({ name: l.name, color: l.color, label: l.name }));

  function close() {
    list.hidden = true;
    list.innerHTML = '';
    items = [];
    index = -1;
    token = null;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function paintActive() {
    [...list.children].forEach((el, i) => el.setAttribute('aria-selected', String(i === index)));
    if (index >= 0) input.setAttribute('aria-activedescendant', `qa-opt-${index}`);
    else input.removeAttribute('aria-activedescendant');
  }

  function accept(item) {
    input.value = insertCompletion(input.value, token, item.name);
    input.selectionStart = input.selectionEnd = token.start + 1 + item.name.length + 1;
    close();
    onChange();
  }

  function update() {
    token = tokenAtCaret(input.value, input.selectionStart ?? input.value.length);
    if (!token.kind || document.activeElement !== input) { close(); return; }
    items = matchSuggestions(pool(token.kind), token.query, 6);
    index = -1;
    if (!items.length) { close(); return; }
    list.innerHTML = '';
    items.forEach((item, i) => {
      const option = document.createElement('div');
      option.className = 'qa-option';
      option.id = `qa-opt-${i}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      const dot = document.createElement('span');
      dot.className = 'qa-dot';
      dot.style.background = todoistColor(item.color);
      const text = document.createElement('span');
      text.textContent = item.label;
      option.append(dot, text);
      option.addEventListener('pointerdown', event => { event.preventDefault(); accept(item); });
      list.appendChild(option);
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  input.addEventListener('input', () => { update(); onChange(); });
  input.addEventListener('click', update);
  input.addEventListener('blur', () => { if (!list.matches(':hover')) close(); });
  input.addEventListener('keydown', event => {
    if (list.hidden) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      index = (index + 1) % items.length;
      paintActive();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      index = index <= 0 ? items.length - 1 : index - 1;
      paintActive();
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      // Enter accepts the highlighted (or first) suggestion instead of submitting.
      event.preventDefault();
      accept(items[Math.max(index, 0)]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation(); // close the list, not the overlay
      close();
    }
  });
  return { update, close };
}

// Todoist colour names → approximate hexes for dots/chips; hex values pass through.
const TODOIST_COLORS = {
  berry_red: '#b8255f', red: '#dc4c3e', orange: '#eb8909', yellow: '#f2c94c',
  olive_green: '#949c31', lime_green: '#65a33a', green: '#369307', mint_green: '#42b883',
  teal: '#148fad', sky_blue: '#59c2ff', light_blue: '#96c3eb', blue: '#246fe0',
  grape: '#884dff', violet: '#af38eb', lavender: '#eb96eb', magenta: '#e05194',
  salmon: '#ff8d85', charcoal: '#808080', grey: '#b8b8b8', taupe: '#ccac93'
};
function todoistColor(color) {
  if (!color) return '#808080';
  if (String(color).startsWith('#')) return color;
  return TODOIST_COLORS[String(color).toLowerCase()] || '#808080';
}

async function renderTaskEditForm(task) {
  const body = element('edit-modal-body');
  if (!body) return;
  body.innerHTML = '';
  const labels = await ensureLabels();
  if (!body.isConnected) return;
  const dueIso = task.due?.datetime || task.due?.date?.slice?.(0, 10) || '';
  const dueOriginal = task.due?.string
    || (dueIso ? new Date(`${dueIso.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '');
  const descOriginal = task.description || '';
  let editPriority = Number(task.priority) || 1;
  const selectedLabels = new Set(task.labels || []);

  const form = document.createElement('form');
  form.className = 'task-form';
  form.innerHTML = `
    <label class="field-label" for="planner-edit-title">Task</label>
    <input class="field-input" id="planner-edit-title" name="content" autocomplete="off" required>
    <label class="field-label" for="planner-edit-desc">Description</label>
    <textarea class="field-input field-textarea" id="planner-edit-desc" name="description" rows="3"></textarea>
    <label class="field-label" for="planner-edit-due">Due</label>
    <input class="field-input" id="planner-edit-due" name="due_string" autocomplete="off">
    <p class="qa-hint">Natural language, e.g. every Friday 9am</p>
    <span class="field-label qa-caption">Priority</span>
    <label class="field-label" for="planner-edit-project">Project</label>
    <select class="field-input" id="planner-edit-project" name="project_id"></select>
    <span class="field-label qa-caption">Labels</span>
    <div class="qa-labels"></div>
    <p class="form-error" id="edit-modal-error" role="alert" hidden></p>
    <div class="task-form-foot">
      <span class="edit-hint">${navigator.platform?.includes('Mac') !== false ? '⌘↵ to save' : 'Ctrl+↵ to save'}</span>
      <button class="edit-cancel" type="button">Cancel</button>
      <button class="edit-save" type="submit">Save</button>
    </div>`;
  form.elements.content.value = task.content || '';
  form.elements.description.value = descOriginal;
  form.elements.due_string.value = dueOriginal;

  const projectSelect = form.elements.project_id;
  for (const project of projects.values()) projectSelect.append(new Option(projectPath(project), project.id));
  const inboxProject = [...projects.values()].find(project => project.is_inbox_project);
  let originalProjectId = String(task.project_id || '');
  if (originalProjectId) {
    projectSelect.value = originalProjectId;
    if (projectSelect.value !== originalProjectId) {
      // Task lives in a project absent from the loaded list (e.g. shared).
      const isInbox = inboxProject && String(inboxProject.id) === originalProjectId;
      projectSelect.append(new Option(isInbox ? 'Inbox' : 'Current project', originalProjectId, true, true));
      projectSelect.value = originalProjectId;
    }
  } else if (inboxProject) {
    originalProjectId = String(inboxProject.id);
    projectSelect.value = originalProjectId;
  }

  const priorityRow = buildPriorityRow(
    () => 5 - editPriority, // API 4 → P1, API 1 → P4
    n => { editPriority = n == null ? 1 : 5 - n; }
  );
  form.querySelector('.qa-caption').after(priorityRow);

  const labelWrap = form.querySelector('.qa-labels');
  if (!labels.length) {
    labelWrap.textContent = 'No labels in Todoist yet.';
    labelWrap.classList.add('qa-hint');
  }
  for (const label of labels) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'qa-chip qa-label-chip';
    chip.setAttribute('aria-pressed', String(selectedLabels.has(label.name)));
    const dot = document.createElement('span');
    dot.className = 'qa-dot';
    dot.style.background = todoistColor(label.color);
    const text = document.createElement('span');
    text.textContent = label.name;
    chip.append(dot, text);
    chip.addEventListener('click', () => {
      if (selectedLabels.has(label.name)) selectedLabels.delete(label.name);
      else selectedLabels.add(label.name);
      chip.setAttribute('aria-pressed', String(selectedLabels.has(label.name)));
    });
    labelWrap.appendChild(chip);
  }

  const textarea = form.elements.description;
  const autosize = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 8 * 24)}px`;
  };
  textarea.addEventListener('input', autosize);
  queueMicrotask(autosize);

  const saveBtn = form.querySelector('.edit-save');
  const cancelBtn = form.querySelector('.edit-cancel');
  const errorEl = form.querySelector('#edit-modal-error');
  const modalBody = body;

  const pendingChanges = () => {
    const data = new FormData(form);
    const changes = buildUpdateTaskPayload({
      content: data.get('content'),
      originalContent: task.content,
      description: data.get('description'),
      originalDescription: descOriginal,
      dueString: data.get('due_string'),
      originalDueString: dueOriginal,
      priority: editPriority,
      originalPriority: Number(task.priority) || 1,
      labels: [...selectedLabels],
      originalLabels: task.labels || []
    });
    const targetProject = data.get('project_id');
    const projectChanged = String(originalProjectId || '') !== String(targetProject || '');
    return { changes, projectChanged, targetProject };
  };

  const syncSaveState = () => {
    const { changes, projectChanged } = pendingChanges();
    saveBtn.disabled = !Object.keys(changes).length && !projectChanged;
  };
  syncSaveState();
  form.addEventListener('input', syncSaveState);
  form.addEventListener('change', syncSaveState);
  // Priority buttons / label chips mutate state outside form fields.
  form.addEventListener('click', event => {
    if (event.target.closest('.qa-flag, .qa-label-chip')) syncSaveState();
  });

  cancelBtn.addEventListener('click', () => closeEditModal());

  // ⌘/Ctrl+Enter saves from anywhere in the modal; Enter in Task submits
  // natively; Enter in Description inserts a newline (textarea default).
  form.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      if (!saveBtn.disabled) form.requestSubmit();
    }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saveBtn.disabled) return;
    const { changes, projectChanged, targetProject } = pendingChanges();
    if (!Object.keys(changes).length && !projectChanged) return;
    // In-flight state: fields inert, Save shows spinner + "Saving…",
    // Cancel/Escape disabled until the request settles.
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="planner-spinner" aria-hidden="true"></span>Saving…';
    cancelBtn.disabled = true;
    const modal = element('edit-modal');
    const panel = modal?.querySelector('.edit-modal-panel');
    const closeBtn = element('edit-modal-close');
    if (closeBtn) closeBtn.disabled = true;
    modal.dataset.saving = '1';
    modalBody.inert = true;
    panel?.setAttribute('aria-busy', 'true');
    errorEl.hidden = true;
    try {
      if (Object.keys(changes).length) await todoist.updateTask(task.id, changes);
      if (projectChanged) await todoist.moveTask(task.id, { project_id: targetProject });
      await loadTaskData();
      const savedTaskId = task.id;
      closeEditModal();
      showToast('Task updated');
      flashTaskRow(savedTaskId);
    } catch (error) {
      console.error('Failed to update task:', error);
      modalBody.inert = false;
      panel?.removeAttribute('aria-busy');
      delete modal.dataset.saving;
      if (closeBtn) closeBtn.disabled = false;
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      cancelBtn.disabled = false;
      errorEl.hidden = false;
      errorEl.textContent = "Couldn't save — check your connection and try again.";
    }
  });
  body.appendChild(form);
  queueMicrotask(() => form.elements.content?.focus());
}

// ---------------------------------------------------------------------------
// Quick Add spotlight (⌘K / + button)
// ---------------------------------------------------------------------------

const QUICK_ADD_HINT = 'Enter to add · Esc to close · dates, #project, @label, p1–p4';

function quickAddIsOpen() {
  return !element('quick-add')?.classList.contains('hidden');
}

function resetQuickAddFooter() {
  const foot = element('quick-add-foot');
  if (foot && foot.dataset.mode !== 'hint') {
    foot.dataset.mode = 'hint';
    foot.textContent = QUICK_ADD_HINT;
  } else if (foot && !foot.dataset.mode) {
    foot.dataset.mode = 'hint';
  }
}

function openQuickAdd() {
  const overlay = element('quick-add');
  if (!overlay || quickAddIsOpen()) return;
  openOverlayScaffold();
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
  const input = element('quick-add-input');
  const foot = element('quick-add-foot');
  if (foot) {
    foot.dataset.mode = 'hint';
    foot.textContent = QUICK_ADD_HINT;
  }
  const spinner = element('quick-add-spinner');
  if (spinner) spinner.hidden = true;
  element('quick-add-form')?.removeAttribute('aria-busy');
  if (input) {
    input.value = '';
    input.disabled = false;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }
  quickAddAutocomplete?.close();
  ensureLabels().then(() => quickAddAutocomplete?.update());
  queueMicrotask(() => input?.focus());
}

function closeQuickAdd() {
  const overlay = element('quick-add');
  if (!overlay || !quickAddIsOpen()) return;
  quickAddAutocomplete?.close();
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
  closeOverlayScaffold();
  restoreOverlayFocus();
}

function setupQuickAdd() {
  const input = element('quick-add-input');
  const foot = element('quick-add-foot');
  const spinner = element('quick-add-spinner');
  const form = element('quick-add-form');
  // `closest` exists only on real DOM inputs (the VM test harness fabricates
  // bare element stubs), so this also guards non-DOM environments.
  if (!input || !form || typeof input.closest !== 'function') return;
  const glyph = element('quick-add-glyph');
  if (glyph) glyph.innerHTML = globalThis.Icons?.plus || '';
  quickAddAutocomplete = attachQuickAddAutocomplete(input, { container: element('quick-add-list') });
  input.addEventListener('input', () => { resetQuickAddFooter(); });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || input.disabled) return;
    input.disabled = true;
    spinner.hidden = false;
    form.setAttribute('aria-busy', 'true');
    foot.dataset.mode = 'status';
    foot.textContent = 'Adding task…';
    try {
      const task = await todoist.quickAddTask(text);
      await loadTaskData();
      input.value = '';
      input.disabled = false;
      quickAddAutocomplete.close();
      foot.dataset.mode = 'status';
      foot.innerHTML = '';
      foot.append(document.createTextNode(describeCreatedTask(task, projects) + ' '));
      const link = document.createElement('a');
      link.className = 'quick-add-link';
      link.href = `https://app.todoist.com/app/task/${encodeURIComponent(task.id)}`;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = 'Open in Todoist';
      foot.appendChild(link);
      input.focus();
    } catch (error) {
      console.error('Failed to create task:', error);
      foot.dataset.mode = 'error';
      foot.textContent = 'The task was not added. Try again.';
    } finally {
      input.disabled = false;
      spinner.hidden = true;
      form.removeAttribute('aria-busy');
    }
  });
}

function setupDrawer() {
  element('edit-modal-close')?.addEventListener('click', closeEditModal);
  element('edit-modal-backdrop')?.addEventListener('click', closeEditModal);
  element('quick-add-backdrop')?.addEventListener('click', closeQuickAdd);
  document.addEventListener('keydown', event => {
    // ⌘K / Ctrl+K opens the quick-add bar (not while typing or editing).
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
      const target = event.target;
      const typing = target?.closest?.('input, textarea, select, [contenteditable="true"]');
      if (typing || editModalIsOpen()) return;
      event.preventDefault();
      overlayOpenedByKeyboard = true;
      if (quickAddIsOpen()) element('quick-add-input')?.focus();
      else openQuickAdd();
      return;
    }
    const quickAdd = element('quick-add');
    const editModal = element('edit-modal');
    const openPanel = (!quickAdd?.classList.contains('hidden') && quickAdd)
      || (!editModal?.classList.contains('hidden') && editModal);
    if (!openPanel) return;
    if (event.key === 'Escape') {
      // While a save is in flight, Cancel/Escape stays disabled.
      if (openPanel === editModal && editModal.dataset.saving) return;
      event.preventDefault();
      // Suggestion list takes the first Escape, then the overlay itself.
      if (openPanel === quickAdd && !element('quick-add-suggest')?.hidden) {
        quickAddAutocomplete.close();
        return;
      }
      if (openPanel === quickAdd) closeQuickAdd(); else closeEditModal();
      return;
    }
    if (event.key === 'Tab') {
      const scope = openPanel.querySelector?.('[role="dialog"]') || openPanel;
      const focusable = [...scope.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')];
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
}

function setupActions() {
  element('add-task-btn')?.addEventListener('click', event => {
    overlayOpenedByKeyboard = event.detail === 0;
    openQuickAdd();
  });
  element('todos-connect-btn')?.addEventListener('click', async event => {
    setButtonPending(event.currentTarget, true);
    try {
      await todoist.authenticate();
      await loadTaskData();
    } finally {
      setButtonPending(event.currentTarget, false);
    }
  });
  element('calendar-connect-btn')?.addEventListener('click', async event => {
    setButtonPending(event.currentTarget, true);
    try {
      await api.sendRuntimeMessage({ type: 'CONNECT_GOOGLE_CALENDAR' });
      await refreshCalendarScope();
      await loadCalendarData({ force: true, recenter: true });
    } finally {
      setButtonPending(event.currentTarget, false);
    }
  });
  const viewport = element('timeline-viewport');
  const backToNow = element('back-to-now-btn');
  let scrollbarHideTimer;
  let scrollbarActive = false;
  const revealTimelineScrollbar = () => {
    scrollbarActive = true;
    viewport?.classList.add('timeline-scrolling');
    clearTimeout(scrollbarHideTimer);
    scrollbarHideTimer = setTimeout(() => {
      scrollbarActive = false;
      viewport?.classList.remove('timeline-scrolling');
    }, 800);
  };
  const anchorTimeline = () => {
    timelineUserAnchored = true;
    updateBackToNow();
    revealTimelineScrollbar();
  };
  let backToNowFrame = null;
  viewport?.addEventListener('scroll', () => {
    if (scrollbarActive) revealTimelineScrollbar();
    // Re-evaluate visibility as the Now marker leaves/re-enters the view.
    if (backToNowFrame) return;
    backToNowFrame = requestAnimationFrame(() => {
      backToNowFrame = null;
      updateBackToNow();
    });
  }, { passive: true });
  viewport?.addEventListener('wheel', anchorTimeline, { passive: true });
  viewport?.addEventListener('touchstart', anchorTimeline, { passive: true });
  viewport?.addEventListener('pointerdown', event => {
    if (event.target === viewport) anchorTimeline();
  }, { passive: true });
  viewport?.addEventListener('keydown', event => {
    if (event.key === ' ' && event.target.closest?.('.timeline-blk')) return;
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) anchorTimeline();
  });
  viewport?.addEventListener('focusout', event => {
    if (!pendingTimelineRecenter || editModalIsOpen() || viewport.contains(event.relatedTarget)) return;
    pendingTimelineRecenter = false;
    requestAnimationFrame(() => centerTimelineOnNow(viewport, viewport?.querySelector('[data-timeline-now="true"]')));
  });
  backToNow?.addEventListener('click', () => {
    timelineUserAnchored = false;
    setActionAvailable(backToNow, false);
    centerTimelineOnNow(viewport, viewport?.querySelector('[data-timeline-now="true"]'));
    // The focused button is now hidden: move focus into the timeline region
    // without scrolling the page.
    viewport?.focus?.({ preventScroll: true });
  });
}

export function initPlannerDashboard(options) {
  if (plannerStarted) return;
  plannerStarted = true;
  api = options;
  setupDrawer();
  setupQuickAdd();
  setupActions();
  if (typeof MutationObserver !== 'undefined' && document.documentElement) {
    const observer = new MutationObserver(() => renderCalendar());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  // The viewport is now flex-sized: its height changes with the window (and
  // once while webfonts settle). The canvas padding is a fraction of that
  // height, so re-render on real height changes.
  const viewportEl = element('timeline-viewport');
  if (typeof ResizeObserver !== 'undefined' && viewportEl) {
    let lastViewportHeight = viewportEl.clientHeight;
    new ResizeObserver(() => {
      const h = viewportEl.clientHeight;
      if (Math.abs(h - lastViewportHeight) < 1) return;
      lastViewportHeight = h;
      renderCalendar({ recenter: true });
    }).observe(viewportEl);
  }
}

export async function refreshPlannerDashboard() {
  if (!plannerStarted) return;
  await Promise.allSettled([loadTaskData(), loadCalendarData({ recenter: !loadedCalendarDate })]);
}

export function refreshPlannerTime({ recenter = false } = {}) {
  if (!plannerStarted || !api.isVisible('newtabShowCalendar')) return;
  const today = toLocalDateKey();
  if (recenter) {
    timelineUserAnchored = false;
    setAction('back-to-now-btn', false);
  }
  if ((loadedCalendarDate && loadedCalendarDate !== today) || (lastCalendarAttemptDate && lastCalendarAttemptDate !== today)) {
    loadedCalendarDate = '';
    todayEvents = [];
    lastCalendarAttemptAt = 0;
    lastCalendarAttemptDate = '';
    timelineUserAnchored = false;
    setAction('back-to-now-btn', false);
    loadCalendarData({ force: true, recenter: true });
    return;
  }
  renderCalendar({ recenter });
}

export function handlePlannerStorageChange(changes) {
  if (!plannerStarted) return;
  if (changes[PLANNER_STATE_KEY]) {
    const state = changes[PLANNER_STATE_KEY].newValue;
    currentTaskId = state?.date === toLocalDateKey() ? state.taskId : '';
    renderTasks();
  }
  if (changes.calendarSettings && calendarScopeChanged(changes.calendarSettings)) {
    lastCalendarAttemptAt = 0;
    lastCalendarAttemptDate = '';
    getCalendarData().setScope(calendarScopeKey(changes.calendarSettings.newValue));
    if (api.isVisible('newtabShowCalendar')) loadCalendarData({ force: true });
  }
}

function calendarScopeChanged(change) {
  const before = change?.oldValue || {};
  const after = change?.newValue || {};
  if (before.connected !== after.connected || before.email !== after.email || before.cacheRevision !== after.cacheRevision) return true;
  const selected = value => [...(Array.isArray(value) ? value : [])].map(String).sort();
  return JSON.stringify(selected(before.selectedCalendars)) !== JSON.stringify(selected(after.selectedCalendars));
}
