import { parseTaskDeadline, taskOverdueDays, toLocalDateKey } from './planner-model.js';
import { readableTagColor } from './planner-color.js';
import { createIconButton } from './planner-controls.js';

function iconMarkup(name) {
  return globalThis.Icons?.[name] || '';
}

// P1 is drawn in the theme ink (a heavier ring) rather than Todoist red so
// red stays exclusive to overdue work; P2/P3 are darkened to clear 3:1.
const PRIORITY_STYLES = {
  4: { label: 'P1', color: 'var(--nt-ink)' },
  3: { label: 'P2', color: '#c96f00' },
  2: { label: 'P3', color: '#1a5fcc' },
  1: { label: 'P4', color: '#767676' }
};

export function taskPriorityStyle(priority) {
  return PRIORITY_STYLES[Number(priority)] || PRIORITY_STYLES[1];
}

function overdueText(days) {
  return `${days} ${days === 1 ? 'day' : 'days'} overdue`;
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
    const shortDate = new Date(`${due}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    if (due < today) parts.push({ text: overdueText(taskOverdueDays(task, now)), kind: 'overdue' }, { text: shortDate });
    else if (due === today) parts.push({ text: 'Today' });
    else parts.push({ text: shortDate });
  }
  const project = projects.get(String(task.project_id));
  if (project?.name) parts.push({ text: project.name, color: project.color });
  for (const label of task.labels || []) {
    parts.push({ text: `@${label}`, color: labelColors.get(label) });
  }
  // Subtasks name their parent as the last part; the arrow keeps it from
  // reading as a duplicate of the parent's own row.
  if (task.parentContent) parts.push({ text: `\u21b3 ${task.parentContent}` });
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
  // The base hue only; newtab.css derives --task-priority-color from it so the
  // dark theme can lift P2/P3 (an inline --task-priority-color would win).
  row.style.setProperty('--task-priority-base', priority.color);
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
      if (part.kind === 'overdue') {
        row.classList.add('is-overdue');
        const late = document.createElement('span');
        late.className = 'planner-meta-overdue';
        late.innerHTML = iconMarkup('overdue');
        late.appendChild(document.createTextNode(part.text));
        meta.appendChild(late);
      } else if (part.color) {
        const tag = document.createElement('span');
        tag.className = 'planner-meta-tag';
        tag.style.setProperty('--tag-color', readableTagColor(part.color, theme));
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
