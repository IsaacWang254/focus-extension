const DAY_MS = 24 * 60 * 60 * 1000;

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
