import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { centerTimelineOnNow, renderDayTimeline } from '../newtab/planner-timeline.js';

class ClassList {
  constructor(owner) {
    this.owner = owner;
    this.values = new Set();
  }

  set(value = '') {
    this.values = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  add(...names) { names.forEach(name => this.values.add(name)); }
  remove(...names) { names.forEach(name => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name); else this.values.delete(name);
    return enabled;
  }

  toString() { return [...this.values].join(' '); }
}

function matches(element, selector) {
  if (selector.includes(',')) return selector.split(',').some(part => matches(element, part.trim()));
  const dataMatch = selector.match(/\[data-([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/);
  const classMatch = selector.match(/\.([\w-]+)/);
  const tagMatch = selector.match(/^[a-z]+/i);
  if (tagMatch && element.tagName !== tagMatch[0].toUpperCase()) return false;
  if (classMatch && !element.classList.contains(classMatch[1])) return false;
  if (dataMatch) {
    const key = dataMatch[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (!(key in element.dataset)) return false;
    if (dataMatch[2] && element.dataset[key] !== dataMatch[2]) return false;
  }
  return Boolean(classMatch || dataMatch || tagMatch);
}

class MiniNode {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = new ClassList(this);
    this.style = {
      values: new Map(),
      setProperty: (name, value) => this.style.values.set(name, String(value)),
      getPropertyValue: name => this.style.values.get(name) || ''
    };
    this.textContent = '';
    this.type = '';
    this.clientHeight = 0;
    this.scrollTop = 0;
    this.rect = { top: 0 };
  }

  get className() { return this.classList.toString(); }
  set className(value) { this.classList.set(value); }
  get firstChild() { return this.children[0] || null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    return this.parentNode.children[this.parentNode.children.indexOf(this) + 1] || null;
  }

  get innerHTML() { return ''; }
  set innerHTML(value) {
    this.replaceChildren();
    if (String(value).includes('timeline-now-label')) {
      const label = new MiniNode('span'); label.className = 'timeline-now-label';
      const dot = new MiniNode('span'); dot.className = 'timeline-now-dot';
      const rule = new MiniNode('span'); rule.className = 'timeline-now-rule';
      this.append(label, dot, rule);
    }
  }

  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  appendChild(node) {
    if (node instanceof MiniFragment) {
      node.children.slice().forEach(child => this.appendChild(child));
      node.children = [];
      return node;
    }
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.children.push(node);
    return node;
  }

  insertBefore(node, reference) {
    if (node.parentNode) node.parentNode.removeChild(node);
    const index = reference ? this.children.indexOf(reference) : -1;
    node.parentNode = this;
    if (index < 0) this.children.push(node); else this.children.splice(index, 0, node);
    return node;
  }

  removeChild(node) {
    if (node.contains?.(documentStub.activeElement)) documentStub.activeElement = null;
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
    node.parentNode = null;
  }

  remove() { this.parentNode?.removeChild(this); }

  replaceChildren(...nodes) {
    this.children.forEach(child => { child.parentNode = null; });
    this.children = [];
    this.append(...nodes);
  }

  querySelectorAll(selector) {
    const found = [];
    const visit = node => {
      for (const child of node.children) {
        if (matches(child, selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) || null; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  dispatch(type, event = {}) { this.listeners.get(type)?.({ currentTarget: this, ...event }); }
  focus() { documentStub.activeElement = this; }
  getBoundingClientRect() { return this.rect; }
}

class MiniFragment extends MiniNode {}

const documentStub = {
  activeElement: null,
  createElement: tag => new MiniNode(tag),
  createDocumentFragment: () => new MiniFragment()
};

globalThis.document = documentStub;

function timelineElements() {
  return {
    viewport: new MiniNode('section'),
    list: new MiniNode('ul'),
    allDay: new MiniNode('section'),
    empty: new MiniNode('p')
  };
}

const timelineEvents = [
  { id: 'later', calendarId: 'work', title: 'Later review', calendarName: 'Work', color: '#4285F4', start: '2026-09-29T11:00:00', end: '2026-09-29T11:30:00' },
  { id: 'all', calendarId: 'personal', title: 'Birthday', calendarName: 'Personal', color: '#0F9D58', isAllDay: true, start: '2026-09-29', end: '2026-09-30' },
  { id: 'past', calendarId: 'work', title: 'Standup', calendarName: 'Work', color: '#EA4335', start: '2026-09-29T08:00:00', end: '2026-09-29T09:00:00' },
  { id: 'current', calendarId: 'work', title: 'Planning', calendarName: 'Work', color: '#FBBC04', start: '2026-09-29T09:30:00', end: '2026-09-29T10:30:00' }
];
const timelineNow = new Date(2026, 8, 29, 10, 0, 0);
const eventKey = (calendarId, id, start) => `${calendarId}\0${id}\0${start}`;
const elements = timelineElements();
const opened = [];
const firstRender = renderDayTimeline(elements, timelineEvents, {
  date: '2026-09-29', now: timelineNow,
  onOpen: (event, trigger) => opened.push({ event, trigger })
});

assert.deepEqual(
  elements.list.querySelectorAll('.timeline-event').map(row => row.dataset.eventKey),
  [
    eventKey('work', 'past', '2026-09-29T08:00:00'),
    eventKey('work', 'current', '2026-09-29T09:30:00'),
    eventKey('work', 'later', '2026-09-29T11:00:00')
  ],
  'timed rows render in chronological order independent of input order'
);
assert.equal(elements.allDay.classList.contains('hidden'), false, 'all-day events render in their separate group');
assert.equal(elements.allDay.querySelector('.timeline-all-day-label').textContent, 'All day');
assert.equal(elements.allDay.querySelector('.timeline-all-day-event').style.getPropertyValue('--event-color'), '#0F9D58');
assert.equal(elements.list.querySelector(`[data-event-key="${eventKey('work', 'past', '2026-09-29T08:00:00')}"]`).classList.contains('is-past'), true);
const currentRow = elements.list.querySelector(`[data-event-key="${eventKey('work', 'current', '2026-09-29T09:30:00')}"]`);
assert.equal(currentRow.classList.contains('is-current'), true);
assert.equal(currentRow.querySelector('.timeline-event-state').textContent, 'In progress');
assert.equal(currentRow.querySelector('.timeline-event-button').getAttribute('aria-label'), 'Planning, 9:30 AM–10:30 AM, Work, In progress');
assert.equal(currentRow.style.getPropertyValue('--event-color'), '#FBBC04');
assert.equal(elements.list.querySelector(`[data-event-key="${eventKey('work', 'later', '2026-09-29T11:00:00')}"]`).classList.contains('is-future'), true);
assert.match(firstRender.marker.querySelector('.timeline-now-label').textContent, /^Now · 10:00 AM$/);

const currentButton = currentRow.querySelector('.timeline-event-button');
currentButton.dispatch('click');
elements.allDay.querySelector('.timeline-all-day-event').querySelector('button').dispatch('click');
assert.deepEqual(opened.map(result => result.event.id), ['current', 'all'], 'timed and all-day rows retain event activation');
assert.equal(opened[0].trigger, currentButton);

currentButton.focus();
renderDayTimeline(elements, timelineEvents, {
  date: '2026-09-29', now: new Date(2026, 8, 29, 10, 1, 0),
  onOpen: (event, trigger) => opened.push({ event, trigger })
});
assert.equal(elements.list.querySelector(`[data-event-key="${eventKey('work', 'current', '2026-09-29T09:30:00')}"]`), currentRow, 'minute renders retain keyed row nodes');
assert.equal(documentStub.activeElement, currentButton, 'focused event buttons retain focus while the marker moves');

const boundaryEvent = { id: 'starting', calendarId: 'team', title: 'Starting now', calendarName: 'Team', color: '#4285F4', start: '2026-09-29T10:01:00', end: '2026-09-29T10:45:00' };
renderDayTimeline(elements, [...timelineEvents, boundaryEvent], {
  date: '2026-09-29', now: new Date(2026, 8, 29, 10, 0, 0),
  onOpen: (event, trigger) => opened.push({ event, trigger })
});
const boundaryRow = elements.list.querySelector(`[data-event-key="${eventKey('team', 'starting', boundaryEvent.start)}"]`);
const boundaryButton = boundaryRow.querySelector('.timeline-event-button');
boundaryButton.focus();
renderDayTimeline(elements, [...timelineEvents, boundaryEvent], {
  date: '2026-09-29', now: new Date(2026, 8, 29, 10, 2, 0),
  onOpen: (event, trigger) => opened.push({ event, trigger })
});
assert.equal(documentStub.activeElement, boundaryButton, 'crossing an event start moves only the Now marker, not the focused row');

const currentRowAfterBoundary = elements.list.querySelector(`[data-event-key="${eventKey('work', 'current', '2026-09-29T09:30:00')}"]`);
const currentButtonAfterBoundary = currentRowAfterBoundary.querySelector('.timeline-event-button');
currentButtonAfterBoundary.focus();
renderDayTimeline(elements, [...timelineEvents.filter(event => event.id !== 'past'), boundaryEvent], {
  date: '2026-09-29', now: new Date(2026, 8, 29, 10, 2, 0),
  onOpen: (event, trigger) => opened.push({ event, trigger })
});
assert.equal(documentStub.activeElement, currentButtonAfterBoundary, 'removing an earlier stale event does not move the focused row');

const emptyElements = timelineElements();
const emptyResult = renderDayTimeline(emptyElements, [], { date: '2026-09-29', now: timelineNow, hasStatus: false });
assert.equal(emptyResult.hasEvents, false);
assert.equal(emptyElements.empty.classList.contains('hidden'), false, 'an empty day keeps its empty message visible');
assert.equal(emptyElements.viewport.classList.contains('hidden'), false, 'an empty day keeps the Now marker in the timeline viewport');
renderDayTimeline(emptyElements, [], { date: '2026-09-29', now: timelineNow, hasStatus: true });
assert.equal(emptyElements.empty.classList.contains('hidden'), true, 'connection and error statuses replace the empty-day message');
assert.equal(emptyElements.viewport.classList.contains('hidden'), true, 'connection and error statuses hide the empty timeline viewport');

const viewport = new MiniNode('section');
viewport.clientHeight = 200;
viewport.scrollTop = 40;
viewport.rect.top = 100;
const marker = new MiniNode('li');
marker.rect.top = 360;
centerTimelineOnNow(viewport, marker);
assert.equal(viewport.scrollTop, 220, 'the marker is positioned 40% down the timeline viewport');
centerTimelineOnNow(viewport, null);
assert.equal(viewport.scrollTop, 220, 'centering safely ignores a missing marker');

delete globalThis.document;

const plannerSource = fs.readFileSync(new URL('../newtab/planner.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\n/gm, '')
  .replace(/^export /gm, '')
  .concat('\nglobalThis.__plannerExports = { initPlannerDashboard, refreshPlannerDashboard, refreshPlannerTime, handlePlannerStorageChange };');

function plannerHarness() {
  let date = '2026-09-29';
  let now = new Date(2026, 8, 29, 10, 0, 0).getTime();
  const calls = { status: 0, events: 0, renders: 0, centers: 0 };
  const elementsById = new Map();
  const documentListeners = new Map();

  const makeElement = id => {
    const classes = new Set(id === 'planner-drawer' ? ['hidden'] : id === 'back-to-now-btn' ? ['hidden'] : []);
    const listeners = new Map();
    return {
      id, dataset: {}, textContent: '',
      classList: {
        add: name => classes.add(name), remove: name => classes.delete(name),
        contains: name => classes.has(name), toggle: (name, force) => force ? classes.add(name) : classes.delete(name)
      },
      setAttribute() {}, addEventListener: (type, listener) => listeners.set(type, listener),
      fire: (type, event = {}) => listeners.get(type)?.({ currentTarget: null, ...event }),
      querySelector: () => null, querySelectorAll: () => [], contains: () => false, focus() {}
    };
  };
  const element = id => {
    if (!elementsById.has(id)) elementsById.set(id, makeElement(id));
    return elementsById.get(id);
  };
  const document = {
    body: { classList: { add() {}, remove() {} } },
    getElementById: element,
    addEventListener: (type, listener) => documentListeners.set(type, listener),
    activeElement: null
  };
  const api = {
    isVisible: key => key === 'newtabShowCalendar',
    sendRuntimeMessage: async message => {
      if (message.type === 'GET_CALENDAR_STATUS') { calls.status++; return { connected: true }; }
      if (message.type === 'GET_PLANNER_EVENTS') {
        calls.events++;
        if (api.nextEventsError) throw api.nextEventsError;
        return api.nextPayload || { events: [{ id: 'event', start: `${date}T11:00:00`, end: `${date}T12:00:00` }] };
      }
      throw new Error(`Unexpected message: ${message.type}`);
    }
  };
  const sandbox = {
    console: { error() {} }, document,
    Date: class FakeDate extends Date {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    },
    requestAnimationFrame: callback => callback(),
    queueMicrotask,
    toLocalDateKey: () => date,
    createLatestRequestGuard: () => {
      let latest = 0;
      return { begin: () => ++latest, isLatest: value => value === latest };
    },
    normalizeEvents: events => events || [],
    normalizePlannerEventsPayload: (payload, requestedDate) => Array.isArray(payload) ? { date: requestedDate, events: payload } : { date: requestedDate, ...payload },
    renderDayTimeline: () => { calls.renders++; return { marker: { id: 'now' }, hasEvents: true }; },
    centerTimelineOnNow: () => { calls.centers++; },
    PLANNER_STATE_KEY: 'newtabPlannerState',
    flattenTasks: tasks => tasks,
    rankTasks: () => [], selectNowTask: () => null, safeExternalUrl: () => '', addLocalDays: value => value,
    clearCurrentTaskState: async () => {}, loadCurrentTaskState: async () => null, saveCurrentTaskState: async () => {},
    createTaskRow: () => ({}), renderTaskGroups() {}, taskMeta: () => '',
    createEventRow: () => ({}), formatEventTime: () => '', getMeetingUrl: () => '', renderEventList: () => 0,
    buildCreateTaskPayload: () => ({}), buildUpdateTaskPayload: () => ({}), nextCurrentTaskIdAfterCompletion: () => '',
    todoist: {}
  };
  vm.runInNewContext(plannerSource, sandbox, { filename: 'planner.js' });
  return {
    api, calls, element,
    exports: sandbox.__plannerExports,
    advance(milliseconds) { now += milliseconds; },
    setDate(value) { date = value; }
  };
}

const planner = plannerHarness();
planner.exports.initPlannerDashboard(planner.api);
await planner.exports.refreshPlannerDashboard();
assert.deepEqual(planner.calls, { status: 1, events: 1, renders: 1, centers: 1 }, 'initial dashboard load fetches and centers once');

await planner.exports.refreshPlannerDashboard();
assert.equal(planner.calls.status, 1, 'the five-minute gate also prevents repeat Calendar status requests');
assert.equal(planner.calls.events, 1, 'the five-minute gate applies after successful responses');
assert.equal(planner.calls.renders, 2, 'gated refreshes still render cached data');
planner.exports.refreshPlannerTime();
planner.exports.refreshPlannerTime();
assert.equal(planner.calls.events, 1, 'minute rendering never requests Calendar data');
assert.equal(planner.calls.renders, 4, 'minute rendering updates the loaded timeline');
planner.exports.refreshPlannerTime({ recenter: true });
assert.equal(planner.calls.events, 1, 'visibility-resume rendering uses loaded events without a duplicate fetch');
assert.equal(planner.calls.centers, 2, 'visibility resume recenters the existing marker');

planner.element('timeline-viewport').fire('wheel');
planner.exports.refreshPlannerTime();
assert.equal(planner.calls.centers, 2, 'manual timeline scrolling preserves the user anchor');
assert.equal(planner.element('back-to-now-btn').classList.contains('hidden'), false, 'manual scrolling reveals Back to now');
planner.element('back-to-now-btn').fire('click');
assert.equal(planner.calls.centers, 3, 'Back to now explicitly recenters the marker');
assert.equal(planner.element('back-to-now-btn').classList.contains('hidden'), true);

planner.exports.handlePlannerStorageChange({ calendarSettings: {
  oldValue: { connected: true, email: 'a@example.com', selectedCalendars: ['work'], lastSync: 1 },
  newValue: { connected: true, email: 'a@example.com', selectedCalendars: ['work'], lastSync: 2 }
} });
await new Promise(resolve => setImmediate(resolve));
assert.equal(planner.calls.events, 1, 'background Calendar sync metadata does not bypass the refresh gate');
planner.exports.handlePlannerStorageChange({ calendarSettings: {
  oldValue: { connected: true, email: 'a@example.com', selectedCalendars: ['work'] },
  newValue: { connected: true, email: 'a@example.com', selectedCalendars: ['personal'] }
} });
await new Promise(resolve => setImmediate(resolve));
assert.equal(planner.calls.events, 2, 'a changed Calendar selection forces an immediate refresh');
assert.equal(planner.calls.centers, 3, 'storage-triggered Calendar refreshes do not recenter the timeline');

planner.advance(5 * 60 * 1000);
await planner.exports.refreshPlannerDashboard();
assert.equal(planner.calls.events, 3, 'Calendar refreshes again exactly when the five-minute interval expires');

planner.setDate('2026-09-30');
planner.exports.refreshPlannerTime();
await new Promise(resolve => setImmediate(resolve));
assert.equal(planner.calls.events, 4, 'local-date rollover bypasses the gate and loads the new day once');
assert.equal(planner.calls.renders, 9, 'rollover clears old timeline data before rendering the new day');

const failurePlanner = plannerHarness();
failurePlanner.api.nextEventsError = new Error('offline');
failurePlanner.exports.initPlannerDashboard(failurePlanner.api);
await failurePlanner.exports.refreshPlannerDashboard();
assert.match(failurePlanner.element('calendar-status').textContent, /Calendar is unavailable/, 'Calendar failures expose a distinct unavailable status');
await failurePlanner.exports.refreshPlannerDashboard();
assert.equal(failurePlanner.calls.events, 1, 'failed attempts are also freshness-gated');

const disconnectedPlanner = plannerHarness();
disconnectedPlanner.api.nextPayload = { events: [], disconnected: true };
disconnectedPlanner.exports.initPlannerDashboard(disconnectedPlanner.api);
await disconnectedPlanner.exports.refreshPlannerDashboard();
assert.match(disconnectedPlanner.element('calendar-status').textContent, /connection expired/, 'expired Calendar connections remain distinct from an empty day');
assert.equal(disconnectedPlanner.element('calendar-connect-btn').textContent, 'Reconnect Calendar');

const stalePlanner = plannerHarness();
stalePlanner.api.nextPayload = { events: [], stale: true };
stalePlanner.exports.initPlannerDashboard(stalePlanner.api);
await stalePlanner.exports.refreshPlannerDashboard();
assert.equal(stalePlanner.element('calendar-status').textContent, 'Showing saved schedule.', 'stale Calendar data remains distinct from errors and disconnected state');

console.log('planner timeline controller tests passed');
