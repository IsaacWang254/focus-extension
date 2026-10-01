import { buildDayTimeline, layoutDayGrid, safeExternalUrl } from './planner-model.js';
import { eventColors } from './planner-color.js';
import { createIconButton, createIconLink } from './planner-controls.js';

const PX_PER_MINUTE = 64 / 60;
const RAIL_MIN_WIDTH = 812; // assumed width when the viewport cannot be measured (tests, hidden tabs)

function iconMarkup(name) {
  return globalThis.Icons?.[name] || '';
}

function currentTheme() {
  return document.documentElement?.dataset?.theme?.endsWith('dark') ? 'dark' : 'light';
}

function eventAccessibleLabel(descriptor) {
  return [
    descriptor.title,
    descriptor.accessibleTimeText,
    descriptor.calendarName,
    descriptor.state === 'current' ? 'In progress' : ''
  ].filter(Boolean).join(', ');
}

function visibleHint(item) {
  let hint = item.querySelector('.blk-sr');
  if (!hint) {
    hint = document.createElement('span');
    hint.className = 'blk-sr visually-hidden';
    item.appendChild(hint);
  }
  return hint;
}

function reconcileChildren(parent, desired, removableSelector) {
  for (const node of [...parent.querySelectorAll(removableSelector)]) {
    if (!desired.includes(node)) node.remove();
  }
  let cursor = parent.firstChild;
  for (const node of desired) {
    if (node !== cursor) parent.insertBefore(node, cursor);
    cursor = node.nextSibling;
  }
}

// Open control = a real link to the event in Google Calendar. No safe htmlLink
// → no control at all.
function createOpenLink(descriptor, { compact = true } = {}) {
  const href = safeExternalUrl(descriptor.event?.htmlLink);
  if (!href) return null;
  const link = createIconLink({
    icon: iconMarkup('arrowUpRight'),
    label: `Open ${descriptor.title} in Google Calendar (opens in new tab)`,
    tooltip: 'Open in Google Calendar',
    className: `icon-action--reveal${compact ? ' icon-action--compact' : ''}`,
    href
  });
  link.dataset.tooltipSide = 'left';
  return link;
}

function syncOpenLink(open, descriptor) {
  if (!open) return;
  open.href = safeExternalUrl(descriptor.event?.htmlLink) || '';
  open.setAttribute('aria-label', `Open ${descriptor.title} in Google Calendar (opens in new tab)`);
}

// ---------------------------------------------------------------------------
// Timed blocks
// ---------------------------------------------------------------------------

function createBlock(descriptor, onOpen) {
  const item = document.createElement('li');
  item.className = 'timeline-blk';
  item.dataset.eventKey = descriptor.key;
  item.tabIndex = 0;
  // The inner wrapper is position:sticky so a long event whose top is scrolled
  // above the viewport keeps its title/time/Open action visible inside the
  // block's clipped top edge. `top` comes from --blk-stick (the viewport's
  // mask fade on the homepage, the modal).
  const inner = document.createElement('div');
  inner.className = 'blk-inner';
  const title = document.createElement('div');
  title.className = 't';
  const time = document.createElement('div');
  time.className = 'tm';
  inner.append(title, time);
  item.appendChild(inner);
  return item;
}

