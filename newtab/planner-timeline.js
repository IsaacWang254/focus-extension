import { buildDayTimeline } from './planner-model.js';

function eventAccessibleLabel(descriptor) {
  return [
    descriptor.title,
    descriptor.accessibleTimeText,
    descriptor.calendarName,
    descriptor.state === 'current' ? 'In progress' : ''
  ].filter(Boolean).join(', ');
}

function createTimedRow(descriptor, onOpen) {
  const item = document.createElement('li');
  item.className = 'timeline-event';
  item.dataset.eventKey = descriptor.key;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'timeline-event-button';
  button.addEventListener('click', () => onOpen?.(button._event, button));

  const time = document.createElement('span');
  time.className = 'timeline-event-time';
  const marker = document.createElement('span');
  marker.className = 'timeline-event-marker';
  marker.setAttribute('aria-hidden', 'true');
  const copy = document.createElement('span');
  copy.className = 'timeline-event-copy';
  const title = document.createElement('span');
  title.className = 'timeline-event-title';
  const state = document.createElement('span');
  state.className = 'timeline-event-state';
  const meta = document.createElement('span');
  meta.className = 'timeline-event-meta';
  copy.append(title, state, meta);
  button.append(time, marker, copy);
  item.appendChild(button);
  return item;
}

function updateTimedRow(item, descriptor) {
  item.className = `timeline-event is-${descriptor.state}`;
  item.style.setProperty('--event-color', descriptor.color);
  item.style.setProperty('--past-opacity', String(descriptor.pastFade));
  const button = item.querySelector('.timeline-event-button');
  button._event = descriptor.event;
  button.setAttribute('aria-label', eventAccessibleLabel(descriptor));
  item.querySelector('.timeline-event-time').textContent = descriptor.timeText;
  item.querySelector('.timeline-event-title').textContent = descriptor.title;
  item.querySelector('.timeline-event-state').textContent = descriptor.state === 'current' ? 'In progress' : '';
  item.querySelector('.timeline-event-meta').textContent = descriptor.calendarName || '';
}

function createNowMarker(label) {
  const marker = document.createElement('li');
  marker.className = 'timeline-now';
  marker.dataset.timelineNow = 'true';
  marker.innerHTML = '<span class="timeline-now-label"></span><span class="timeline-now-dot" aria-hidden="true"></span><span class="timeline-now-rule" aria-hidden="true"></span>';
  marker.querySelector('.timeline-now-label').textContent = label;
  return marker;
}

function renderAllDay(container, descriptors, onOpen) {
  container.innerHTML = '';
  container.classList.toggle('hidden', descriptors.length === 0);
  if (!descriptors.length) return;
  const label = document.createElement('p');
  label.className = 'timeline-all-day-label';
  label.textContent = 'All day';
  const list = document.createElement('ul');
  list.className = 'timeline-all-day-list';
  for (const descriptor of descriptors) {
    const item = document.createElement('li');
    item.className = 'timeline-all-day-event';
    item.style.setProperty('--event-color', descriptor.color);
    const marker = document.createElement('span');
    marker.className = 'timeline-event-marker';
    marker.setAttribute('aria-hidden', 'true');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = descriptor.title;
    button.setAttribute('aria-label', eventAccessibleLabel(descriptor));
    button.addEventListener('click', () => onOpen?.(descriptor.event, button));
    item.append(marker, button);
    list.appendChild(item);
  }
  container.append(label, list);
}

export function renderDayTimeline(elements, events, options = {}) {
  const now = options.now || new Date();
  const model = buildDayTimeline(events, options.date, now);
  const existing = new Map(
    [...elements.list.querySelectorAll('.timeline-event[data-event-key]')]
      .map(item => [item.dataset.eventKey, item])
  );
  const fragment = document.createDocumentFragment();
  let marker = null;

  for (const row of [...model.rows, ...model.unavailable]) {
    if (row.type === 'now-marker') {
      marker = createNowMarker(row.label);
      fragment.appendChild(marker);
      continue;
    }
    const item = existing.get(row.key) || createTimedRow(row, options.onOpen);
    updateTimedRow(item, row);
    fragment.appendChild(item);
    existing.delete(row.key);
  }
  elements.list.replaceChildren(fragment);
  renderAllDay(elements.allDay, model.allDay, options.onOpen);

  const hasEvents = model.allDay.length + model.timed.length + model.unavailable.length > 0;
  elements.empty.classList.toggle('hidden', hasEvents || options.hasStatus);
  elements.viewport.classList.toggle('hidden', !hasEvents);
  return { model, marker, hasEvents };
}

export function centerTimelineOnNow(viewport, marker) {
  if (!viewport || !marker) return;
  const markerTop = marker.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
  const target = Math.max(0, markerTop - viewport.clientHeight * 0.4);
  viewport.scrollTop = target;
}
