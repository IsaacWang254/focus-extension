const DAY_MS = 24 * 60 * 60 * 1000;
export const TIMELINE_PAST_FADE_FLOOR = 0.7;
export const TIMELINE_NEUTRAL_COLOR = '#73736c';

export function toLocalDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function addLocalDays(dateKey, amount) {
  const date = parseLocalDate(dateKey);
  if (!date) return '';
  date.setDate(date.getDate() + amount);
  return toLocalDateKey(date);
}

export function parseLocalDate(dateKey) {
  if (typeof dateKey !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return toLocalDateKey(date) === dateKey ? date : null;
}

export function flattenTasks(tasks = []) {
  const result = [];
  const visit = (task, parent = null) => {
    if (!task || !task.id) return;
    result.push({ ...task, parentContent: task.parentContent || parent?.content || '' });
    for (const child of task.subtasks || []) visit(child, task);
  };
  for (const task of tasks) visit(task);
  return result;
}

export function getTaskDueKey(task) {
  const raw = task?.due?.datetime || task?.due?.date || '';
  if (typeof raw !== 'string') return '';
  if (raw.includes('T')) return toLocalDateKey(new Date(raw));
  return raw.slice(0, 10);
}

export function rankTasks(tasks = [], now = new Date()) {
  const today = toLocalDateKey(now);
  return [...tasks].sort((a, b) => {
    const aDue = getTaskDueKey(a);
    const bDue = getTaskDueKey(b);
    const bucket = due => !due ? 3 : due < today ? 0 : due === today ? 1 : 2;
    const bucketDiff = bucket(aDue) - bucket(bDue);
    if (bucketDiff) return bucketDiff;
    const priorityDiff = Number(b.priority || 1) - Number(a.priority || 1);
    if (priorityDiff) return priorityDiff;
    if (aDue !== bDue) return aDue.localeCompare(bDue);
    return Number(a.order || 0) - Number(b.order || 0);
  });
}

export function groupTasks(tasks = [], view = 'day', selectedDate = toLocalDateKey()) {
  const flat = rankTasks(flattenTasks(tasks), parseLocalDate(selectedDate) || new Date());
  if (view === 'all') return [{ key: 'all', label: 'All tasks', tasks: flat }];

  if (view === 'upcoming') {
    const end = addLocalDays(selectedDate, 6);
    const byDate = new Map();
    for (const task of flat) {
      const due = getTaskDueKey(task);
      if (!due || due < selectedDate || due > end) continue;
      if (!byDate.has(due)) byDate.set(due, []);
      byDate.get(due).push(task);
    }
    return [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([key, grouped]) => ({
      key,
      label: parseLocalDate(key)?.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) || key,
      tasks: grouped
    }));
  }

  const overdue = flat.filter(task => getTaskDueKey(task) && getTaskDueKey(task) < selectedDate);
  const due = flat.filter(task => getTaskDueKey(task) === selectedDate);
  return [
    ...(overdue.length ? [{ key: 'overdue', label: 'Overdue', tasks: overdue }] : []),
    { key: selectedDate, label: selectedDate === toLocalDateKey() ? 'Today' : 'Selected day', tasks: due }
  ];
}

export function selectNowTask(tasks = [], storedTaskId = '', now = new Date()) {
  const ranked = rankTasks(flattenTasks(tasks), now);
  const stored = ranked.find(task => String(task.id) === String(storedTaskId));
  if (stored) return stored;
  const today = toLocalDateKey(now);
  return ranked.find(task => {
    const due = getTaskDueKey(task);
    return due && due <= today;
  }) || null;
}

export function normalizeEvents(events = []) {
  return events.map(event => ({
    ...event,
    title: event.title || event.summary || 'Untitled event',
    start: event.start?.dateTime || event.start?.date || event.start,
    end: event.end?.dateTime || event.end?.date || event.end,
    isAllDay: event.isAllDay ?? Boolean(event.start?.date && !event.start?.dateTime)
  })).filter(event => event.start);
}