// Canvas-measured text fit: a 22–44px inline block only shows its time when
// title + time genuinely fit; otherwise the title gets the full width rather
// than truncating both.
let measureCtx = null;
function textWidth(text, font) {
  if (!measureCtx) measureCtx = document.createElement('canvas')?.getContext?.('2d') || null;
  if (!measureCtx || !text) return 0;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

const TITLE_FONT = '500 12.5px Inter, sans-serif';
const TIME_FONT = '11.5px Inter, sans-serif';
const BLOCK_PAD = 13;   // 7px left + 6px right padding
const OPEN_RESERVE = 26; // top-right Open slot on inline blocks

function applyBlockContent(item, descriptor, width) {
  const showContent = descriptor.height >= 22 && width >= 40;
  const inline = descriptor.height >= 22 && descriptor.height <= 44;
  let showTime = false;
  if (showContent && descriptor.timeText) {
    const timeW = textWidth(descriptor.timeText, TIME_FONT);
    if (inline) {
      const titleW = textWidth(descriptor.title, TITLE_FONT);
      showTime = titleW + 6 + timeW + BLOCK_PAD + OPEN_RESERVE <= width;
    } else {
      showTime = timeW + BLOCK_PAD <= width;
    }
  }
  item.classList.toggle('tiny', !showContent);
  item.classList.toggle('inline', inline);
  item.classList.toggle('no-time', !showTime);
  item.querySelector('.t').textContent = showContent ? descriptor.title : '';
  item.querySelector('.tm').textContent = showContent && showTime ? descriptor.timeText : '';
  return showContent;
}

function laneGeometry(viewport, descriptor) {
  const rail = 56;
  const gap = 2;
  const edge = 4;
  const width = Number.isFinite(viewport?.clientWidth) && viewport.clientWidth > 0
    ? viewport.clientWidth
    : RAIL_MIN_WIDTH;
  const area = Math.max(0, width - rail - 2 - edge);
  const lanes = Math.max(1, descriptor.laneCount || 1);
  const laneWidth = (area - (lanes - 1) * gap) / lanes;
  const span = Math.min(lanes - (descriptor.lane || 0), descriptor.laneSpan || 1);
  return {
    left: rail + 2 + (descriptor.lane || 0) * (laneWidth + gap),
    width: laneWidth * span + (span - 1) * gap
  };
}

function updateBlock(item, descriptor, viewport, now, onOpen) {
  const colors = eventColors(descriptor.color, currentTheme(), { fade: descriptor.pastFade });
  item.style.setProperty('--bar', colors.bar);
  item.style.setProperty('--bg', colors.background);
  item.style.setProperty('--fg', colors.text);
  item.style.setProperty('--blk-fade', descriptor.state === 'past' ? String(descriptor.pastFade) : '1');

  item.style.top = `${descriptor.canvasTop}px`;
  item.style.height = `${descriptor.height}px`;
  const { left, width } = laneGeometry(viewport, descriptor);
  item.style.left = `${left}px`;
  item.style.width = `${width}px`;

  const showContent = applyBlockContent(item, descriptor, width);
  item.classList.toggle('is-past', descriptor.state === 'past');
  item.classList.toggle('is-current', descriptor.state === 'current');
  item.classList.toggle('cont-before', descriptor.continuesBefore === true);
  item.classList.toggle('cont-after', descriptor.continuesAfter === true);
  item.setAttribute('aria-label', eventAccessibleLabel(descriptor));
  visibleHint(item).textContent = eventAccessibleLabel(descriptor);

  let open = item.querySelector('.icon-action');
  const fits = showContent && Boolean(safeExternalUrl(descriptor.event?.htmlLink));
  if (fits) {
    if (!open) {
      open = createOpenLink(descriptor);
      item.querySelector('.blk-inner').appendChild(open);
    }
    syncOpenLink(open, descriptor);
  } else if (open) {
    const focused = document.activeElement === open;
    open.remove();
    if (focused) {
      item.dataset.focusLost = 'true';
    }
  }
  return fits;
}

// ---------------------------------------------------------------------------
// All-day chips
// ---------------------------------------------------------------------------

function allDayChipMeta(descriptor, date) {
  const start = String(descriptor.start || '').slice(0, 10);
  const end = String(descriptor.end || '').slice(0, 10);
  if (!start || !end || !descriptor.hasValidInterval) return '';
  const dayMs = 24 * 60 * 60 * 1000;
  const startD = new Date(`${start}T12:00:00`);
  const endD = new Date(`${end}T12:00:00`);
  const dayIndex = Math.round((new Date(`${date}T12:00:00`) - startD) / dayMs) + 1;
  const total = Math.round((endD - startD) / dayMs);
  return total > 1 ? `Day ${dayIndex} of ${total}` : '';
}

let allDayListSeq = 0;

function renderAllDay(container, descriptors, onOpen, date) {
  container.classList.toggle('hidden', descriptors.length === 0);
  let label = container.querySelector('.timeline-all-day-label');
  if (!label) {
    label = document.createElement('span');
    label.className = 'timeline-all-day-label';
    label.textContent = 'All day';
    label.setAttribute('aria-hidden', 'true');
    container.appendChild(label);
  }
  let list = container.querySelector('.timeline-all-day-list');
  if (!list) {
    list = document.createElement('div');
    list.className = 'timeline-all-day-list';
    list.id = `timeline-all-day-list-${++allDayListSeq}`;
    list.setAttribute('role', 'list');
    container.appendChild(list);
  }

  const expanded = container.dataset.expanded === 'true';
  const visible = expanded ? descriptors : descriptors.slice(0, 3);

  const existing = new Map(
    [...list.querySelectorAll('.timeline-ad[data-event-key]')]
      .map(item => [item.dataset.eventKey, item])
  );
  const desired = [];
  for (const descriptor of visible) {
    let item = existing.get(descriptor.key);
    if (!item) {
      item = document.createElement('span');
      item.className = 'timeline-ad';
      item.dataset.eventKey = descriptor.key;
      item.tabIndex = 0;
      item.setAttribute('role', 'listitem');
      const name = document.createElement('span');
      name.className = 'ad-t';
      const extra = document.createElement('span');
      extra.className = 'ad-c';
      item.append(name, extra);
    }
    const colors = eventColors(descriptor.color, currentTheme(), { fade: 1 });
    item.style.setProperty('--bar', colors.bar);
    item.style.setProperty('--bg', colors.background);
    item.style.setProperty('--fg', colors.text);
    item.querySelector('.ad-t').textContent = descriptor.title;
    item.querySelector('.ad-c').textContent = allDayChipMeta(descriptor, date);
    item.setAttribute('aria-label', eventAccessibleLabel(descriptor));

    let open = item.querySelector('.icon-action');
    const hasLink = Boolean(safeExternalUrl(descriptor.event?.htmlLink));
    if (hasLink) {
      if (!open) {
        open = createOpenLink(descriptor);
        item.appendChild(open);
      }
      syncOpenLink(open, descriptor);
    } else {
      open?.remove();
    }
    desired.push(item);
  }
  reconcileChildren(list, desired, '.timeline-ad[data-event-key]');

  let more = list.querySelector('.timeline-ad-more');
  if (descriptors.length > 3) {
    if (!more) {
      more = createIconButton({
        icon: iconMarkup('chevronDown'),
        label: `Show all ${descriptors.length} all-day events`,
        tooltip: 'Show all all-day events',
        className: 'icon-action--compact timeline-ad-more'
      });
      more.setAttribute('aria-expanded', 'false');
      more.setAttribute('aria-controls', list.id);
      list.appendChild(more);
      more.addEventListener('click', () => {
        container.dataset.expanded = container.dataset.expanded === 'true' ? 'false' : 'true';
        renderAllDay(container, descriptors, onOpen, date);
      });
    }
    more.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    more.setAttribute('aria-label', expanded ? 'Show fewer all-day events' : `Show all ${descriptors.length} all-day events`);
    more.setAttribute('data-tooltip-label', expanded ? 'Show fewer' : `Show all ${descriptors.length}`);
    reconcileChildren(list, [...desired, more], '.timeline-ad-more');
  } else if (more) {
    more.remove();
  }
}

// ---------------------------------------------------------------------------
// Unavailable-time rows
// ---------------------------------------------------------------------------

function renderUnavailable(container, descriptors, onOpen) {
  container.classList.toggle('hidden', descriptors.length === 0);
  const existing = new Map(
    [...container.querySelectorAll('.timeline-unavailable-row[data-event-key]')]
      .map(item => [item.dataset.eventKey, item])
  );
  const desired = [];
  for (const descriptor of descriptors) {
    let item = existing.get(descriptor.key);
    if (!item) {
      item = document.createElement('li');
      item.className = 'timeline-unavailable-row';
      item.dataset.eventKey = descriptor.key;
      const title = document.createElement('span');
      title.className = 'unav-title';
      const time = document.createElement('span');
      time.className = 'unav-time';
      item.append(title, time);
    }
    item.querySelector('.unav-title').textContent = descriptor.title;
    item.querySelector('.unav-time').textContent = descriptor.timeText;
    let open = item.querySelector('.icon-action');
    const hasLink = Boolean(safeExternalUrl(descriptor.event?.htmlLink));
    if (hasLink) {
      if (!open) {
        open = createOpenLink(descriptor);
        item.appendChild(open);
      }
      syncOpenLink(open, descriptor);
    } else {
      open?.remove();
    }
    desired.push(item);
  }
  reconcileChildren(container, desired, '.timeline-unavailable-row[data-event-key]');
}

// ---------------------------------------------------------------------------
// Grid render
// ---------------------------------------------------------------------------

function ensureCanvas(viewport) {
  let canvas = viewport.querySelector('.timeline-canvas');
  if (!canvas) {
    canvas = document.createElement('div');
    canvas.className = 'timeline-canvas';
    const rail = document.createElement('div');
    rail.className = 'timeline-rail';
    rail.setAttribute('aria-hidden', 'true');
    const list = document.createElement('ol');
    list.className = 'timeline-list';
    list.id = 'timeline-list';
    canvas.append(rail, list);
    viewport.appendChild(canvas);
  }
  return canvas;
}

export function renderDayTimeline(elements, events, options = {}) {
  const now = options.now || new Date();
  const model = buildDayTimeline(events, options.date, now);
  const grid = layoutDayGrid(model, { pxPerMinute: PX_PER_MINUTE });
  const viewport = elements.viewport;

  const canvas = ensureCanvas(viewport);
  const list = canvas.querySelector('.timeline-list');

  // Decorative padding so the day's first/last minutes can sit at the 40%
  // reading line: 40% of the viewport height above, 60% below.
  const viewHeight = Number.isFinite(viewport.clientHeight) && viewport.clientHeight > 0
    ? viewport.clientHeight
    : 208;
  const padTop = viewHeight * 0.4;
  const padBottom = viewHeight * 0.6;
  canvas.style.height = `${padTop + grid.height + padBottom}px`;

  // Hour ticks + lines
  const tickNodes = [];
  for (const tick of grid.ticks) {
    const line = document.createElement('div');
    line.className = 'timeline-hour';
    line.style.top = `${padTop + tick.top}px`;
    line.setAttribute('aria-hidden', 'true');
    tickNodes.push(line);
    // The bold Now label owns this stretch of the rail; an hour label within
    // ~16px would collide with it, so it drops out entirely.
    if (grid.marker && Math.abs(tick.top - grid.marker.top) < 16) continue;
    const lbl = document.createElement('span');
    lbl.className = 'timeline-hour-label';
    lbl.style.top = `${padTop + tick.top}px`;
    lbl.setAttribute('aria-hidden', 'true');
    lbl.textContent = tick.label;
    if (tick.offsetLabel) {
      const zone = document.createElement('span');
      zone.className = 'hz';
      zone.textContent = tick.offsetLabel;
      lbl.appendChild(zone);
    }
    tickNodes.push(lbl);
  }
  const rail = canvas.querySelector('.timeline-rail');
  // Replace tick decorations wholesale; blocks keep their keyed nodes.
  for (const node of [...canvas.querySelectorAll('.timeline-hour, .timeline-hour-label')]) node.remove();
  for (const node of tickNodes) canvas.insertBefore(node, rail);

  // Event blocks in chronological DOM order
  const existing = new Map(
    [...list.querySelectorAll('.timeline-blk[data-event-key]')]
      .map(item => [item.dataset.eventKey, item])
  );
  const desired = [];
  for (const descriptor of grid.events) {
    descriptor.canvasTop = padTop + descriptor.top;
    const item = existing.get(descriptor.key) || createBlock(descriptor, options.onOpen);
    updateBlock(item, descriptor, viewport, now, options.onOpen);
    desired.push(item);
    existing.delete(descriptor.key);
  }
  reconcileChildren(list, desired, '.timeline-blk[data-event-key]');

  // A focused block whose Open button no longer fits drops back to the
  // schedule action, per the reserved-focus rule.
  let marker = canvas.querySelector('[data-timeline-now="true"]');
  if (grid.marker) {
    if (!marker) {
      marker = document.createElement('div');
      marker.className = 'timeline-now';
      marker.dataset.timelineNow = 'true';
      const line = document.createElement('div');
      line.className = 'line';
      const label = document.createElement('span');
      label.className = 'lbl';
      const sr = document.createElement('span');
      sr.className = 'sr visually-hidden';
      marker.append(line, label, sr);
      canvas.appendChild(marker);
    }
    marker.style.top = `${padTop + grid.marker.top}px`;
    marker.querySelector('.lbl').textContent = grid.marker.label
      .replace(/^Now ·\s*/, '')
      .replace(/\s?[AP]M$/i, '');
    marker.querySelector('.sr').textContent = grid.marker.label;
  } else {
    marker?.remove();
    marker = null;
  }

  renderAllDay(elements.allDay, model.allDay, options.onOpen, model.date);
  if (elements.unavailable) renderUnavailable(elements.unavailable, model.unavailable, options.onOpen);

  const hasEvents = model.allDay.length + model.timed.length + model.unavailable.length > 0;
  elements.empty.classList.toggle('hidden', hasEvents || options.hasStatus);
  viewport.classList.toggle('hidden', !hasEvents && options.hasStatus);
  return { model, grid, marker, hasEvents, canvas };
}

// ---------------------------------------------------------------------------
// Week grid
// ---------------------------------------------------------------------------


export function centerTimelineOnNow(viewport, markerEl) {
  if (!viewport || !markerEl) return;
  const markerTop = markerEl.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
  const target = markerTop - viewport.clientHeight * 0.4;
  const max = Number.isFinite(viewport.scrollHeight)
    ? Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    : Infinity;
  viewport.scrollTop = Math.max(0, Math.min(max, target));
}
