import assert from 'node:assert/strict';
import {
  buildCreateTaskPayload,
  buildUpdateTaskPayload,
  createLatestRequestGuard,
  nextCurrentTaskIdAfterCompletion
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

assert.deepEqual(
  buildUpdateTaskPayload({ content: 'Updated', dueDate: '', originalDueDate: '', priority: '2' }),
  { content: 'Updated', priority: 2 }
);
assert.deepEqual(
  buildUpdateTaskPayload({ content: 'Recurring', dueDate: '2026-10-01', originalDueDate: '2026-09-29', priority: 3, preserveDue: true }),
  { content: 'Recurring', priority: 3 },
  'recurring task updates must not send a due-date mutation'
);
assert.deepEqual(
  buildUpdateTaskPayload({ content: 'Clear date', dueDate: '', originalDueDate: '2026-09-29', priority: 1 }),
  { content: 'Clear date', due_string: 'no date', priority: 1 }
);

assert.equal(nextCurrentTaskIdAfterCompletion('task-a', 'task-a'), '');
assert.equal(nextCurrentTaskIdAfterCompletion('task-a', 'task-b'), 'task-a');

const guard = createLatestRequestGuard();
const first = guard.begin();
const second = guard.begin();
assert.equal(guard.isLatest(first), false, 'older schedule responses must be ignored');
assert.equal(guard.isLatest(second), true);

console.log('planner action tests passed');
