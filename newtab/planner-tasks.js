import { parseTaskDeadline, toLocalDateKey } from './planner-model.js';
import { readableTagColor } from './planner-color.js';
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

/**
 * The meta line as ordered parts. Due text first, then the project name,
 * one @name per label, then the parent task's content. Coloured parts carry
 * the provider colour; `taskMeta` joins the plain-text form.
 */
export function taskMetaParts(task, projects = new Map(), now = new Date(), labelColors = new Map()) {
  const parts = [];
  const deadline = parseTaskDeadline(task);
  const today = toLocalDateKey(now);
  if (deadline.kind !== 'none') {
    const due = deadline.localDate;
    if (due < today) parts.push({ text: 'Overdue' });
    else if (due === today) parts.push({ text: 'Today' });
    else parts.push({ text: new Date(`${due}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) });
  }
  const project = projects.get(String(task.project_id));
  if (project?.name) parts.push({ text: project.name, color: project.color });
  for (const label of task.labels || []) {
    parts.push({ text: `@${label}`, color: labelColors.get(label) });
  }
  if (task.parentContent) parts.push({ text: task.parentContent });
  return parts;
}

export function taskMeta(task, projects = new Map(), now = new Date(), labelColors = new Map()) {
  return taskMetaParts(task, projects, now, labelColors).map(part => part.text).join(' · ');
}

function currentTheme() {
  return document.documentElement?.dataset?.theme?.endsWith('dark') ? 'dark' : 'light';
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
  complete.innerHTML = '<svg class="planner-check-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 12.5l3.2 3.2L17 9" pathLength="1"/></svg>';
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
  const metaParts = taskMetaParts(task, options.projects, options.now, options.labelColors);
  if (metaParts.length) {
    const meta = document.createElement('span');
    meta.className = 'planner-row-meta';
    meta.id = `task-meta-${task.id}`;
    const theme = currentTheme();
    metaParts.forEach((part, index) => {
      if (index > 0) meta.appendChild(document.createTextNode(' · '));
      if (part.color) {
        const tag = document.createElement('span');
        tag.className = 'planner-meta-tag';
        tag.style.color = readableTagColor(part.color, theme);
        tag.textContent = part.text;
        meta.appendChild(tag);
      } else {
        meta.appendChild(document.createTextNode(part.text));
      }
    });
    copy.appendChild(meta);
    describedBy.push(meta.id);
  }

  if (describedBy.length) copy.setAttribute('aria-describedby', describedBy.join(' '));
  copy.addEventListener('click', event => options.onEdit?.(task, event.currentTarget, event.detail === 0));

  row.append(complete, copy);
  return row;
}