export function validateProviderColor(value, fallback = TIMELINE_NEUTRAL_COLOR) {
  const color = typeof value === 'string' ? value.trim() : '';
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function eventValue(event, key) {
  const value = event?.[key];
  if (value && typeof value === 'object') return value.dateTime || value.date || '';
  return typeof value === 'string' ? value : '';
}

function eventIsAllDay(event) {
  return event?.isAllDay ?? Boolean(event?.start?.date && !event?.start?.dateTime);
}

function parseEventDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isDateKey(value) {
  return Boolean(parseLocalDate(value));
}

function timelineEventKey(event, start) {
  return [event?.calendarId || '', event?.id || '', start || ''].map(String).join('\u0000');
}

function compareTimelineIdentity(a, b) {
  return String(a.event.calendarId || '').localeCompare(String(b.event.calendarId || '')) ||
    String(a.event.id || '').localeCompare(String(b.event.id || '')) ||
    String(a.start || '').localeCompare(String(b.start || ''));
}

function formatTimelineClock(date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function relativeTimelineDate(date, localDate) {
  const key = toLocalDateKey(date);
  if (key === localDate) return 'Today';
  if (key === addLocalDays(localDate, -1)) return 'Yesterday';
  if (key === addLocalDays(localDate, 1)) return 'Tomorrow';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatTimelineTimeRange(startDate, endDate, localDate, validInterval) {
  if (!startDate) return 'Time unavailable';
  const startText = formatTimelineClock(startDate);
  if (!validInterval) return `${startText} · End time unavailable`;
  const endText = formatTimelineClock(endDate);
  if (toLocalDateKey(startDate) === toLocalDateKey(endDate)) return `${startText}–${endText}`;
  return `${relativeTimelineDate(startDate, localDate)} · ${startText}–${relativeTimelineDate(endDate, localDate)} · ${endText}`;
}

function timelineEventDescriptor(event, localDate, now, dayStart, dayEnd, fadeFloor) {
  const start = eventValue(event, 'start');
  const end = eventValue(event, 'end');
  const isAllDay = eventIsAllDay(event);
  const descriptor = {
    key: timelineEventKey(event, start),
    event,
    id: event?.id || '',
    calendarId: event?.calendarId || '',
    calendarName: event?.calendarName || '',
    title: event?.title || event?.summary || 'Untitled event',
    start,
    end,
    isAllDay,
    color: validateProviderColor(event?.color),
    state: 'unknown',
    startDate: null,
    endDate: null,
    hasValidInterval: false,
    pastFade: 1,
    timeText: 'Time unavailable',
    accessibleTimeText: 'Time unavailable'
  };

  if (isAllDay) {
    const startDate = typeof start === 'string' ? start.slice(0, 10) : '';
    const endDate = typeof end === 'string' ? end.slice(0, 10) : '';
    if (!isDateKey(startDate)) return descriptor;
    descriptor.hasValidInterval = isDateKey(endDate) && endDate > startDate;
    if (descriptor.hasValidInterval && (startDate > localDate || endDate <= localDate)) return null;
    if (!descriptor.hasValidInterval && startDate !== localDate) return null;
    descriptor.state = 'all-day';
    descriptor.timeText = 'All day';
    descriptor.accessibleTimeText = `All day${descriptor.hasValidInterval ? '' : ' · End date unavailable'}`;
    return descriptor;
  }

  const startDate = parseEventDate(start);
  const endDate = parseEventDate(end);
  descriptor.startDate = startDate;
  descriptor.endDate = endDate;
  descriptor.hasValidInterval = Boolean(startDate && endDate && endDate > startDate);
  descriptor.timeText = formatTimelineTimeRange(startDate, endDate, localDate, descriptor.hasValidInterval);
  descriptor.accessibleTimeText = descriptor.timeText;

  if (!startDate) return descriptor;
  if (descriptor.hasValidInterval && (startDate >= dayEnd || endDate <= dayStart)) return null;
  if (!descriptor.hasValidInterval && (startDate < dayStart || startDate >= dayEnd)) return null;

  if (!descriptor.hasValidInterval || !now) return descriptor;
  if (now < startDate) {
    descriptor.state = 'future';
  } else if (now < endDate) {
    descriptor.state = 'current';
  } else {
    descriptor.state = 'past';
    const age = Math.max(0, Math.min(1, (now.getTime() - endDate.getTime()) / (2 * 60 * 60 * 1000)));
    descriptor.pastFade = 1 - (1 - fadeFloor) * age;
  }
  return descriptor;
}

/**
 * Build render-ready descriptors for one browser-local Calendar day.
 * The caller supplies both the day key and now so minute updates stay local
 * and deterministic without consulting provider data or the system clock.
 */
export function buildDayTimeline(events = [], localDate, now, options = {}) {
  const dayStart = parseLocalDate(localDate);
  const nowDate = now instanceof Date && !Number.isNaN(now.getTime()) ? now : null;
  const fadeFloor = Math.max(TIMELINE_PAST_FADE_FLOOR, Math.min(1, Number(options.pastFadeFloor) || TIMELINE_PAST_FADE_FLOOR));
  const result = {
    date: localDate,
    allDay: [],
    timed: [],
    unavailable: [],
    rows: [],
    marker: { index: 0, label: nowDate ? `Now · ${formatTimelineClock(nowDate)}` : 'Now', now: nowDate }
  };
  if (!dayStart) return result;

  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  for (const event of events || []) {
    const descriptor = timelineEventDescriptor(event, localDate, nowDate, dayStart, dayEnd, fadeFloor);
    if (!descriptor) continue;
    if (descriptor.state === 'all-day') result.allDay.push(descriptor);
    else if (descriptor.startDate) result.timed.push(descriptor);
    else result.unavailable.push(descriptor);
  }

  result.allDay.sort(compareTimelineIdentity);
  result.timed.sort((a, b) => a.startDate - b.startDate || compareTimelineIdentity(a, b));
  result.unavailable.sort(compareTimelineIdentity);
  result.marker.index = nowDate ? result.timed.filter(row => row.startDate <= nowDate).length : 0;
  result.rows = [
    ...result.timed.slice(0, result.marker.index),
    { type: 'now-marker', key: 'now-marker', label: result.marker.label, now: nowDate },
    ...result.timed.slice(result.marker.index)
  ];
  return result;
}

export function selectCurrentEvents(events = [], now = new Date()) {
  return normalizeEvents(events).filter(event => {
    if (event.isAllDay) return false;
    const start = new Date(event.start);
    const end = new Date(event.end);
    return !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start <= now && now < end;
  }).sort((a, b) => new Date(a.start) - new Date(b.start));
}

export function selectNextEvent(events = [], now = new Date()) {
  return normalizeEvents(events)
    .filter(event => !event.isAllDay && new Date(event.start) > now)
    .sort((a, b) => new Date(a.start) - new Date(b.start))[0] || null;
}

export function formatRelativeStart(event, now = new Date()) {
  if (!event?.start) return '';
  const start = new Date(event.start);
  const diff = start.getTime() - now.getTime();
  if (!Number.isFinite(diff)) return '';
  const minutes = Math.max(0, Math.round(diff / 60000));
  if (minutes < 60) return `in ${minutes} min`;
  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `in ${hours} hr ${remainder} min` : `in ${hours} hr`;
  }
  const days = Math.max(1, Math.round(diff / DAY_MS));
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

export function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}
