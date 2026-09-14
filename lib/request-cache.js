const localLocks = new Map();

export function withSharedLock(name, callback) {
  if (globalThis.navigator?.locks?.request) return navigator.locks.request(name, callback);
  const result = (localLocks.get(name) || Promise.resolve()).catch(() => {}).then(callback);
  localLocks.set(name, result);
  return result.finally(() => { if (localLocks.get(name) === result) localLocks.delete(name); });
}

export async function cacheScope(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function getCachedResource(key, {
  scope = '', ttl, load, maxStale = 0, staleWhileRevalidate = false, force = false,
  isCurrent = async () => true
}) {
  const read = async () => (await chrome.storage.local.get(key))[key];
  const age = entry => Date.now() - entry.updatedAt;
  const hasValue = entry => entry?.scope === scope && Object.prototype.hasOwnProperty.call(entry, 'value');
  const fresh = entry => hasValue(entry) && age(entry) >= 0 && age(entry) < ttl;
  const usable = entry => hasValue(entry) && age(entry) >= 0 && age(entry) < ttl + maxStale;
  const checkCurrent = async () => { if (!await isCurrent()) throw new Error('Cached data context changed'); };
  await checkCurrent();
  const initial = await read();
  if (!force && fresh(initial)) return structuredClone(initial.value);
  const refresh = () => withSharedLock(`focus-cache:${key}`, async () => {
    await checkCurrent();
    const entry = await read();
    if (!force && fresh(entry)) return structuredClone(entry.value);
    if (entry?.scope === scope && entry.retryAt > Date.now() && (!force || [401, 403, 429].includes(entry.status))) {
      if (maxStale > 0 && usable(entry)) return structuredClone(entry.value);
      throw Object.assign(new Error(entry.error || 'Refresh temporarily unavailable'), { status: entry.status });
    }
    try {
      const value = await load();
      if (value === undefined) throw new Error('Empty API response');
      await checkCurrent();
      await chrome.storage.local.set({ [key]: { scope, value, updatedAt: Date.now() } });
      return structuredClone(value);
    } catch (error) {
      await checkCurrent();
      if (error.status === 401 || error.status === 403) {
        await chrome.storage.local.set({ [key]: {
          scope, retryAt: Date.now() + 60000, status: error.status,
          error: 'Refresh temporarily unavailable'
        } });
        throw error;
      }
      const retryDelay = Math.max(60000, Number.isFinite(Number(error.retryAfterMs)) ? Number(error.retryAfterMs) : 60000);
      await chrome.storage.local.set({ [key]: {
        ...(hasValue(entry) ? entry : {}), scope,
        retryAt: Date.now() + retryDelay, status: error.status || 0,
        error: 'Refresh temporarily unavailable'
      } });
      if (maxStale > 0 && usable(entry)) return structuredClone(entry.value);
      throw error;
    }
  });
  if (!force && staleWhileRevalidate && maxStale > 0 && usable(initial)) {
    refresh().catch(() => {});
    return structuredClone(initial.value);
  }
  return refresh();
}
