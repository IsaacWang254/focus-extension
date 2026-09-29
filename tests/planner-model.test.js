import assert from 'node:assert/strict';
import {
  addLocalDays,
  flattenTasks,
  formatRelativeStart,
  groupTasks,
  parseLocalDate,
  rankTasks,
  safeExternalUrl,
  selectCurrentEvents,
  selectNextEvent,
  selectNowTask,
  toLocalDateKey
} from '../newtab/planner-model.js';
import {
  clearCurrentTaskState,
  loadCurrentTaskState,
  saveCurrentTaskState
} from '../newtab/planner-state.js';

const now = new Date(2026, 8, 29, 9, 0, 0);
assert.equal(toLocalDateKey(now), '2026-09-29');
assert.equal(addLocalDays('2026-09-29', 1), '2026-09-30');
assert.equal(addLocalDays('2026-03-08', 1), '2026-03-09');
assert.equal(parseLocalDate('2026-02-30'), null);

const tasks = [
  { id: 'later', content: 'Later', priority: 4, due: { date: '2026-10-01' } },
  { id: 'today', content: 'Today', priority: 2, due: { date: '2026-09-29' }, subtasks: [
    { id: 'child', content: 'Child', priority: 1, due: { date: '2026-09-29' } }
  ] },
  { id: 'overdue', content: 'Overdue', priority: 1, due: { date: '2026-09-28' } },
  { id: 'undated', content: 'Undated', priority: 4, due: null }
];

const flat = flattenTasks(tasks);
assert.equal(flat.length, 5);
assert.equal(flat.find(task => task.id === 'child').parentContent, 'Today');
assert.deepEqual(rankTasks(flat, now).map(task => task.id), ['overdue', 'today', 'child', 'later', 'undated']);
assert.equal(selectNowTask(tasks, 'today', now).id, 'today');
assert.equal(selectNowTask(tasks, '', now).id, 'overdue');

const day = groupTasks(tasks, 'day', '2026-09-29');
assert.deepEqual(day.map(group => group.key), ['overdue', '2026-09-29']);
assert.deepEqual(day[1].tasks.map(task => task.id), ['today', 'child']);
assert.deepEqual(groupTasks(tasks, 'upcoming', '2026-09-29').map(group => group.key), ['2026-09-29', '2026-10-01']);
assert.equal(groupTasks(tasks, 'all', '2026-09-29')[0].tasks.length, 5);

const events = [
  { id: 'all-day', title: 'All day', start: { date: '2026-09-29' }, end: { date: '2026-09-30' } },
  { id: 'current-a', title: 'Current A', start: '2026-09-29T08:30:00', end: '2026-09-29T09:30:00' },
  { id: 'current-b', title: 'Current B', start: '2026-09-29T08:45:00', end: '2026-09-29T10:00:00' },
  { id: 'next', title: 'Next', start: '2026-09-29T10:15:00', end: '2026-09-29T11:00:00' }
];
assert.deepEqual(selectCurrentEvents(events, now).map(event => event.id), ['current-a', 'current-b']);
assert.equal(selectNextEvent(events, now).id, 'next');
assert.equal(formatRelativeStart(selectNextEvent(events, now), now), 'in 1 hr 15 min');
assert.equal(safeExternalUrl('https://example.com/meeting'), 'https://example.com/meeting');
assert.equal(safeExternalUrl('javascript:alert(1)'), '');

const data = {};
const storage = {
  async get(key) { return { [key]: data[key] }; },
  async set(values) { Object.assign(data, values); },
  async remove(key) { delete data[key]; }
};
await saveCurrentTaskState(storage, 'account-token', 'today', now);
assert.equal((await loadCurrentTaskState(storage, 'account-token', now)).taskId, 'today');
assert.equal(await loadCurrentTaskState(storage, 'different-account', now), null);
assert.equal(await loadCurrentTaskState(storage, 'account-token', new Date(2026, 8, 30, 9, 0, 0)), null);
await clearCurrentTaskState(storage);
assert.equal(await loadCurrentTaskState(storage, 'account-token', now), null);

console.log('planner model tests passed');
