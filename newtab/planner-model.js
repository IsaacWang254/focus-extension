const DAY_MS = 24 * 60 * 60 * 1000;
export const TIMELINE_PAST_FADE_FLOOR = 0.85;
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

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

function validDateParts(year, month, day) {
  return month >= 1 && month <= 12 && day >= 1 && day <= new Date(year, month, 0).getDate();
}

function validTimeParts(hour, minute, second) {
  return hour >= 0 && hour < 24 && minute >= 0 && minute < 60 && second >= 0 && second < 60;
}

function parseOffsetInstant(match) {
  const [, y, mo, d, h, mi, s, offset] = match;
  const year = Number(y), month = Number(mo), day = Number(d);
  const hour = Number(h), minute = Number(mi), second = Number(s || 0);
  if (!validDateParts(year, month, day) || !validTimeParts(hour, minute, second)) return NaN;
  let ms = Date.UTC(year, month - 1, day, hour, minute, second);
  if (offset && offset !== 'Z') {
    const sign = offset[0] === '-' ? -1 : 1;
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(-2));
    if (offsetHour > 23 || offsetMinute > 59) return NaN;
    ms -= sign * (offsetHour * 60 + offsetMinute) * 60000;
  }
  return ms;
}

function timedDeadline(instantMs) {
  return { kind: 'timed', localDate: toLocalDateKey(new Date(instantMs)), instantMs, sortMs: instantMs };
}

/**
 * Parse a Todoist due value into a deadline descriptor. `due.datetime` (or a
 * timestamp-valued `due.date`) with an explicit offset/Z is an absolute instant;
 * an offset-free timestamp in `due.date` is floating browser-local time; a
 * date-only `due.date` sorts at the next browser-local midnight. Anything
 * unresolvable — including offset-free `due.datetime` and nonexistent local
 * times — is `{ kind: 'none' }`, never a sliced date fallback.
 */
export function parseTaskDeadline(task) {
  const due = task?.due;
  if (!due) return { kind: 'none' };
  const none = { kind: 'none' };

  const datetime = typeof due.datetime === 'string' ? due.datetime.trim() : '';
  if (datetime) {
    const match = TIMESTAMP_RE.exec(datetime);
    if (!match || !match[7]) return none;
    const instantMs = parseOffsetInstant(match);
    return Number.isFinite(instantMs) ? timedDeadline(instantMs) : none;
  }

  const date = typeof due.date === 'string' ? due.date.trim() : '';
  if (!date) return none;
  const timed = TIMESTAMP_RE.exec(date);
  if (timed) {
    if (timed[7]) {
      const instantMs = parseOffsetInstant(timed);
      return Number.isFinite(instantMs) ? timedDeadline(instantMs) : none;
    }
    const year = Number(timed[1]), month = Number(timed[2]), day = Number(timed[3]);
    const hour = Number(timed[4]), minute = Number(timed[5]), second = Number(timed[6] || 0);
    if (!validDateParts(year, month, day) || !validTimeParts(hour, minute, second)) return none;
    const local = new Date(year, month - 1, day, hour, minute, second);
    const roundTrips = local.getFullYear() === year && local.getMonth() === month - 1
      && local.getDate() === day && local.getHours() === hour
      && local.getMinutes() === minute && local.getSeconds() === second;
    if (!roundTrips) return none;
    return timedDeadline(local.getTime());
  }

  const dateOnly = DATE_ONLY_RE.exec(date);
  if (dateOnly) {
    const year = Number(dateOnly[1]), month = Number(dateOnly[2]), day = Number(dateOnly[3]);
    if (!validDateParts(year, month, day)) return none;
    const boundary = new Date(year, month - 1, day);
    boundary.setDate(boundary.getDate() + 1);
    return { kind: 'date', localDate: `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`, sortMs: boundary.getTime() };
  }
  return none;
}

function taskPriorityValue(task) {
  const value = Number(task?.priority);
  return Number.isFinite(value) ? value : 1;
}

/**
 * Homepage ordering: deadline first. Dated tasks at or before today, then dated
 * future tasks, then undated/unusable deadlines. Within dated partitions: local
 * date, then the actual deadline instant (timed before date-only on one date),
 * then priority, then a stable id tiebreak — never provider order.
 */
export function rankSuggestedTasks(tasks = [], now = new Date()) {
  const today = toLocalDateKey(now);
  const partition = deadline => deadline.kind === 'none' ? 2 : (deadline.localDate <= today ? 0 : 1);
  return flattenTasks(tasks)
    .map(task => ({ task, deadline: parseTaskDeadline(task) }))
    .sort((a, b) => {
      const partitionDiff = partition(a.deadline) - partition(b.deadline);
      if (partitionDiff) return partitionDiff;
      if (a.deadline.kind !== 'none' && b.deadline.kind !== 'none') {
        if (a.deadline.localDate !== b.deadline.localDate) {
          return a.deadline.localDate < b.deadline.localDate ? -1 : 1;
        }
        if (a.deadline.sortMs !== b.deadline.sortMs) return a.deadline.sortMs - b.deadline.sortMs;
      }
      const priorityDiff = taskPriorityValue(b.task) - taskPriorityValue(a.task);
      if (priorityDiff) return priorityDiff;
      const aId = String(a.task.id);
      const bId = String(b.task.id);
      return aId < bId ? -1 : aId > bId ? 1 : 0;
    })
    .map(entry => entry.task);
}

