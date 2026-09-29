import assert from 'node:assert/strict';
import {
  addLocalDays,
  buildDayTimeline,
  flattenTasks,
  formatRelativeStart,
  groupTasks,
  parseLocalDate,
  rankTasks,
  safeExternalUrl,
  selectCurrentEvents,
  selectNextEvent,
  selectNowTask,
  toLocalDateKey,
  validateProviderColor
} from '../newtab/planner-model.js';
import {
  clearCurrentTaskState,
  loadCurrentTaskState,
  saveCurrentTaskState
} from '../newtab/planner-state.js';
import { getMeetingUrl } from '../newtab/planner-calendar.js';

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
assert.equal(getMeetingUrl({ meetingLink: 'https://meet.google.com/abc', htmlLink: 'https://calendar.google.com/event' }), 'https://meet.google.com/abc');
assert.equal(getMeetingUrl({ htmlLink: 'https://calendar.google.com/event' }), '', 'calendar event pages are not meeting links');

const timelineNow = new Date(2026, 8, 29, 10, 0, 0);
const timeline = buildDayTimeline([
  { id: 'all-later', calendarId: 'work', title: 'All hands', isAllDay: true, start: '2026-09-29', end: '2026-09-30' },
  { id: 'all-first', calendarId: 'personal', title: 'Birthday', isAllDay: true, start: '2026-09-28', end: '2026-09-30' },
  { id: 'cross-midnight', calendarId: 'work', title: 'Overnight', start: '2026-09-28T23:30:00', end: '2026-09-29T00:30:00', color: '#a4BDFC' },
  { id: 'past', calendarId: 'work', title: 'Ended', start: '2026-09-29T07:00:00', end: '2026-09-29T08:00:00' },
  { id: 'current-long', calendarId: 'work', title: 'Long current', start: '2026-09-29T09:00:00', end: '2026-09-29T11:00:00' },
  { id: 'current-short', calendarId: 'personal', title: 'Short current', start: '2026-09-29T09:30:00', end: '2026-09-29T10:30:00' },
  { id: 'end-now', calendarId: 'work', title: 'Ends now', start: '2026-09-29T09:00:00', end: '2026-09-29T10:00:00' },
  { id: 'start-now', calendarId: 'work', title: 'Starts now', start: '2026-09-29T10:00:00', end: '2026-09-29T11:00:00' },
  { id: 'future', calendarId: 'work', title: 'Later', start: '2026-09-29T13:00:00', end: '2026-09-29T14:00:00' },
  { id: 'bad-end', calendarId: 'work', title: 'Missing end', start: '2026-09-29T15:00:00', end: 'not-a-date' },
  { id: 'unavailable', calendarId: 'work', title: 'No time', start: 'not-a-date', end: 'not-a-date' }
], '2026-09-29', timelineNow);
assert.deepEqual(timeline.allDay.map(row => row.id), ['all-first', 'all-later'], 'all-day rows use a stable identity order');
assert.deepEqual(timeline.timed.map(row => row.id), ['cross-midnight', 'past', 'current-long', 'end-now', 'current-short', 'start-now', 'future', 'bad-end']);
assert.deepEqual(timeline.timed.filter(row => row.state === 'current').map(row => row.id), ['current-long', 'current-short', 'start-now']);
assert.equal(timeline.timed.find(row => row.id === 'end-now').state, 'past', 'end equals now is past');
assert.equal(timeline.timed.find(row => row.id === 'bad-end').state, 'unknown', 'invalid intervals cannot become active');
assert.equal(timeline.timed.find(row => row.id === 'cross-midnight').color, '#a4BDFC');
assert.match(timeline.timed.find(row => row.id === 'cross-midnight').timeText, /Yesterday/, 'cross-midnight times retain date context');
assert.equal(timeline.marker.index, 6, 'the marker follows every start at or before now');
assert.equal(timeline.rows[6].type, 'now-marker');
assert.deepEqual(timeline.unavailable.map(row => row.id), ['unavailable']);

const fadeTimeline = buildDayTimeline([
  { id: 'just-ended', start: '2026-09-29T08:00:00', end: '2026-09-29T10:00:00' },
  { id: 'one-hour-old', start: '2026-09-29T07:00:00', end: '2026-09-29T09:00:00' },
  { id: 'old', start: '2026-09-29T06:00:00', end: '2026-09-29T08:00:00' }
], '2026-09-29', timelineNow);
assert.equal(fadeTimeline.timed.find(row => row.id === 'just-ended').pastFade, 1);
assert.equal(fadeTimeline.timed.find(row => row.id === 'one-hour-old').pastFade, 0.85);
assert.equal(fadeTimeline.timed.find(row => row.id === 'old').pastFade, 0.7);

const exclusiveAllDay = buildDayTimeline([
  { id: 'ended-before-today', isAllDay: true, start: '2026-09-28', end: '2026-09-29' },
  { id: 'invalid-earlier', isAllDay: true, start: '2026-09-28', end: '2026-09-28' }
], '2026-09-29', timelineNow);
assert.equal(exclusiveAllDay.allDay.length, 0, 'exclusive and invalid all-day end dates do not bleed into later days');
assert.equal(validateProviderColor('#A4BDFC'), '#A4BDFC');
assert.equal(validateProviderColor('rgb(0, 0, 0)'), '#73736c');

const futureOnly = [{ id: 'future', content: 'Future', due: { date: '2026-10-01' } }];
assert.equal(selectNowTask(futureOnly, '', now), null, 'future tasks are not suggested as current work');
const unsortedUpcoming = [
  { id: 'later-high', content: 'Later high', priority: 4, due: { date: '2026-10-03' } },
  { id: 'tomorrow-low', content: 'Tomorrow low', priority: 1, due: { date: '2026-09-30' } }
];
assert.deepEqual(groupTasks(unsortedUpcoming, 'upcoming', '2026-09-29').map(group => group.key), ['2026-09-30', '2026-10-03']);

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
