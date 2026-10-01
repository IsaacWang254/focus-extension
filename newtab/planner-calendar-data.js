// planner-calendar-data.js — per-date calendar loading with freshness gates,
// in-flight coalescing, bounded-concurrency range loading, scope invalidation
// and generation guards. Shared by the homepage timeline and the schedule
// so both read the same cached DayResult per local date.
//
// send(date) -> Promise<payload> where payload is the normalised
// GET_PLANNER_EVENTS result: { date, events, stale, partial, disconnected,
// status, error }.
// DayResult = { date, events, stale, partial, disconnected, error, status,
// attemptedAt, loadedAt }.

export function createPlannerCalendarData({
  send,
  now = () => Date.now(),
  gateMs = 5 * 60 * 1000,
  concurrency = 2,
  maxDates = 42
} = {}) {
  const cache = new Map();      // date -> DayResult
  const inflight = new Map();   // date -> Promise<DayResult>
  let scopeKey = null;
  let scopeRevision = 0;        // guards cache writes (setScope)
  let generation = 0;           // guards range callbacks/queues (setScope + cancel)

  function localDateKey(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // Bounded memory: keep at most maxDates cached days. Eviction targets the
  // oldest attemptedAt entries and never touches today or an in-flight date
  // (dropping an in-flight date would let a second request start for it).
  function evictOverflow() {
    if (cache.size <= maxDates) return;
    const today = localDateKey(now());
    const victims = [...cache.values()]
      .filter(result => result.date !== today && !inflight.has(result.date))
      .sort((a, b) => a.attemptedAt - b.attemptedAt);
    for (const victim of victims) {
      if (cache.size <= maxDates) break;
      cache.delete(victim.date);
    }
  }

  function toResult(date, payload, attemptedAt) {
    const events = Array.isArray(payload?.events) ? payload.events : [];
    return {
      date,
      events,
      stale: Boolean(payload?.stale),
      partial: Boolean(payload?.partial),
      disconnected: Boolean(payload?.disconnected),
      error: payload?.error ?? null,
      status: payload?.status ?? null,
      attemptedAt,
      loadedAt: now()
    };
  }

  // A cached result counts as "attempted recently" regardless of outcome —
  // errors, empty and disconnected results all gate retries, same as success.
  function gateOpen(date) {
    const cached = cache.get(date);
    return !cached || now() - cached.attemptedAt >= gateMs;
  }

  // force is a manual retry: it only bypasses the gate for dates whose cached
  // result is missing, an error, or disconnected. Healthy fresh dates always
  // return the cached result.
  function mayFetch(date, force) {
    if (gateOpen(date)) return true;
    if (!force) return false;
    const cached = cache.get(date);
    return !cached || Boolean(cached.error) || cached.disconnected;
  }

  function fetchDay(date) {
    let pending = inflight.get(date);
    if (pending) return pending;
    const attemptedAt = now();
    const rev = scopeRevision;
    pending = Promise.resolve()
      .then(() => send(date))
      .then(payload => {
        // A response addressed to another date, or arriving after the scope
        // changed, must not be stored under this date.
        if (!payload || payload.date !== date || rev !== scopeRevision) {
          return {
            date, events: [], stale: false, partial: false, disconnected: false,
            error: 'Calendar response did not match the requested date',
            status: payload?.status ?? null, attemptedAt, loadedAt: now()
          };
        }
        const result = toResult(date, payload, attemptedAt);
        cache.set(date, result);
        evictOverflow();
        return result;
      })
      .catch(err => {
        const result = {
          date, events: [], stale: false, partial: false, disconnected: false,
          error: err?.message ?? String(err), status: null,
          attemptedAt, loadedAt: now()
        };
        cache.set(date, result);
        evictOverflow();
        return result;
      })
      .finally(() => { if (inflight.get(date) === pending) inflight.delete(date); });
    inflight.set(date, pending);
    return pending;
  }

  function getDay(date, { force = false } = {}) {
    if (inflight.has(date)) return inflight.get(date);
    if (!mayFetch(date, force)) return Promise.resolve(cache.get(date));
    return fetchDay(date);
  }

  function loadRange(dates, { force = false, onDay } = {}) {
    const gen = generation;
    const unique = [...new Set(dates)];
    const results = new Map();
    const fetchSet = new Set(unique.filter(date => !inflight.has(date) && mayFetch(date, force)));
    for (const date of unique) {
      if (fetchSet.has(date)) continue;
      if (inflight.has(date)) {
        // Reuse the shared in-flight promise for this range too.
        fetchSet.add(date);
        continue;
      }
      const cached = cache.get(date);
      if (cached) {
        results.set(date, cached);
        onDay?.(date, cached);
      }
    }
    const eligible = unique.filter(date => fetchSet.has(date));
    let index = 0;
    const workers = Array.from({ length: Math.min(concurrency, eligible.length) }, async () => {
      while (index < eligible.length) {
        const date = eligible[index++];
        // Queued calls of a superseded generation are never dispatched;
        // already-running ones still populate the cache.
        if (generation !== gen) return;
        const result = await fetchDay(date);
        results.set(date, result);
        if (generation === gen) onDay?.(date, result);
      }
    });
    return { generation: gen, promise: Promise.all(workers).then(() => results) };
  }

  function setScope(key) {
    if (key === scopeKey) return;
    scopeKey = key;
    cache.clear();
    scopeRevision += 1;
    generation += 1;
  }

  function cancel() { generation += 1; }

  return {
    setScope,
    peek: date => cache.get(date) ?? null,
    getDay,
    loadRange,
    cancel
  };
}