export function selectHomepageTasks(tasks = [], overrideId = '', now = new Date(), limit = 3) {
  const ranked = rankSuggestedTasks(tasks, now);
  let currentIsOverride = false;
  if (overrideId !== '' && overrideId != null) {
    const index = ranked.findIndex(task => String(task.id) === String(overrideId));
    if (index >= 0) {
      ranked.unshift(ranked.splice(index, 1)[0]);
      currentIsOverride = true;
    }
  }
  return { tasks: ranked.slice(0, limit), currentIsOverride };
}

export function selectNowTask(tasks = [], overrideId = '', now = new Date()) {
  return selectHomepageTasks(tasks, overrideId, now).tasks[0] || null;
}

/**
 * Position `buildDayTimeline()` output on a proportional canvas scaled by
 * pxPerMinute. Day bounds come from local calendar dates (`setDate`), so
 * minutes are real elapsed minutes and day length can be 1380/1410/1440/1500.
 */
export function layoutDayGrid(timeline, { pxPerMinute } = {}) {
  const scale = Number(pxPerMinute);
  const result = {
    date: timeline?.date || '',
    dayStartMs: 0,
    dayEndMs: 0,
    durationMinutes: 0,
    height: 0,
    ticks: [],
    events: [],
    groups: [],
    marker: null
  };
  const dayStart = parseLocalDate(result.date);
  if (!dayStart || !Number.isFinite(scale)) return result;
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  result.dayStartMs = dayStart.getTime();
  result.dayEndMs = dayEnd.getTime();
  result.durationMinutes = (result.dayEndMs - result.dayStartMs) / 60000;
  result.height = result.durationMinutes * scale;

  const zoneFormat = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' });
  const offsetLabel = ms => zoneFormat.formatToParts(new Date(ms)).find(part => part.type === 'timeZoneName')?.value || '';
  for (let ms = result.dayStartMs; ms < result.dayEndMs; ms += 60000) {
    const tick = new Date(ms);
    if (tick.getMinutes() || tick.getSeconds() || tick.getMilliseconds()) continue;
    result.ticks.push({
      ms,
      topMinutes: (ms - result.dayStartMs) / 60000,
      top: (ms - result.dayStartMs) / 60000 * scale,
      label: tick.toLocaleTimeString([], { hour: 'numeric' }),
      offsetLabel: offsetLabel(ms)
    });
  }
  const labelCounts = new Map();
  for (const tick of result.ticks) labelCounts.set(tick.label, (labelCounts.get(tick.label) || 0) + 1);
  for (const tick of result.ticks) if (labelCounts.get(tick.label) === 1) tick.offsetLabel = '';

  const events = (timeline?.timed || [])
    .filter(event => event.hasValidInterval && event.startDate && event.endDate)
    .map(event => {
      const clippedStartMs = Math.max(event.startDate.getTime(), result.dayStartMs);
      const clippedEndMs = Math.min(event.endDate.getTime(), result.dayEndMs);
      return {
        ...event,
        clippedStartMs,
        clippedEndMs,
        continuesBefore: event.startDate.getTime() < result.dayStartMs,
        continuesAfter: event.endDate.getTime() > result.dayEndMs
      };
    })
    .filter(event => event.clippedEndMs > event.clippedStartMs)
    .sort((a, b) => a.clippedStartMs - b.clippedStartMs
      || a.clippedEndMs - b.clippedEndMs
      || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const groups = [];
  let group = null;
  for (const event of events) {
    if (!group || event.clippedStartMs >= group.end) {
      group = { id: groups.length, end: event.clippedEndMs, laneEnds: [], members: [] };
      groups.push(group);
    } else {
      group.end = Math.max(group.end, event.clippedEndMs);
    }
    let lane = group.laneEnds.findIndex(end => end <= event.clippedStartMs);
    if (lane === -1) {
      lane = group.laneEnds.length;
      group.laneEnds.push(event.clippedEndMs);
    } else {
      group.laneEnds[lane] = event.clippedEndMs;
    }
    event.lane = lane;
    event.overlapGroup = group.id;
    group.members.push(event);
  }

  for (const current of groups) {
    const laneCount = current.laneEnds.length;
    result.groups.push({ id: current.id, laneCount, keys: current.members.map(member => member.key) });
    for (const event of current.members) {
      event.laneCount = laneCount;
      let laneSpan = 1;
      for (let lane = event.lane + 1; lane < laneCount; lane += 1) {
        const conflict = current.members.some(other => other.lane === lane
          && other.clippedStartMs < event.clippedEndMs
          && other.clippedEndMs > event.clippedStartMs);
        if (conflict) break;
        laneSpan += 1;
      }
      event.laneSpan = laneSpan;
      event.topMinutes = (event.clippedStartMs - result.dayStartMs) / 60000;
      event.durationMinutes = (event.clippedEndMs - event.clippedStartMs) / 60000;
      event.top = event.topMinutes * scale;
      event.height = event.durationMinutes * scale;
    }
  }
  result.events = events;

  const nowDate = timeline?.marker?.now;
  const nowMs = nowDate instanceof Date ? nowDate.getTime() : NaN;
  if (Number.isFinite(nowMs) && nowMs >= result.dayStartMs && nowMs < result.dayEndMs) {
    const minutes = (nowMs - result.dayStartMs) / 60000;
    result.marker = { minutes, top: minutes * scale, label: timeline.marker.label };
  }
  return result;
}

export function normalizeEvents(events = []) {
  return events.map(event => ({
    ...event,
    title: event.title || event.summary || 'Untitled event',
    start: event.start?.dateTime || event.start?.date || event.start,
    end: event.end?.dateTime || event.end?.date || event.end,
    isAllDay: event.isAllDay ?? Boolean(event.start?.date && !event.start?.dateTime)
  })).filter(event => event.start || event.end || event.id || event.title || event.summary);
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
    else if (descriptor.hasValidInterval) result.timed.push(descriptor);
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
