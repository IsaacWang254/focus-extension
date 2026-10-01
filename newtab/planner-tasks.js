import { parseTaskDeadline, toLocalDateKey } from './planner-model.js';
import { createIconButton } from './planner-controls.js';

function iconMarkup(name) {
  return globalThis.Icons?.[name] || '';
}

const PRIORITY_STYLES = {
  4: { label: 'P1', color: '#dc4c3e' },
  3: { label: 'P2', color: '#eb8909' },
  2: { label: 'P3', color: '#246fe0' },
  1: { label: 'P4', color: '#808080' }
};

export function taskPriorityStyle(priority) {
  return PRIORITY_STYLES[Number(priority)] || PRIORITY_STYLES[1];
}

export function taskMeta(task, projects = new Map(), now = new Date()) {
  const parts = [];
  const deadline = parseTaskDeadline(task);
  const today = toLocalDateKey(now);
  if (deadline.kind !== 'none') {
    const due = deadline.localDate;
    if (due < today) parts.push('Overdue');
    else if (due === today) parts.push('Today');
    else parts.push(new Date(`${due}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  }
  const project = projects.get(String(task.project_id));
  if (Number(task.priority || 1) > 1) parts.push(`P${5 - Number(task.priority)}`);
  if (project?.name) parts.push(project.name);
  if (task.parentContent) parts.push(task.parentContent);
  return parts.join(' · ');
}

export function createTaskRow(task, options = {}) {
  const row = document.createElement('li');
  row.className = `planner-task-row${options.current ? ' is-current' : ''}`;
  row.dataset.taskId = task.id;
  const priority = taskPriorityStyle(task.priority);
  row.style.setProperty('--task-priority-color', priority.color);
  row.dataset.priority = priority.label;

  const complete = document.createElement('button');
  complete.type = 'button';
  complete.className = 'planner-check';
  complete.setAttribute('aria-label', `Complete ${task.content}, ${priority.label} priority`);
  complete.disabled = options.pending === true;
  complete.classList.toggle('is-pending', options.pending === true);
  complete.addEventListener('click', () => options.onComplete?.(task, complete));

  // The copy area is a real button: it opens the Edit task modal.
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'planner-row-copy task-open';
  copy.setAttribute('aria-label', task.content || 'Task');
  const title = document.createElement('span');
  title.className = 'planner-row-title';
  title.textContent = task.content;
  copy.appendChild(title);
  const describedBy = [];
  const metaText = taskMeta(task, options.projects, options.now);
  if (metaText) {
    const meta = document.createElement('span');
    meta.className = 'planner-row-meta';
    meta.id = `task-meta-${task.id}`;
    meta.textContent = metaText;
    copy.appendChild(meta);
    describedBy.push(meta.id);
  }

  if (describedBy.length) copy.setAttribute('aria-describedby', describedBy.join(' '));
  copy.addEventListener('click', event => options.onEdit?.(task, event.currentTarget, event.detail === 0));

  row.append(complete, copy);
  return row;
}
