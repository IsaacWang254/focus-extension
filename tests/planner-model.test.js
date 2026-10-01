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
  selectHomepageTasks,
  selectNextEvent,
  selectNowTask,
  parseTaskDeadline,
  rankSuggestedTasks,
  toLocalDateKey,
  validateProviderColor
} from '../newtab/planner-model.js';
import { taskMeta } from '../newtab/planner-tasks.js';
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
// --- Homepage deadline-first suggestions ---
const dateOnly = value => ({ date: value });
const timedAt = value => ({ datetime: value });
const floatingAt = value => ({ date: value });

assert.deepEqual(parseTaskDeadline({ due: dateOnly('2026-09-29') }), {
  kind: 'date',
  localDate: '2026-09-29',
  sortMs: new Date(2026, 8, 30).getTime()
}, 'date-only due sorts at the next local midnight');
assert.deepEqual(parseTaskDeadline({ due: timedAt('2026-09-29T14:30:00Z') }), {
  kind: 'timed',
  localDate: toLocalDateKey(new Date('2026-09-29T14:30:00Z')),
  instantMs: Date.UTC(2026, 8, 29, 14, 30),
  sortMs: Date.UTC(2026, 8, 29, 14, 30)
});
assert.equal(parseTaskDeadline({ due: timedAt('2026-09-29T14:30:00+05:30') }).instantMs, Date.UTC(2026, 8, 29, 9, 0), 'explicit offsets resolve to real instants');
assert.equal(parseTaskDeadline({ due: timedAt('2026-09-29T14:30:00-0230') }).instantMs, Date.UTC(2026, 8, 29, 17, 0), 'compact offsets parse');
assert.deepEqual(parseTaskDeadline({ due: timedAt('2026-09-29T14:30:00') }), { kind: 'none' }, 'offset-free due.datetime is invalid');
assert.deepEqual(parseTaskDeadline({ due: floatingAt('2026-09-29T14:30:00') }), {
  kind: 'timed',
  localDate: '2026-09-29',
  instantMs: new Date(2026, 8, 29, 14, 30).getTime(),
  sortMs: new Date(2026, 8, 29, 14, 30).getTime()
}, 'offset-free due.date is floating local time');
assert.deepEqual(parseTaskDeadline({ due: dateOnly('2026-02-30') }), { kind: 'none' }, 'impossible calendar dates are unusable');
assert.deepEqual(parseTaskDeadline({ due: dateOnly('2026-13-01') }), { kind: 'none' });
assert.deepEqual(parseTaskDeadline({ due: dateOnly('eventually') }), { kind: 'none' });
assert.deepEqual(parseTaskDeadline({ due: timedAt('2026-02-30T10:00:00Z') }), { kind: 'none' }, 'invalid timed dates are never sliced to a date');
assert.deepEqual(parseTaskDeadline({ due: dateOnly('2028-02-29') }).kind, 'date', 'real leap days are valid');
assert.deepEqual(parseTaskDeadline({}), { kind: 'none' });
assert.deepEqual(parseTaskDeadline({ due: null }), { kind: 'none' });

assert.deepEqual(rankSuggestedTasks(tasks, now).map(task => task.id), ['overdue', 'today', 'child', 'later', 'undated'], 'due/overdue precede future, undated last');

const tieTasks = [
  { id: 'low', content: 'Low', priority: 2, due: dateOnly('2026-09-29') },
  { id: 'high', content: 'High', priority: 4, due: dateOnly('2026-09-29') }
];
assert.deepEqual(rankSuggestedTasks(tieTasks, now).map(task => task.id), ['high', 'low'], 'same-day date-only ties break on priority');

const overdueRace = [
  { id: 'newer', content: 'Newer overdue', priority: 4, due: dateOnly('2026-09-28') },
  { id: 'older', content: 'Older overdue', priority: 1, due: dateOnly('2026-09-26') }
];
assert.deepEqual(rankSuggestedTasks(overdueRace, now).map(task => task.id), ['older', 'newer'], 'an older deadline outranks a newer higher-priority one');

const futureRace = [
  { id: 'soon-low', content: 'Soon', priority: 1, due: dateOnly('2026-09-30') },
  { id: 'later-high', content: 'Later', priority: 4, due: dateOnly('2026-10-03') }
];
assert.deepEqual(rankSuggestedTasks(futureRace, now).map(task => task.id), ['soon-low', 'later-high'], 'a low-priority earlier deadline outranks a high-priority later one');

const timedRace = [
  { id: 'late-high', content: 'Late', priority: 4, due: floatingAt('2026-09-29T17:00:00') },
  { id: 'early-low', content: 'Early', priority: 1, due: floatingAt('2026-09-29T09:00:00') }
];
assert.deepEqual(rankSuggestedTasks(timedRace, now).map(task => task.id), ['early-low', 'late-high'], 'timed deadlines compare by instant, not priority');

const equalInstants = [
  { id: 'b', content: 'B', priority: 4, due: timedAt('2026-09-29T08:00:00Z') },
  { id: 'a', content: 'A', priority: 4, due: timedAt('2026-09-29T10:00:00+02:00') }
];
assert.deepEqual(rankSuggestedTasks(equalInstants, now).map(task => task.id), ['a', 'b'], 'equal instants under different offsets tie on priority then id');

const mixedSameDay = [
  { id: 'date-only', content: 'Date only', priority: 4, due: dateOnly('2026-09-29') },
  { id: 'timed', content: 'Timed', priority: 1, due: floatingAt('2026-09-29T23:00:00') }
];
assert.deepEqual(rankSuggestedTasks(mixedSameDay, now).map(task => task.id), ['timed', 'date-only'], 'date-only tasks sort after the day’s timed deadlines');

