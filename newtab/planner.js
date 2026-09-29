import * as todoist from '../lib/todoist.js';
import {
  addLocalDays,
  flattenTasks,
  normalizeEvents,
  rankTasks,
  selectNowTask,
  safeExternalUrl,
  toLocalDateKey
} from './planner-model.js';
import { clearCurrentTaskState, loadCurrentTaskState, PLANNER_STATE_KEY, saveCurrentTaskState } from './planner-state.js';
import { createTaskRow, renderTaskGroups, taskMeta } from './planner-tasks.js';
import { createEventRow, formatEventTime, getMeetingUrl, normalizePlannerEventsPayload, renderEventList } from './planner-calendar.js';
import { centerTimelineOnNow, renderDayTimeline } from './planner-timeline.js';
import {
  buildCreateTaskPayload,
  buildUpdateTaskPayload,
  createLatestRequestGuard,
  nextCurrentTaskIdAfterCompletion
} from './planner-actions.js';

let api;
let tasks = [];
let projects = new Map();
let currentTaskId = '';
let todayEvents = [];
let plannerStarted = false;
let activeDrawerTrigger = null;
let selectedScheduleDate = toLocalDateKey();
let activeTaskView = 'day';
let selectedTaskDate = toLocalDateKey();
let activeProjectId = '';
let taskBrowseLimit = 30;
const scheduleRequestGuard = createLatestRequestGuard();
const taskRequestGuard = createLatestRequestGuard();
const calendarRequestGuard = createLatestRequestGuard();
const pendingTaskIds = new Set();
const CALENDAR_REFRESH_INTERVAL = 5 * 60 * 1000;
let lastCalendarAttemptAt = 0;
let lastCalendarAttemptDate = '';
let loadedCalendarDate = '';
let timelineUserAnchored = false;
let pendingTimelineRecenter = false;

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

function setText(id, value) {
  const target = element(id);
  if (target) target.textContent = value;
}

function setPlannerStatus(kind, message = '') {
  setText(`${kind}-status`, message);
  setHidden(`${kind}-status`, !message);
}

async function getPlannerEvents(date) {
  const payload = await api.sendRuntimeMessage({ type: 'GET_PLANNER_EVENTS', date });
  if (payload?.error && !payload?.events?.length && !payload?.disconnected) {
    throw Object.assign(new Error(payload.error), { status: payload.status });
  }
  return normalizePlannerEventsPayload(payload, date);
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
      setHidden('todos-connect-btn', false);
      renderTasks();
      return;
    }
    setHidden('todos-connect-btn', true);
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
  if (!force && lastCalendarAttemptDate === today && Date.now() - lastCalendarAttemptAt < CALENDAR_REFRESH_INTERVAL) {
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
      setHidden('calendar-connect-btn', false);
      setText('calendar-connect-btn', 'Connect Calendar');
      renderCalendar({ recenter });
      return;
    }
    setHidden('calendar-connect-btn', true);
    const todayPayload = await getPlannerEvents(today);
    if (!calendarRequestGuard.isLatest(requestId) || today !== toLocalDateKey()) return;
    todayEvents = normalizeEvents(todayPayload.events);
    loadedCalendarDate = today;
    if (todayPayload.disconnected) {
      setPlannerStatus('calendar', 'Your Calendar connection expired. Reconnect to refresh it.');
      setHidden('calendar-connect-btn', false);
      setText('calendar-connect-btn', 'Reconnect Calendar');
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
  const ranked = rankTasks(flattenTasks(tasks), now);
  const current = selectNowTask(tasks, currentTaskId, now);
  const currentContainer = element('now-task');
  const preview = element('task-preview-list');
  if (!currentContainer || !preview) return;
  currentContainer.innerHTML = '';
  preview.innerHTML = '';

  if (!current) {
    const empty = document.createElement('p');
    empty.className = 'brief-empty';
    empty.textContent = element('tasks-status')?.textContent
      ? 'Tasks will appear after Todoist connects.'
      : 'No task needs your attention right now.';
    currentContainer.appendChild(empty);
  } else {
    const row = createTaskRow(current, {
      current: String(current.id) === String(currentTaskId), projects, now,
      showCurrentAction: !currentTaskId,
      pending: pendingTaskIds.has(String(current.id)),
      onComplete: completeTask,
      onMakeCurrent: makeTaskCurrent
    });
    row.classList.add('planner-task-feature');
    currentContainer.appendChild(row);
    setText('now-task-label', currentTaskId ? 'Current task' : 'Suggested task');
  }

  for (const task of ranked.filter(task => String(task.id) !== String(current?.id)).slice(0, 2)) {
    preview.appendChild(createTaskRow(task, { projects, now, pending: pendingTaskIds.has(String(task.id)), onComplete: completeTask }));
  }
  setHidden('task-preview-empty', ranked.length > 1 || Boolean(element('tasks-status')?.textContent));
}

