import { normalizeEvents, safeExternalUrl } from './planner-model.js';

export function formatEventTime(event) {
  if (event.isAllDay) return 'All day';
  const start = new Date(event.start);
  const end = new Date(event.end);
  if (Number.isNaN(start.getTime())) return '';
  const format = date => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return Number.isNaN(end.getTime()) ? format(start) : `${format(start)}–${format(end)}`;
}

export function getMeetingUrl(event) {
  const candidates = [event.meetingUrl, event.hangoutLink, event.htmlLink, ...(event.conferenceData?.entryPoints || []).map(point => point.uri)];
  return candidates.map(safeExternalUrl).find(Boolean) || '';
}

export function createEventRow(event, options = {}) {
  const item = document.createElement('li');
  item.className = 'planner-event-row';
  item.tabIndex = 0;

  const time = document.createElement('span');
  time.className = 'planner-event-time';
  time.textContent = formatEventTime(event);

  const copy = document.createElement('div');
  copy.className = 'planner-row-copy';
  const title = document.createElement('span');
  title.className = 'planner-row-title';
  title.textContent = event.title;
  copy.appendChild(title);
  if (event.calendarName || event.location) {
    const meta = document.createElement('span');
    meta.className = 'planner-row-meta';
    meta.textContent = [event.calendarName, event.location].filter(Boolean).join(' · ');
    copy.appendChild(meta);
  }

  const open = () => options.onOpen?.(event);
  item.addEventListener('click', open);
  item.addEventListener('keydown', keyboardEvent => {
    if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
      keyboardEvent.preventDefault();
      open();
    }
  });
  item.append(time, copy);
  return item;
}

export function renderEventList(container, events, options = {}) {
  container.innerHTML = '';
  const normalized = normalizeEvents(events).sort((a, b) => {
    if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1;
    return new Date(a.start) - new Date(b.start);
  });
  for (const event of normalized) container.appendChild(createEventRow(event, options));
  return normalized.length;
}
