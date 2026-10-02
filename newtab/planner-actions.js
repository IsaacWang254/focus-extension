export function buildCreateTaskPayload({ content, dueDate = '', priority = 1 }) {
  const title = String(content || '').trim();
  if (!title) throw new TypeError('Task title is required');
  const task = { content: title, priority: normalizePriority(priority) };
  if (dueDate) task.due_date = dueDate;
  return task;
}

/**
 * Build the updateTask body: only fields that actually changed are sent.
 * `dueString` is Todoist NLP text ('every Friday', 'tomorrow 4pm'); an empty
 * changed value clears the date via 'no date'. Recurrence is preserved by
 * Todoist's parser, so no preserveDue path is needed.
 */
export function buildUpdateTaskPayload({
  content,
  originalContent,
  dueString,
  originalDueString,
  priority,
  originalPriority,
  description,
  originalDescription,
  labels,
  originalLabels
} = {}) {
  const title = String(content || '').trim();
  if (!title) throw new TypeError('Task title is required');
  const changes = {};
  if (title !== String(originalContent ?? content).trim()) changes.content = title;
  const prio = normalizePriority(priority);
  if (prio !== normalizePriority(originalPriority ?? priority)) changes.priority = prio;
  const desc = String(description ?? '');
  if (desc !== String(originalDescription ?? description ?? '')) changes.description = desc;
  const due = String(dueString ?? '').trim();
  if (due !== String(originalDueString ?? dueString ?? '').trim()) changes.due_string = due || 'no date';
  if (labels !== undefined && labels !== null) {
    const next = [...labels].sort();
    const prev = [...(originalLabels || [])].sort();
    if (next.length !== prev.length || next.some((l, i) => l !== prev[i])) changes.labels = [...labels];
  }
  return changes;
}

// --- Quick Add text helpers -------------------------------------------------

const PRIORITY_TOKEN = /(^|\s)p([1-4])(?=\s|$)/i;

/** Quick-Add display number (P1 urgent … P4 none) present in the text. */
export function readPriorityToken(text) {
  const match = PRIORITY_TOKEN.exec(String(text || ''));
  return match ? Number(match[2]) : null;
}

/** Set/replace (n) or remove (null) the single pN token in the text. */
export function setPriorityToken(text, n) {
  const stripped = String(text || '')
    .replace(/(^|\s)p[1-4](?=\s|$)/gi, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\s+|\s+$/g, '');
  if (n == null) return stripped;
  return stripped ? `${stripped} p${n} ` : `p${n} `;
}

/**
 * The #project/@label token at (or just ended at) the caret. A token is the
 * marker plus unbroken non-space chars, honouring backslash escapes. Returns
 * { kind, start, end, query } with query already unescaped.
 */
export function tokenAtCaret(text, caret = String(text).length) {
  const head = String(text).slice(0, caret);
  const match = /([#@])((?:\\.|[^\s#@\\])*)$/.exec(head);
  if (!match) return { kind: null, start: caret, end: caret, query: '' };
  const start = caret - match[0].length;
  const tail = /^(?:\\.|[^\s\\])*/.exec(String(text).slice(caret))[0];
  return {
    kind: match[1],
    start,
    end: caret + tail.length,
    query: match[2].replace(/\\(.)/g, '$1')
  };
}

/** All #/@ tokens in the text, for the preview chips. */
export function parseQuickAddTokens(text) {
  const tokens = [];
  const re = /([#@])((?:\\.|[^\s\\])*)/g;
  let match;
  while ((match = re.exec(String(text || '')))) {
    tokens.push({
      kind: match[1],
      name: match[2].replace(/\\(.)/g, '$1'),
      start: match.index,
      end: match.index + match[0].length
    });
  }
  return tokens;
}

export function escapeQuickAddName(name) {
  return String(name).replace(/\\/g, '\\\\').replace(/ /g, '\\ ');
}

export function insertCompletion(text, token, name) {
  const before = String(text).slice(0, token.start);
  const after = String(text).slice(token.end).replace(/^\s+/, '');
  return `${before}${token.kind}${name} ${after}`;
}

/**
 * Escape multi-word #project/@label names for Todoist's Quick Add parser at
 * submit time. The input shows raw spaces; only here do known multi-word
 * names gain their `\ ` escapes. A marker only counts at index 0 or after
 * whitespace, and the longest matching name wins; everything else — single
 * words, `a@b.com`, pre-escaped text — passes through untouched.
 */
export function escapeQuickAddText(text, { projects = [], labels = [] } = {}) {
  const source = String(text || '');
  const namesByKind = { '#': projects, '@': labels };
  let result = '';
  let i = 0;
  while (i < source.length) {
    const marker = source[i];
    const names = namesByKind[marker];
    if (names && (i === 0 || /\s/.test(source[i - 1]))) {
      const match = names
        .filter(name => name && String(name).includes(' '))
        .sort((a, b) => String(b).length - String(a).length)
        .find(name => {
          const end = i + 1 + String(name).length;
          return source.slice(i + 1, end).toLowerCase() === String(name).toLowerCase()
            && (end >= source.length || /\s/.test(source[end]));
        });
      if (match) {
        const typed = source.slice(i + 1, i + 1 + String(match).length);
        result += marker + escapeQuickAddName(typed);
        i += 1 + typed.length;
        continue;
      }
    }
    result += marker;
    i += 1;
  }
  return result;
}

/**
 * Case-insensitive prefix matches first, then substring matches.
 * Items may be objects with .name or plain strings.
 */
export function matchSuggestions(items, query = '', limit = 6) {
  const q = String(query).toLowerCase();
  const named = items.map(item => ({ item, name: String(typeof item === 'string' ? item : item?.match ?? item?.name ?? '') }))
    .filter(entry => entry.name);
  const prefix = named.filter(({ name }) => name.toLowerCase().startsWith(q));
  const inside = named.filter(({ name }) => !name.toLowerCase().startsWith(q) && name.toLowerCase().includes(q));
  return [...prefix, ...inside].slice(0, limit).map(({ item }) => item);
}

/** Confirmation line describing what Todoist actually parsed. */
export function describeCreatedTask(task, projects = new Map()) {
  const parts = [`Added "${task.content}"`];
  const due = dueSnippet(task);
  if (due) parts.push(due);
  const project = projects.get(String(task.project_id));
  if (project) parts.push(`#${project.name}`);
  for (const label of task.labels || []) parts.push(`@${label}`);
  if (Number(task.priority) > 1) parts.push(`P${5 - task.priority}`);
  return parts.join(' · ');
}

function dueSnippet(task) {
  const due = task?.due;
  if (!due) return '';
  if (due.string) return due.string;
  const iso = due.datetime || due.date || '';
  if (!iso) return '';
  const hasTime = iso.includes('T');
  const d = hasTime ? new Date(iso) : new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = hasTime ? ` ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
  return date + time;
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