const upcomingOnly = [
  { id: 'f2', content: 'F2', priority: 4, due: dateOnly('2026-10-05') },
  { id: 'f1', content: 'F1', priority: 1, due: dateOnly('2026-10-01') },
  { id: 'und', content: 'Und', priority: 4, due: null }
];
assert.deepEqual(rankSuggestedTasks(upcomingOnly, now).map(task => task.id), ['f1', 'f2', 'und'], 'future deadlines rank before undated fallbacks');
assert.equal(selectNowTask(upcomingOnly, '', now).id, 'f1', 'upcoming work is suggested when nothing is due');

const undatedOnly = [
  { id: 'b', content: 'B', priority: 1, due: null },
  { id: 'a', content: 'A', priority: 1, due: null },
  { id: 'urgent', content: 'U', priority: 4, due: null }
];
assert.deepEqual(rankSuggestedTasks(undatedOnly, now).map(task => task.id), ['urgent', 'a', 'b'], 'undated tasks rank by priority then id');

const override = selectHomepageTasks(tasks, 'undated', now);
assert.equal(override.tasks[0].id, 'undated', 'a valid override leads even without a deadline');
assert.equal(override.currentIsOverride, true);
assert.deepEqual(override.tasks.slice(1).map(task => task.id), ['overdue', 'today'], 'ranked tasks follow the override');
assert.equal(override.tasks.length, 3, 'the homepage list is limited to three');
assert.equal(override.tasks.filter(task => task.id === 'undated').length, 1, 'the override is not duplicated');
assert.deepEqual(selectHomepageTasks(tasks, 'missing', now).currentIsOverride, false, 'an unknown override falls back to automatic ranking');
assert.equal(selectNowTask(tasks, 'missing', now).id, 'overdue');

const malformed = [
  { id: 'bad-date', content: 'Bad', priority: 4, due: dateOnly('2026-02-30') },
  { id: 'bad-string', content: 'Bad', priority: 4, due: dateOnly('yesterday-ish') },
  { id: 'real', content: 'Real', priority: 1, due: dateOnly('2026-09-30') }
];
assert.deepEqual(rankSuggestedTasks(malformed, now).map(task => task.id), ['real', 'bad-date', 'bad-string'], 'malformed dues join the undated fallback');
assert.equal(taskMeta({ content: 'Bad', priority: 4, due: dateOnly('2026-02-30') }, new Map(), now).includes('Overdue'), false, 'malformed dues are never labeled overdue');
assert.equal(taskMeta({ content: 'Bad', priority: 4, due: dateOnly('yesterday-ish') }, new Map(), now), 'P1');
assert.equal(taskMeta({ content: 'Ok', priority: 1, due: dateOnly('2026-09-30') }, new Map(), now), 'Sep 30');

const shuffled = [...tasks].reverse();
assert.deepEqual(rankSuggestedTasks(shuffled, now).map(task => task.id), rankSuggestedTasks(tasks, now).map(task => task.id), 'input order never affects ranking');
assert.deepEqual(selectHomepageTasks(), { tasks: [], currentIsOverride: false }, 'no tasks yields an empty list');
assert.equal(selectNowTask([], '', now), null, 'no tasks yields no suggestion');

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
assert.deepEqual(timeline.timed.map(row => row.id), ['cross-midnight', 'past', 'current-long', 'end-now', 'current-short', 'start-now', 'future']);
assert.deepEqual(timeline.timed.filter(row => row.state === 'current').map(row => row.id), ['current-long', 'current-short', 'start-now']);
assert.equal(timeline.timed.find(row => row.id === 'end-now').state, 'past', 'end equals now is past');
assert.equal(timeline.unavailable.find(row => row.id === 'bad-end').state, 'unknown', 'invalid intervals cannot become active');
assert.equal(timeline.timed.find(row => row.id === 'cross-midnight').color, '#a4BDFC');
assert.match(timeline.timed.find(row => row.id === 'cross-midnight').timeText, /Yesterday/, 'cross-midnight times retain date context');
assert.equal(timeline.marker.index, 6, 'the marker follows every start at or before now');
assert.equal(timeline.rows[6].type, 'now-marker');
assert.deepEqual(timeline.unavailable.map(row => row.id), ['bad-end', 'unavailable'], 'malformed times land under Time unavailable');

const fadeTimeline = buildDayTimeline([
  { id: 'just-ended', start: '2026-09-29T08:00:00', end: '2026-09-29T10:00:00' },
  { id: 'one-hour-old', start: '2026-09-29T07:00:00', end: '2026-09-29T09:00:00' },
  { id: 'old', start: '2026-09-29T06:00:00', end: '2026-09-29T08:00:00' }
], '2026-09-29', timelineNow);
assert.equal(fadeTimeline.timed.find(row => row.id === 'just-ended').pastFade, 1);
assert.equal(fadeTimeline.timed.find(row => row.id === 'one-hour-old').pastFade, 0.925);
assert.equal(fadeTimeline.timed.find(row => row.id === 'old').pastFade, 0.85);

const exclusiveAllDay = buildDayTimeline([
  { id: 'ended-before-today', isAllDay: true, start: '2026-09-28', end: '2026-09-29' },
  { id: 'invalid-earlier', isAllDay: true, start: '2026-09-28', end: '2026-09-28' }
], '2026-09-29', timelineNow);
assert.equal(exclusiveAllDay.allDay.length, 0, 'exclusive and invalid all-day end dates do not bleed into later days');
assert.equal(validateProviderColor('#A4BDFC'), '#A4BDFC');
assert.equal(validateProviderColor('rgb(0, 0, 0)'), '#73736c');

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
