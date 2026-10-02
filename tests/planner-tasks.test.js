import assert from 'node:assert/strict';
import { taskMeta, taskMetaParts, taskPriorityStyle } from '../newtab/planner-tasks.js';
import { TODOIST_COLORS, contrastRatio, readableTagColor, todoistColor } from '../newtab/planner-color.js';

assert.deepEqual(taskPriorityStyle(4), { label: 'P1', color: '#dc4c3e' });
assert.deepEqual(taskPriorityStyle(3), { label: 'P2', color: '#eb8909' });
assert.deepEqual(taskPriorityStyle(2), { label: 'P3', color: '#246fe0' });
assert.deepEqual(taskPriorityStyle(1), { label: 'P4', color: '#808080' });
assert.deepEqual(taskPriorityStyle('unexpected'), { label: 'P4', color: '#808080' });

// taskMetaParts: due → project → @labels → parentContent, no priority text.
const now = new Date('2026-09-30T12:00:00');
const projects = new Map([['p2', { id: 'p2', name: 'Focus extension', color: 'blue' }]]);
const labelColors = new Map([['deep work', 'yellow'], ['quick', 'green']]);

{
  const task = {
    id: 't', content: 'Task', priority: 4,
    due: { date: '2026-09-30' },
    project_id: 'p2',
    labels: ['deep work', 'quick'],
    parentContent: 'Parent task'
  };
  assert.deepEqual(taskMetaParts(task, projects, now, labelColors), [
    { text: 'Today' },
    { text: 'Focus extension', color: 'blue' },
    { text: '@deep work', color: 'yellow' },
    { text: '@quick', color: 'green' },
    { text: 'Parent task' }
  ], 'order: due, project, labels, parent — no priority part');
  assert.equal(taskMeta(task, projects, now, labelColors),
    'Today · Focus extension · @deep work · @quick · Parent task');
}

{
  // A label missing from labelColors comes back without a colour.
  const parts = taskMetaParts(
    { id: 't', content: 'Task', labels: ['unknown', 'deep work'] },
    projects, now, labelColors);
  assert.deepEqual(parts, [
    { text: '@unknown', color: undefined },
    { text: '@deep work', color: 'yellow' }
  ]);
}

{
  const parts = taskMetaParts({ content: 'Plain', priority: 4 }, new Map(), now);
  assert.deepEqual(parts, [], 'no meta when there is only a priority');
  assert.equal(taskMeta({ content: 'Plain', priority: 4 }, new Map(), now), '');
}

{
  const parts = taskMetaParts(
    { content: 'Late', due: { date: '2026-09-29' } }, new Map(), now);
  assert.deepEqual(parts, [{ text: 'Overdue' }]);
}

// readableTagColor: every Todoist colour resolves to ≥4.5:1 on theme paper.
const PAPERS = { light: '#fafafa', dark: '#141414' };
for (const theme of ['light', 'dark']) {
  for (const [name, hex] of Object.entries(TODOIST_COLORS)) {
    const resolved = readableTagColor(name, theme);
    assert.ok(contrastRatio(resolved, PAPERS[theme]) >= 4.5,
      `${name} on ${theme} reaches 4.5:1 (got ${resolved})`);
    assert.match(resolved, /^#[0-9a-f]{6}$/i);
  }
}
assert.equal(readableTagColor('blue', 'light'), todoistColor('blue'),
  'an already-readable colour comes back unchanged');
assert.ok(contrastRatio(readableTagColor(undefined, 'light'), PAPERS.light) >= 4.5,
  'a missing colour still resolves to a readable fallback');

console.log('planner task presentation tests passed');
