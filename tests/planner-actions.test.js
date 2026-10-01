import assert from 'node:assert/strict';
import {
  buildCreateTaskPayload,
  buildUpdateTaskPayload,
  createLatestRequestGuard,
  describeCreatedTask,
  escapeQuickAddName,
  insertCompletion,
  matchSuggestions,
  parseQuickAddTokens,
  readPriorityToken,
  setPriorityToken,
  tokenAtCaret
} from '../newtab/planner-actions.js';

assert.deepEqual(
  buildCreateTaskPayload({ content: '  Review homepage  ', dueDate: '2026-09-29', priority: '4' }),
  { content: 'Review homepage', due_date: '2026-09-29', priority: 4 }
);
assert.deepEqual(
  buildCreateTaskPayload({ content: 'Inbox item', priority: 99 }),
  { content: 'Inbox item', priority: 1 }
);
assert.throws(() => buildCreateTaskPayload({ content: '   ' }), /required/);

// buildUpdateTaskPayload: only changed fields are sent.
assert.deepEqual(
  buildUpdateTaskPayload({ content: 'Same', originalContent: 'Same', priority: 2, originalPriority: 2 }),
  {},
  'unchanged fields produce no changes'
);
assert.deepEqual(
  buildUpdateTaskPayload({ content: 'Updated', originalContent: 'Old', priority: '2', originalPriority: 2 }),
  { content: 'Updated' }
);
assert.deepEqual(
  buildUpdateTaskPayload({ content: 'Due change', originalContent: 'Due change', dueString: 'every Friday', originalDueString: 'tomorrow', priority: 1, originalPriority: 1 }),
  { due_string: 'every Friday' },
  'changed due goes out as due_string (NLP, recurrence-safe)'
);
assert.deepEqual(
  buildUpdateTaskPayload({ content: 'Clear', originalContent: 'Clear', dueString: '', originalDueString: 'tomorrow', priority: 1, originalPriority: 1 }),
  { due_string: 'no date' },
  'clearing a changed due clears the date'
);
assert.deepEqual(
  buildUpdateTaskPayload({ content: 'P', originalContent: 'P', priority: 4, originalPriority: 1 }),
  { priority: 4 }
);
assert.deepEqual(
  buildUpdateTaskPayload({
    content: 'L', originalContent: 'L', priority: 1, originalPriority: 1,
    labels: ['deep', 'quick'], originalLabels: ['quick', 'deep']
  }),
  {},
  'same label set in different order is not a change'
);
assert.deepEqual(
  buildUpdateTaskPayload({
    content: 'L', originalContent: 'L', priority: 1, originalPriority: 1,
    labels: ['deep'], originalLabels: ['quick', 'deep']
  }),
  { labels: ['deep'] }
);
assert.deepEqual(
  buildUpdateTaskPayload({
    content: 'D', originalContent: 'D', priority: 1, originalPriority: 1,
    description: 'notes here', originalDescription: ''
  }),
  { description: 'notes here' }
);
assert.throws(() => buildUpdateTaskPayload({ content: ' ' }), /required/);

// readPriorityToken
assert.equal(readPriorityToken('fix bug p2'), 2);
assert.equal(readPriorityToken('p1 at start'), 1);
assert.equal(readPriorityToken('no flag'), null);
assert.equal(readPriorityToken('p10 is not a flag'), null, 'p10 must not read as p1');
assert.equal(readPriorityToken('top1 not a flag'), null);
assert.equal(readPriorityToken('trailing p4'), 4);
assert.equal(readPriorityToken('cap P3 works'), 3);

// setPriorityToken
assert.equal(setPriorityToken('fix bug', 2), 'fix bug p2 ');
assert.equal(setPriorityToken('fix bug p2', 1), 'fix bug p1 ', 'replaces the token, no duplicates');
assert.equal(setPriorityToken('p3 alone', 2), 'alone p2 ');
assert.equal(setPriorityToken('fix p2 bug p3 twice', 4), 'fix bug twice p4 ', 'strips stray extra tokens');
assert.equal(setPriorityToken('fix bug p2', null), 'fix bug');
assert.equal(setPriorityToken('', 1), 'p1 ');