function renderCalendar({ recenter = false } = {}) {
  const viewport = element('timeline-viewport');
  const list = element('timeline-list');
  const allDay = element('timeline-all-day');
  const empty = element('timeline-empty');
  if (!viewport || !list || !allDay || !empty) return;
  const result = renderDayTimeline({ viewport, list, allDay, empty }, todayEvents, {
    date: loadedCalendarDate || toLocalDateKey(),
    now: new Date(),
    hasStatus: Boolean(element('calendar-status')?.textContent),
    onOpen: (event, trigger) => openEventDetail(event, trigger)
  });
  if (!result.hasEvents) {
    timelineUserAnchored = false;
    element('back-to-now-btn')?.classList.add('hidden');
  }
  if (recenter && !timelineUserAnchored) {
    const drawerOpen = !element('planner-drawer')?.classList.contains('hidden');
    const timelineFocused = viewport.contains(document.activeElement);
    if (drawerOpen || timelineFocused) {
      pendingTimelineRecenter = true;
    } else {
      pendingTimelineRecenter = false;
      requestAnimationFrame(() => centerTimelineOnNow(viewport, result.marker));
    }
  }
}

async function makeTaskCurrent(task) {
  const token = await todoist.getToken();
  await saveCurrentTaskState(storage, token, task.id);
  currentTaskId = String(task.id);
  renderTasks();
  if (!element('planner-drawer')?.classList.contains('hidden')) renderTaskDrawer();
}

async function completeTask(task, button) {
  const taskId = String(task.id);
  if (button.disabled || pendingTaskIds.has(taskId)) return;
  pendingTaskIds.add(taskId);
  button.disabled = true;
  button.classList.add('is-pending');
  try {
    await todoist.completeTask(task.id);
    await api.sendRuntimeMessage({ type: 'ADD_EARNED_TIME', taskCount: 1 }).catch(() => null);
    const nextCurrentTaskId = nextCurrentTaskIdAfterCompletion(currentTaskId, task.id);
    if (nextCurrentTaskId !== currentTaskId) {
      currentTaskId = nextCurrentTaskId;
      await clearCurrentTaskState(storage);
    }
    await loadTaskData();
    if (!element('planner-drawer')?.classList.contains('hidden') && element('planner-drawer')?.dataset.mode === 'tasks') renderTaskDrawer();
  } catch (error) {
    console.error('Failed to complete task:', error);
    button.disabled = false;
    button.classList.remove('is-pending');
  } finally {
    pendingTaskIds.delete(taskId);
    renderTasks();
    if (!element('planner-drawer')?.classList.contains('hidden') && element('planner-drawer')?.dataset.mode === 'tasks') renderTaskDrawer();
  }
}

function openDrawer(mode, trigger) {
  const drawer = element('planner-drawer');
  if (drawer.classList.contains('hidden')) activeDrawerTrigger = trigger || document.activeElement;
  drawer.dataset.mode = mode;
  drawer.classList.remove('hidden');
  drawer.setAttribute('aria-hidden', 'false');
  document.body.classList.add('planner-open');
  if (mode === 'tasks') renderTaskDrawer();
  if (mode === 'add') renderTaskForm();
  if (mode === 'schedule') renderScheduleDrawer();
  element('planner-drawer-close')?.focus();
}

function closeDrawer() {
  const drawer = element('planner-drawer');
  drawer.classList.add('hidden');
  drawer.setAttribute('aria-hidden', 'true');
  drawer.dataset.mode = '';
  document.body.classList.remove('planner-open');
  const fallback = element('view-schedule-btn');
  const restoreTarget = activeDrawerTrigger?.isConnected ? activeDrawerTrigger : fallback;
  restoreTarget?.focus?.();
  if (pendingTimelineRecenter && !element('timeline-viewport')?.contains(document.activeElement)) {
    pendingTimelineRecenter = false;
    requestAnimationFrame(() => centerTimelineOnNow(
      element('timeline-viewport'),
      element('timeline-list')?.querySelector('[data-timeline-now="true"]')
    ));
  }
}

function drawerShell(title, eyebrow = '') {
  setText('planner-drawer-eyebrow', eyebrow);
  setText('planner-drawer-title', title);
  const body = element('planner-drawer-body');
  body.innerHTML = '';
  return body;
}

