export function buildCreateTaskPayload({ content, dueDate = '', priority = 1 }) {
  const title = String(content || '').trim();
  if (!title) throw new TypeError('Task title is required');
  const task = { content: title, priority: normalizePriority(priority) };
  if (dueDate) task.due_date = dueDate;
  return task;
}

export function buildUpdateTaskPayload({ content, dueDate = '', originalDueDate = '', priority = 1, preserveDue = false }) {
  const title = String(content || '').trim();
  if (!title) throw new TypeError('Task title is required');
  const changes = { content: title, priority: normalizePriority(priority) };
  if (!preserveDue && dueDate !== originalDueDate) {
    if (dueDate) changes.due_date = dueDate;
    else changes.due_string = 'no date';
  }
  return changes;
}

export function nextCurrentTaskIdAfterCompletion(currentTaskId, completedTaskId) {
  return String(currentTaskId || '') === String(completedTaskId || '') ? '' : String(currentTaskId || '');
}

export function createLatestRequestGuard() {
  let latest = 0;
  return {
    begin() {
      latest += 1;
      return latest;
    },
    isLatest(requestId) {
      return requestId === latest;
    }
  };
}

function normalizePriority(value) {
  const priority = Number(value);
  return Number.isInteger(priority) && priority >= 1 && priority <= 4 ? priority : 1;
}
