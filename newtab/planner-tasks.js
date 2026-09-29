import { getTaskDueKey, groupTasks, toLocalDateKey } from './planner-model.js';

export function taskMeta(task, projects = new Map(), now = new Date()) {
  const parts = [];
  const due = getTaskDueKey(task);
  const today = toLocalDateKey(now);
  if (due) {
    if (due < today) parts.push('Overdue');
    else if (due === today) parts.push('Today');
    else parts.push(new Date(`${due}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  }
  const project = projects.get(String(task.project_id));
  if (project?.name && project.name !== 'Inbox') parts.push(project.name);
  if (Number(task.priority || 1) > 1) parts.push(`P${5 - Number(task.priority)}`);
  if (task.parentContent) parts.push(task.parentContent);
  return parts.join(' · ');
}

export function createTaskRow(task, options = {}) {
  const row = document.createElement('li');
  row.className = `planner-task-row${options.current ? ' is-current' : ''}`;
  row.dataset.taskId = task.id;

  const complete = document.createElement('button');
  complete.type = 'button';
  complete.className = 'planner-check';
  complete.setAttribute('aria-label', `Complete ${task.content}`);
  complete.disabled = options.pending === true;
  complete.classList.toggle('is-pending', options.pending === true);
  complete.addEventListener('click', () => options.onComplete?.(task, complete));

  const copy = document.createElement('div');
  copy.className = 'planner-row-copy';
  const title = document.createElement('span');
  title.className = 'planner-row-title';
  title.textContent = task.content;
  copy.appendChild(title);
  const metaText = taskMeta(task, options.projects, options.now);
  if (metaText) {
    const meta = document.createElement('span');
    meta.className = 'planner-row-meta';
    meta.textContent = metaText;
    copy.appendChild(meta);
  }

  row.append(complete, copy);

  if ((options.showCurrentAction && !options.current) || options.onEdit) {
    const actions = document.createElement('div');
    actions.className = 'planner-row-actions';
    if (options.showCurrentAction && !options.current) {
    const makeCurrent = document.createElement('button');
    makeCurrent.type = 'button';
    makeCurrent.className = 'planner-row-action';
    makeCurrent.textContent = 'Make current';
    makeCurrent.addEventListener('click', () => options.onMakeCurrent?.(task));
      actions.appendChild(makeCurrent);
    }
    if (options.onEdit) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'planner-row-action';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => options.onEdit(task));
      actions.appendChild(edit);
    }
    row.appendChild(actions);
  }
  return row;
}

export function renderTaskGroups(container, tasks, options = {}) {
  container.innerHTML = '';
  const groups = groupTasks(tasks, options.view, options.selectedDate);
  let count = 0;
  for (const group of groups) {
    const section = document.createElement('section');
    section.className = 'planner-drawer-group';
    const heading = document.createElement('h3');
    heading.textContent = group.label;
    const list = document.createElement('ul');
    list.className = 'planner-drawer-list';
    for (const task of group.tasks) {
      list.appendChild(createTaskRow(task, {
        ...options,
        current: String(task.id) === String(options.currentTaskId),
        pending: options.pendingTaskIds?.has(String(task.id)) === true,
        showCurrentAction: true
      }));
      count += 1;
    }
    if (!group.tasks.length) {
      const empty = document.createElement('p');
      empty.className = 'planner-empty-copy';
      empty.textContent = 'Nothing planned here.';
      section.append(heading, empty);
    } else {
      section.append(heading, list);
    }
    container.appendChild(section);
  }
  return count;
}