function renderTaskDrawer() {
  const body = drawerShell('Your tasks', 'Plan');
  const toolbar = document.createElement('div');
  toolbar.className = 'drawer-toolbar';
  const tabs = document.createElement('div');
  tabs.className = 'drawer-tabs';
  for (const [value, label] of [['day', 'Day'], ['upcoming', 'Upcoming'], ['all', 'All']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `drawer-tab${activeTaskView === value ? ' is-active' : ''}`;
    button.textContent = label;
    button.addEventListener('click', () => { activeTaskView = value; renderTaskDrawer(); });
    tabs.appendChild(button);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'text-action';
  add.textContent = 'Add task';
  add.addEventListener('click', event => openDrawer('add', event.currentTarget));
  toolbar.append(tabs, add);
  const filters = document.createElement('div');
  filters.className = 'drawer-filters';
  const projectFilter = document.createElement('select');
  projectFilter.className = 'field-input';
  projectFilter.setAttribute('aria-label', 'Filter tasks by project');
  projectFilter.append(new Option('All projects', ''));
  for (const project of projects.values()) projectFilter.append(new Option(project.name, project.id));
  projectFilter.value = activeProjectId;
  projectFilter.addEventListener('change', () => {
    activeProjectId = projectFilter.value;
    taskBrowseLimit = 30;
    renderTaskDrawer();
  });
  filters.appendChild(projectFilter);
  if (activeTaskView === 'day') {
    const dateFilter = document.createElement('input');
    dateFilter.className = 'field-input';
    dateFilter.type = 'date';
    dateFilter.value = selectedTaskDate;
    dateFilter.setAttribute('aria-label', 'Task date');
    dateFilter.addEventListener('change', () => {
      selectedTaskDate = dateFilter.value || toLocalDateKey();
      renderTaskDrawer();
    });
    filters.appendChild(dateFilter);
  }
  const list = document.createElement('div');
  list.className = 'drawer-task-groups';
  const filteredTasks = flattenTasks(tasks).filter(task => !activeProjectId || String(task.project_id) === activeProjectId);
  const visibleTasks = filteredTasks.slice(0, taskBrowseLimit).map(task => ({ ...task, subtasks: [] }));
  renderTaskGroups(list, visibleTasks, {
    view: activeTaskView,
    selectedDate: selectedTaskDate,
    currentTaskId,
    projects,
    now: new Date(),
    pendingTaskIds,
    onComplete: completeTask,
    onMakeCurrent: makeTaskCurrent,
    onEdit: renderTaskEditForm
  });
  body.append(toolbar, filters, list);
  if (visibleTasks.length < filteredTasks.length) {
    const showMore = document.createElement('button');
    showMore.type = 'button';
    showMore.className = 'text-action';
    showMore.textContent = `Show ${Math.min(30, filteredTasks.length - visibleTasks.length)} more`;
    showMore.addEventListener('click', () => { taskBrowseLimit += 30; renderTaskDrawer(); });
    body.appendChild(showMore);
  }
}

function renderTaskEditForm(task) {
  const body = drawerShell('Edit task', 'Task');
  const recurring = Boolean(task.due?.is_recurring || task.due?.recurring);
  const dueValue = task.due?.date?.slice(0, 10) || task.due?.datetime?.slice(0, 10) || '';
  const timed = Boolean(task.due?.datetime || task.due?.date?.includes?.('T'));
  const preserveDue = recurring || timed;
  const form = document.createElement('form');
  form.className = 'task-form';
  form.innerHTML = `
    <label class="field-label" for="planner-edit-title">Task</label>
    <input class="task-title-input" id="planner-edit-title" name="content" autocomplete="off" required>
    <div class="task-details-grid">
      <label class="field-label">Due date<input class="field-input" type="date" name="due_date" ${preserveDue ? 'disabled' : ''}></label>
      <label class="field-label">Priority<select class="field-input" name="priority"><option value="1">Normal</option><option value="2">Medium</option><option value="3">High</option><option value="4">Urgent</option></select></label>
    </div>
    ${preserveDue ? `<p class="form-status">Edit ${recurring ? 'recurring' : 'timed'} dates in Todoist.</p>` : '<p class="form-status" aria-live="polite"></p>'}
    <button class="primary-action" type="submit">Save changes</button>`;
  form.elements.content.value = task.content || '';
  form.elements.priority.value = String(task.priority || 1);
  if (!preserveDue) form.elements.due_date.value = dueValue;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    const status = form.querySelector('.form-status');
    submit.disabled = true;
    if (!preserveDue) status.textContent = 'Saving changes…';
    const data = new FormData(form);
    try {
      const changes = buildUpdateTaskPayload({
        content: data.get('content'),
        dueDate: data.get('due_date'),
        originalDueDate: dueValue,
        priority: data.get('priority'),
        preserveDue
      });
      await todoist.updateTask(task.id, changes);
      await loadTaskData();
      renderTaskDrawer();
    } catch (error) {
      console.error('Failed to update task:', error);
      status.textContent = 'The task was not updated. Try again.';
      submit.disabled = false;
    }
  });
  body.appendChild(form);
  queueMicrotask(() => form.elements.content?.focus());
}