// tokenAtCaret
assert.deepEqual(tokenAtCaret('task #Foc', 9), { kind: '#', start: 5, end: 9, query: 'Foc' });
assert.deepEqual(tokenAtCaret('task @de', 8), { kind: '@', start: 5, end: 8, query: 'de' });
assert.equal(tokenAtCaret('plain text', 5).kind, null);
assert.deepEqual(tokenAtCaret('#tag mid token', 4), { kind: '#', start: 0, end: 4, query: 'tag' }, 'caret at the end of a token still finds it');
assert.deepEqual(tokenAtCaret('#Focus more', 3), { kind: '#', start: 0, end: 6, query: 'Fo' }, 'caret inside a token still finds it');
assert.deepEqual(tokenAtCaret('a #one #tw', 10), { kind: '#', start: 7, end: 10, query: 'tw' }, 'last token wins');
assert.equal(tokenAtCaret('a #done more', 10).kind, null, 'caret after a completed token + space');
assert.deepEqual(tokenAtCaret('#naïveté', 8), { kind: '#', start: 0, end: 8, query: 'naïveté' }, 'unicode names');

// parseQuickAddTokens incl. escaped spaces
assert.deepEqual(
  parseQuickAddTokens('do it #Focus\\ extension @deep more'),
  [{ kind: '#', name: 'Focus extension', start: 6, end: 23 }, { kind: '@', name: 'deep', start: 24, end: 29 }]
);
assert.deepEqual(parseQuickAddTokens('none'), []);
assert.deepEqual(parseQuickAddTokens('#a #b'), [
  { kind: '#', name: 'a', start: 0, end: 2 },
  { kind: '#', name: 'b', start: 3, end: 5 }
]);

// escapeQuickAddName / insertCompletion
assert.equal(escapeQuickAddName('Focus extension'), 'Focus\\ extension');
assert.equal(escapeQuickAddName('Søren K'), 'Søren\\ K');
assert.equal(insertCompletion('write #Foc today', { kind: '#', start: 6, end: 10, query: 'Foc' }, 'Focus extension'), 'write #Focus\\ extension today');
assert.equal(insertCompletion('#Foc', { kind: '#', start: 0, end: 4, query: 'Foc' }, 'Focus extension'), '#Focus\\ extension ');
assert.equal(insertCompletion('x #Foc', { kind: '#', start: 2, end: 6, query: 'Foc' }, 'Done'), 'x #Done ');

// matchSuggestions
const items = [{ name: 'Focus extension' }, { name: 'Focusrite' }, { name: 'Unfocused' }, { name: 'Other' }];
assert.deepEqual(matchSuggestions(items, 'foc').map(i => i.name), ['Focus extension', 'Focusrite', 'Unfocused']);
assert.deepEqual(matchSuggestions(items, 'foc', 2).map(i => i.name), ['Focus extension', 'Focusrite'], 'limit applies');
assert.deepEqual(matchSuggestions(items, '').map(i => i.name), ['Focus extension', 'Focusrite', 'Unfocused', 'Other']);
assert.deepEqual(matchSuggestions(items, 'zzz'), []);
assert.deepEqual(matchSuggestions(['Alpha', 'beta'], 'AL'), ['Alpha'], 'plain strings + case-insensitive');

// describeCreatedTask
const projects = new Map([['p2', { id: 'p2', name: 'Focus extension' }]]);
assert.equal(
  describeCreatedTask({ content: 'Review PR', due: { string: 'Tomorrow 4 PM' }, project_id: 'p2', labels: ['deep'], priority: 3 }, projects),
  'Added "Review PR" · Tomorrow 4 PM · #Focus extension · @deep · P2'
);
assert.equal(describeCreatedTask({ content: 'Plain', priority: 1 }, projects), 'Added "Plain"');
assert.equal(
  describeCreatedTask({ content: 'Dated', due: { date: '2026-10-01', is_recurring: false } }, projects),
  'Added "Dated" · Thu, Oct 1'
);

const guard = createLatestRequestGuard();
const first = guard.begin();
const second = guard.begin();
assert.equal(guard.isLatest(first), false, 'older schedule responses must be ignored');
assert.equal(guard.isLatest(second), true);

console.log('planner action tests passed');
