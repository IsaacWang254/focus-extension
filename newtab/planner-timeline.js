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

function reconcileChildren(parent, desired, removableSelector) {
  let cursor = parent.firstChild;
  for (const node of desired) {
    if (node !== cursor) parent.insertBefore(node, cursor);
    cursor = node.nextSibling;
  }
  for (const node of [...parent.querySelectorAll(removableSelector)]) {
    if (!desired.includes(node)) node.remove();
  }
}

function renderAllDay(container, descriptors, onOpen) {
  container.classList.toggle('hidden', descriptors.length === 0);
  let label = container.querySelector('.timeline-all-day-label');
  let list = container.querySelector('.timeline-all-day-list');
  if (!label) {
    label = document.createElement('p');
    label.className = 'timeline-all-day-label';
    label.textContent = 'All day';
    container.appendChild(label);
  }
  if (!list) {
    list = document.createElement('ul');
    list.className = 'timeline-all-day-list';
    container.appendChild(list);
  }
  const existing = new Map(
    [...list.querySelectorAll('.timeline-all-day-event[data-event-key]')]
      .map(item => [item.dataset.eventKey, item])
  );
  const desired = [];
  for (const descriptor of descriptors) {
    let item = existing.get(descriptor.key);
    if (!item) {
      item = document.createElement('li');
      item.className = 'timeline-all-day-event';
      item.dataset.eventKey = descriptor.key;
      const marker = document.createElement('span');
      marker.className = 'timeline-event-marker';
      marker.setAttribute('aria-hidden', 'true');
      const button = document.createElement('button');
      button.type = 'button';
      button.addEventListener('click', () => onOpen?.(button._event, button));
      item.append(marker, button);
    }
    item.style.setProperty('--event-color', descriptor.color);
    const button = item.querySelector('button');
    button._event = descriptor.event;
    button.textContent = descriptor.title;
    button.setAttribute('aria-label', eventAccessibleLabel(descriptor));
    desired.push(item);
  }
  reconcileChildren(list, desired, '.timeline-all-day-event[data-event-key]');
}

export function renderDayTimeline(elements, events, options = {}) {
  const now = options.now || new Date();
  const model = buildDayTimeline(events, options.date, now);
  const existing = new Map(
    [...elements.list.querySelectorAll('.timeline-event[data-event-key]')]
      .map(item => [item.dataset.eventKey, item])
  );
  const desired = [];
  let marker = elements.list.querySelector('[data-timeline-now="true"]');

  for (const row of [...model.rows, ...model.unavailable]) {
    if (row.type === 'now-marker') {
      if (!marker) marker = createNowMarker(row.label);
      marker.querySelector('.timeline-now-label').textContent = row.label;
      desired.push(marker);
      continue;
    }
    const item = existing.get(row.key) || createTimedRow(row, options.onOpen);
    updateTimedRow(item, row);
    desired.push(item);
    existing.delete(row.key);
  }
  reconcileChildren(elements.list, desired, '.timeline-event[data-event-key], [data-timeline-now="true"]');
  renderAllDay(elements.allDay, model.allDay, options.onOpen);

  const hasEvents = model.allDay.length + model.timed.length + model.unavailable.length > 0;
  elements.empty.classList.toggle('hidden', hasEvents || options.hasStatus);
  elements.viewport.classList.toggle('hidden', !hasEvents && options.hasStatus);
  return { model, marker, hasEvents };
}

export function centerTimelineOnNow(viewport, marker) {
  if (!viewport || !marker) return;
  const markerTop = marker.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
  const target = Math.max(0, markerTop - viewport.clientHeight * 0.4);
  viewport.scrollTop = target;
}