function renderTaskForm() {
  const body = drawerShell('Add a task', 'Capture');
  const form = document.createElement('form');
  form.className = 'task-form';
  form.innerHTML = `
    <label class="field-label" for="planner-task-title">Task</label>
    <input class="task-title-input" id="planner-task-title" name="content" autocomplete="off" required placeholder="What needs to happen?">
    <details class="task-details"><summary>Add details</summary>
      <div class="task-details-grid">
        <label class="field-label">Project<select class="field-input" name="project_id"></select></label>
        <label class="field-label">Due date<input class="field-input" type="date" name="due_date" value="${toLocalDateKey()}"></label>
        <label class="field-label">Priority<select class="field-input" name="priority"><option value="1">Normal</option><option value="2">Medium</option><option value="3">High</option><option value="4">Urgent</option></select></label>
      </div>
    </details>
    <p class="form-status" aria-live="polite"></p>
    <button class="primary-action" type="submit">Add task</button>`;
  const projectSelect = form.elements.project_id;
  projectSelect.append(new Option('Inbox', ''));
  for (const project of projects.values()) projectSelect.append(new Option(project.name, project.id));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    const status = form.querySelector('.form-status');
    submit.disabled = true;
    status.textContent = 'Adding task…';
    const data = new FormData(form);
    try {
      const task = buildCreateTaskPayload({
        content: data.get('content'),
        dueDate: data.get('due_date'),
        priority: data.get('priority')
      });
      if (data.get('project_id')) task.project_id = data.get('project_id');
      await todoist.createTask(task);
      await loadTaskData();
      openDrawer('tasks', activeDrawerTrigger);
    } catch (error) {
      console.error('Failed to create task:', error);
      status.textContent = 'The task was not added. Try again.';
      submit.disabled = false;
    }
  });
  body.appendChild(form);
  queueMicrotask(() => form.querySelector('input')?.focus());
}

