import assert from 'node:assert/strict';
import { taskPriorityStyle } from '../newtab/planner-tasks.js';

assert.deepEqual(taskPriorityStyle(4), { label: 'P1', color: '#dc4c3e' });
assert.deepEqual(taskPriorityStyle(3), { label: 'P2', color: '#eb8909' });
assert.deepEqual(taskPriorityStyle(2), { label: 'P3', color: '#246fe0' });
assert.deepEqual(taskPriorityStyle(1), { label: 'P4', color: '#808080' });
assert.deepEqual(taskPriorityStyle('unexpected'), { label: 'P4', color: '#808080' });

console.log('planner task presentation tests passed');
