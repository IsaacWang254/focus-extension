import { toLocalDateKey } from './planner-model.js';

export const PLANNER_STATE_KEY = 'newtabPlannerState';
export const PLANNER_STATE_VERSION = 1;

export async function accountFingerprint(token = '') {
  if (!token) return '';
  if (globalThis.crypto?.subtle && typeof TextEncoder !== 'undefined') {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return Array.from(new Uint8Array(digest).slice(0, 8), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  let hash = 2166136261;
  for (const char of token) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export async function loadCurrentTaskState(storage, token, now = new Date()) {
  const account = await accountFingerprint(token);
  const result = await storage.get(PLANNER_STATE_KEY);
  const state = result?.[PLANNER_STATE_KEY];
  if (!account || state?.version !== PLANNER_STATE_VERSION || state.account !== account || state.date !== toLocalDateKey(now)) {
    return null;
  }
  return typeof state.taskId === 'string' && state.taskId ? state : null;
}

export async function saveCurrentTaskState(storage, token, taskId, now = new Date()) {
  const account = await accountFingerprint(token);
  if (!account || !taskId) return clearCurrentTaskState(storage);
  const state = { version: PLANNER_STATE_VERSION, account, date: toLocalDateKey(now), taskId: String(taskId) };
  await storage.set({ [PLANNER_STATE_KEY]: state });
  return state;
}

export async function clearCurrentTaskState(storage) {
  await storage.remove(PLANNER_STATE_KEY);
}