async function renderScheduleDrawer() {
  const requestId = scheduleRequestGuard.begin();
  const body = drawerShell('Your schedule', 'Agenda');
  const nav = document.createElement('div');
  nav.className = 'schedule-nav';
  const previous = document.createElement('button');
  previous.type = 'button'; previous.textContent = 'Previous';
  const date = document.createElement('input');
  date.type = 'date'; date.value = selectedScheduleDate; date.setAttribute('aria-label', 'Schedule date');
  const next = document.createElement('button');
  next.type = 'button'; next.textContent = 'Next';
  const today = document.createElement('button');
  today.type = 'button'; today.textContent = 'Today';
  const changeDate = value => { selectedScheduleDate = value; renderScheduleDrawer(); };
  previous.addEventListener('click', () => changeDate(addLocalDays(selectedScheduleDate, -1)));
  next.addEventListener('click', () => changeDate(addLocalDays(selectedScheduleDate, 1)));
  today.addEventListener('click', () => changeDate(toLocalDateKey()));
  date.addEventListener('change', () => changeDate(date.value));
  nav.append(previous, date, next, today);
  const status = document.createElement('p'); status.className = 'drawer-loading'; status.textContent = 'Loading schedule…';
  const list = document.createElement('ul'); list.className = 'planner-drawer-list';
  body.append(nav, status, list);
  try {
    const payload = await getPlannerEvents(selectedScheduleDate);
    if (!scheduleRequestGuard.isLatest(requestId) || element('planner-drawer')?.dataset.mode !== 'schedule') return;
    status.textContent = payload.disconnected
      ? 'Your Calendar connection expired. Reconnect from the homepage to refresh it.'
      : payload.stale ? 'Showing saved schedule.'
        : payload.partial ? 'Some calendars are unavailable.' : '';
    const count = renderEventList(list, payload.events, { onOpen: event => openEventDetail(event) });
    if (selectedScheduleDate === toLocalDateKey() && count) {
      const marker = document.createElement('li');
      marker.className = 'schedule-now-marker';
      marker.textContent = `Now · ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      const nextRow = [...list.children].find(row => row.dataset.start && new Date(row.dataset.start) >= new Date());
      list.insertBefore(marker, nextRow || null);
    }
    if (!count && !payload.disconnected && !payload.partial) status.textContent = 'Nothing scheduled for this day.';
  } catch (error) {
    if (!scheduleRequestGuard.isLatest(requestId) || element('planner-drawer')?.dataset.mode !== 'schedule') return;
    console.error('Failed to load schedule:', error);
    status.textContent = 'Schedule is unavailable.';
  }
}

function openEventDetail(event, trigger) {
  openDrawer('event', trigger);
  const body = drawerShell(event.title, 'Event');
  const meta = document.createElement('dl');
  meta.className = 'event-detail-list';
  const add = (term, value) => {
    if (!value) return;
    const dt = document.createElement('dt'); dt.textContent = term;
    const dd = document.createElement('dd'); dd.textContent = value;
    meta.append(dt, dd);
  };
  add('When', formatEventTime(event));
  add('Calendar', event.calendarName);
  add('Location', event.location);
  body.appendChild(meta);
  const actions = document.createElement('div'); actions.className = 'event-detail-actions';
  const meeting = getMeetingUrl(event);
  const calendar = safeExternalUrl(event.htmlLink);
  for (const [url, label] of [[meeting, 'Join meeting'], [calendar, 'Open in Google Calendar']]) {
    if (!url) continue;
    const link = document.createElement('a'); link.className = 'primary-action'; link.href = url; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = label;
    actions.appendChild(link);
  }
  body.appendChild(actions);
}

function setupDrawer() {
  element('planner-drawer-close')?.addEventListener('click', closeDrawer);
  element('planner-drawer-backdrop')?.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', event => {
    const drawer = element('planner-drawer');
    if (drawer?.classList.contains('hidden')) return;
    if (event.key === 'Escape') closeDrawer();
    if (event.key === 'Tab') {
      const focusable = [...drawer.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), summary, [tabindex="0"]')];
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
}

function setupActions() {
  element('view-tasks-btn')?.addEventListener('click', event => openDrawer('tasks', event.currentTarget));
  element('add-task-btn')?.addEventListener('click', event => openDrawer('add', event.currentTarget));
  element('view-schedule-btn')?.addEventListener('click', event => openDrawer('schedule', event.currentTarget));
  element('todos-connect-btn')?.addEventListener('click', async () => { await todoist.authenticate(); await loadTaskData(); });
  element('calendar-connect-btn')?.addEventListener('click', async () => { await api.sendRuntimeMessage({ type: 'CONNECT_GOOGLE_CALENDAR' }); await loadCalendarData({ force: true, recenter: true }); });
  const viewport = element('timeline-viewport');
  const backToNow = element('back-to-now-btn');
  const anchorTimeline = () => {
    timelineUserAnchored = true;
    backToNow?.classList.remove('hidden');
  };
  viewport?.addEventListener('wheel', anchorTimeline, { passive: true });
  viewport?.addEventListener('touchstart', anchorTimeline, { passive: true });
  viewport?.addEventListener('pointerdown', event => {
    if (event.target === viewport) anchorTimeline();
  }, { passive: true });
  viewport?.addEventListener('keydown', event => {
    if (event.key === ' ' && event.target.closest?.('.timeline-event-button')) return;
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) anchorTimeline();
  });
  viewport?.addEventListener('focusout', event => {
    const drawerOpen = !element('planner-drawer')?.classList.contains('hidden');
    if (!pendingTimelineRecenter || drawerOpen || viewport.contains(event.relatedTarget)) return;
    pendingTimelineRecenter = false;
    requestAnimationFrame(() => centerTimelineOnNow(viewport, element('timeline-list')?.querySelector('[data-timeline-now="true"]')));
  });
  backToNow?.addEventListener('click', () => {
    timelineUserAnchored = false;
    backToNow.classList.add('hidden');
    centerTimelineOnNow(viewport, element('timeline-list')?.querySelector('[data-timeline-now="true"]'));
  });
}

export function initPlannerDashboard(options) {
  if (plannerStarted) return;
  plannerStarted = true;
  api = options;
  setupDrawer();
  setupActions();
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
    element('back-to-now-btn')?.classList.add('hidden');
  }
  if ((loadedCalendarDate && loadedCalendarDate !== today) || (lastCalendarAttemptDate && lastCalendarAttemptDate !== today)) {
    loadedCalendarDate = '';
    todayEvents = [];
    lastCalendarAttemptAt = 0;
    lastCalendarAttemptDate = '';
    timelineUserAnchored = false;
    element('back-to-now-btn')?.classList.add('hidden');
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
