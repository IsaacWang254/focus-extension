/**
 * Preview-only chrome.* shim, injected by scripts/preview/serve.mjs into
 * options.html and newtab.html so those surfaces render with
 * realistic fixture data outside the extension. Never shipped: the server
 * injects it at request time, the files on disk are untouched.
 */
(() => {
  if (typeof globalThis.chrome !== 'undefined' && globalThis.chrome.runtime?.id !== undefined) return;

  // ?preview-now=YYYY-MM-DDTHH:MM pins the clock to that local time so the
  // preview matches the reference mocks; the frozen clock still advances
  // normally from that instant.
  const previewNowParam = new URLSearchParams(location.search).get('preview-now');
  if (previewNowParam) {
    const m = previewNowParam.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (m) {
      const base = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
      const boot = performance.now();
      const RealDate = Date;
      globalThis.Date = class PreviewDate extends RealDate {
        constructor(...args) {
          super(...(args.length ? args : [base + (performance.now() - boot)]));
        }
        static now() { return base + (performance.now() - boot); }
      };
    }
  }

  const now = Date.now();
  const localDateKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayIso = localDateKey(new Date());

  // ---------------------------------------------------------------------------
  // Fixture data
  // ---------------------------------------------------------------------------

  const SETTINGS = {
    newtabShowWeather: true,
    newtabShowCalendar: true,
    newtabShowTodos: true,
    newtabTempUnit: 'C'
  };

  const CALENDAR_LIST = [
    { id: 'primary', name: 'Personal', color: '#33b679', primary: true },
    { id: 'team', name: 'Team', color: '#e67c73' },
    { id: 'work', name: 'Work', color: '#4285f4' }
  ];

  const aroundNow = minutes => new Date(now + minutes * 60 * 1000).toISOString();

  const TEAM = '#e67c73', WORK = '#4285f4', PERSONAL = '#33b679';
  const gcal = id => `https://calendar.google.com/calendar/event?eid=${id}`;
  const ev = (id, day, start, end, title, calendarId, color, extra = {}) => ({
    id, calendarId, calendarName: { team: 'Team', work: 'Work', personal: 'Personal' }[calendarId],
    title, color, start: `${day}T${start}:00`, end: `${day}T${end}:00`, htmlLink: gcal(id), ...extra
  });
  const ad = (id, start, end, title, calendarId, color) => ({
    id, calendarId, calendarName: { team: 'Team', work: 'Work', personal: 'Personal' }[calendarId],
    title, color, start, end, isAllDay: true, htmlLink: gcal(id)
  });
  const W = d => `2026-0${d}`; // 2026-09-28..30, 2026-10-01..04
  const MOCK_EVENTS = [
    ad('w-offsite', '2026-09-28', '2026-10-01', 'Offsite planning', 'team', TEAM),
    ad('w-ship', '2026-09-30', '2026-10-01', 'Ship day', 'work', WORK),
    ad('w-ana', '2026-10-03', '2026-10-05', 'Ana visiting', 'personal', PERSONAL),
    // Mon 28
    ev('m-standup', '2026-09-28', '08:30', '09:00', 'Standup', 'team', TEAM),
    ev('m-sprint', '2026-09-28', '10:00', '11:30', 'Sprint planning', 'team', TEAM),
    ev('m-lunch', '2026-09-28', '12:00', '13:00', 'Lunch', 'personal', PERSONAL),
    ev('m-focus', '2026-09-28', '14:00', '16:00', 'Focus block', 'work', WORK),
    // Tue 29
    ev('t-standup', '2026-09-29', '08:30', '09:00', 'Standup', 'team', TEAM),
    ev('t-interview', '2026-09-29', '09:30', '10:30', 'Interview: design lead', 'team', TEAM),
    ev('t-deep', '2026-09-29', '11:00', '12:30', 'Deep work: options page', 'work', WORK),
    ev('t-dentist', '2026-09-29', '15:00', '16:00', 'Dentist', 'personal', PERSONAL),
    // Wed 30 (today in the mock)
    ev('w-standup', '2026-09-30', '08:30', '09:00', 'Standup', 'team', TEAM),
    ev('w-deep', '2026-09-30', '09:00', '10:30', 'Deep work: homepage grid', 'work', WORK),
    ev('w-review', '2026-09-30', '10:00', '11:00', 'Product review', 'team', TEAM, { meetingUrl: 'https://meet.google.com/example' }),
    ev('w-coffee', '2026-09-30', '10:30', '10:45', 'Coffee with Ana', 'personal', PERSONAL),
    ev('w-priya', '2026-09-30', '11:30', '12:00', '1:1 with Priya', 'work', WORK),
    ev('w-lunch', '2026-09-30', '12:00', '13:00', 'Lunch', 'personal', PERSONAL),
    ev('w-design', '2026-09-30', '14:00', '15:30', 'Design review', 'team', TEAM),
    ev('w-leo', '2026-09-30', '16:00', '16:30', 'Sync with Leo', 'work', WORK),
    ev('w-gym', '2026-09-30', '17:30', '18:30', 'Gym', 'personal', PERSONAL),
    ev('w-dinner', '2026-09-30', '19:00', '21:00', 'Dinner with Sam', 'personal', PERSONAL),
    // Thu 01
    ev('h-standup', '2026-10-01', '08:30', '09:00', 'Standup', 'team', TEAM),
    ev('h-sprint', '2026-10-01', '10:00', '11:00', 'Sprint review', 'team', TEAM),
    ev('h-leo', '2026-10-01', '11:00', '11:30', '1:1 with Leo', 'work', WORK),
    ev('h-lunch', '2026-10-01', '12:00', '13:00', 'Lunch', 'personal', PERSONAL),
    ev('h-crit', '2026-10-01', '14:30', '15:30', 'Design crit', 'team', TEAM),
    ev('h-yoga', '2026-10-01', '18:00', '19:00', 'Yoga', 'personal', PERSONAL),
    // Fri 02
    ev('f-standup', '2026-10-02', '08:30', '09:00', 'Standup', 'team', TEAM),
    ev('f-demo', '2026-10-02', '09:00', '10:30', 'Demo prep', 'work', WORK),
    ev('f-teamdemo', '2026-10-02', '11:00', '12:00', 'Team demo', 'team', TEAM),
    ev('f-lunch', '2026-10-02', '12:30', '13:30', 'Lunch with Ana', 'personal', PERSONAL),
    ev('f-retro', '2026-10-02', '15:00', '16:00', 'Retro', 'team', TEAM),
    // Sat 03 / Sun 04
    ev('s-market', '2026-10-03', '09:00', '10:00', 'Farmers market', 'personal', PERSONAL),
    ev('s-hike', '2026-10-03', '11:00', '14:00', 'Hike', 'personal', PERSONAL),
    ev('u-brunch', '2026-10-04', '11:00', '12:30', 'Brunch', 'personal', PERSONAL)
  ];
  const eventsForDate = date => MOCK_EVENTS.filter(event => {
    const s = String(event.start).slice(0, 10);
    const e = String(event.end).slice(0, 10);
    if (event.isAllDay) return s <= date && e > date;
    return s === date || (e > date && s < date);
  });
  // ---------------------------------------------------------------------------
  // ?preview-fixture=<name> — targeted fixture matrices for verification.
  // Combinable with ?preview-now. Each fixture may override the task list,
  // the per-date event source, calendar/todoist health, and mutation behavior.
  // ---------------------------------------------------------------------------
  const fixtureName = new URLSearchParams(location.search).get('preview-fixture') || '';
  // Mutable health flags so recovery flows (Connect/Reconnect) visibly succeed.
  let calConnected = true;
  let calRecovered = false;
  const D = todayIso;
  const DD = off => localDateKey(new Date(now + off * 864e5));
  const cals = { team: 'Team', work: 'Work', personal: 'Personal' };
  const fxEv = (id, start, end, title, calendarId = 'work', color = WORK, extra = {}) => ({
    id, calendarId, calendarName: cals[calendarId], title, color, start, end,
    htmlLink: `https://calendar.google.com/calendar/event?eid=${id}`, ...extra
  });
  const fev = (id, start, end, title, calendarId, color, extra = {}) =>
    fxEv(id, `${D}T${start}:00`, `${D}T${end}:00`, title, calendarId, color, extra);
  const fad = (id, start, end, title, calendarId, color) =>
    fxEv(id, start, end, title, calendarId, color, { isAllDay: true });

  const FIXTURES = {
    // Overlap stress: nested + transitive chains, identical start/end ties
    // delivered shuffled, back-to-back touching intervals, four-way lanes.
    dense: { events: () => [
      fev('dn-d', '09:30', '10:00', 'Tie B', 'work', WORK),
      fev('dn-a', '09:00', '10:00', 'Nested outer', 'team', TEAM),
      fev('dn-c', '09:30', '10:30', 'Transitive tail', 'personal', PERSONAL),
      fev('dn-b', '09:15', '09:45', 'Nested inner', 'work', WORK),
      fev('dn-e', '09:30', '10:00', 'Tie A', 'team', TEAM),
      fev('dn-f', '10:30', '11:00', 'Touch second', 'personal', PERSONAL),
      fev('dn-g', '10:00', '10:30', 'Touch first', 'personal', PERSONAL),
      fev('ln-1', '12:00', '13:00', 'Lane one', 'team', TEAM),
      fev('ln-2', '12:00', '13:00', 'Lane two', 'work', WORK),
      fev('ln-3', '12:00', '13:00', 'Lane three', 'personal', PERSONAL),
      fev('ln-4', '12:00', '13:00', 'Lane four', 'team', TEAM)
    ] },
    // Threshold probe: 1/5/15/30/45-minute events straddle the 22/44px lines.
    tiny: { events: () => [
      fev('ty-1', '08:00', '08:01', 'One minute', 'work', WORK),
      fev('ty-5', '08:15', '08:20', 'Five minutes', 'work', WORK),
      fev('ty-15', '08:45', '09:00', 'Quarter hour', 'team', TEAM),
      fev('ty-30', '09:30', '10:00', 'Half hour stand', 'team', TEAM),
      fev('ty-45', '10:30', '11:15', 'Forty five minute working session', 'work', WORK),
      fev('ty-90', '12:00', '13:30', 'Ninety minute block', 'personal', PERSONAL)
    ] },
    // Length stress: multi-hour, cross-midnight in both directions, long title.
    long: { events: () => [
      fxEv('lg-prev', `${DD(-1)}T22:00:00`, `${D}T01:00:00`, 'Late deploy watch', 'work', WORK),
      fev('lg-long', '09:00', '12:30', 'Quarterly planning marathon session with the entire product organization', 'team', TEAM),
      fxEv('lg-next', `${D}T22:30:00`, `${DD(1)}T00:30:00`, 'Midnight maintenance window', 'work', WORK)
    ] },
    // Six all-day events incl. multi-day, exercising the >3 disclosure.
    'allday-many': { events: () => [
      fad('am-1', DD(-2), DD(1), 'Offsite planning', 'team', TEAM),
      fad('am-2', D, DD(1), 'Ship day', 'work', WORK),
      fad('am-3', D, DD(1), 'Company holiday', 'personal', PERSONAL),
      fad('am-4', D, DD(1), 'Conference day one', 'team', TEAM),
      fad('am-5', DD(-1), DD(3), 'Ana visiting', 'personal', PERSONAL),
      fad('am-6', D, DD(1), 'Reading day', 'work', WORK),
      fev('am-t1', '10:00', '11:00', 'Standup', 'team', TEAM)
    ] },
    'allday-only': { events: () => [
      fad('ao-1', D, DD(1), 'Ship day', 'work', WORK),
      fad('ao-2', DD(-1), DD(2), 'Offsite planning', 'team', TEAM)
    ] },
    empty: { tasks: [], events: () => [] },
    // Malformed intervals land in Time unavailable; malformed colours neutral.
    invalid: { events: () => [
      fxEv('iv-1', '', '', 'No times at all', 'team', TEAM),
      fxEv('iv-2', `${D}T14:00:00`, `${D}T13:00:00`, 'Backwards meeting', 'work', WORK),
      fxEv('iv-3', `${D}T09:00:00`, `${D}T09:00:00`, 'Zero length sync', 'personal', PERSONAL),
      fxEv('iv-4', 'not-a-date', 'also-not', 'Garbage timestamps', 'work', WORK),
      fev('iv-5', '15:00', '16:00', 'Bad colour event', 'team', 'not-a-colour'),
      fev('iv-6', '16:30', '17:00', 'Normal event', 'personal', PERSONAL)
    ] },
    // Per-day health spread for the week view: today ok, +1 error, +2 stale,
    // +3 partial, the rest healthy.
    'week-mixed': {
      events: date => eventsForDate(date),
      perDay: date => {
        if (date === DD(1)) return { error: 'Calendar refresh failed', status: 503, events: [] };
        if (date === DD(2)) return { stale: true };
        if (date === DD(3)) return { partial: true };
        return {};
      }
    },
    'cal-disconnected': { calendarConnected: false },
    'cal-expired': { perDay: () => calRecovered ? {} : ({ events: [], disconnected: true, status: 401, error: 'Not connected to Google Calendar' }) },
    'cal-error': { perDay: () => calRecovered ? {} : ({ events: [], partial: true, status: 503, error: 'Calendar refresh temporarily unavailable' }) },
    'todoist-disconnected': { todoistDisconnected: true },
    'todoist-error': { todoistError: true },
    'mutation-fail': { mutationFail: true },
    // Suggestion-ordering probes plus an arbitrary timing field that must
    // not produce timing UI.
    suggest: {
      tasks: [
        { id: 'sg-early-low', content: 'Earlier low-priority errand', priority: 1, labels: [], due: { date: D, string: 'today' }, order: 1 },
        { id: 'sg-later-high', content: 'Later high-priority review', priority: 4, labels: [], due: { date: D, string: 'today' }, order: 2 },
        { id: 'sg-timed', content: 'Timed deadline at 15:00', priority: 2, labels: [], due: { date: `${D}T15:00:00`, string: 'today at 3pm' }, order: 3 },
        { id: 'sg-later', content: 'Later weekend errand', priority: 1, labels: [], duration: { amount: 45, unit: 'minute' }, due: { date: DD(3), string: 'Saturday' }, order: 4 },
        { id: 'sg-bad', content: 'Malformed due date task', priority: 2, labels: [], due: { date: '2026-02-30', string: 'nonsense' }, order: 5 },
        { id: 'sg-none', content: 'Undated task', priority: 3, labels: [], order: 6 }
      ]
    },
    'future-only': { tasks: [
      { id: 'ft-1', content: 'Tomorrow morning review', priority: 2, labels: [], due: { date: DD(1), string: 'tomorrow' }, order: 1 },
      { id: 'ft-2', content: 'Next week planning', priority: 1, labels: [], due: { date: DD(5), string: 'Monday' }, order: 2 },
      { id: 'ft-3', content: 'Undated someday item', priority: 3, labels: [], order: 3 }
    ] },
    // Edit-form probe: one recurring task (Due date locked) + one normal +
    // one in a project id absent from the project list (e.g. a shared project).
    recurring: { tasks: [
      { id: 'rc-1', content: 'Weekly review ritual', priority: 2, labels: [], project_id: 'p1', due: { date: D, string: 'every Friday', is_recurring: true }, order: 1 },
      { id: 'rc-2', content: 'Plain one-off task', priority: 1, labels: [], project_id: 'p3', due: { date: DD(1), string: 'tomorrow' }, order: 2 },
      { id: 'rc-3', content: 'Shared-space task', priority: 1, labels: [], project_id: 'shared-9', order: 3 }
    ] }
  };
  const fixture = FIXTURES[fixtureName] || null;

  const tomorrowIso = localDateKey(new Date(now + 864e5));

  const EVENTS = [
    { id: 'e1', calendarId: 'work', title: 'Deep work: homepage direction', start: aroundNow(-150), end: aroundNow(-70), color: '#246fe0', calendarName: 'Work', location: 'Studio', htmlLink: gcal('e1') },
    { id: 'e2', calendarId: 'team', title: 'Product review', start: aroundNow(-25), end: aroundNow(35), color: '#dc4c3e', calendarName: 'Team', meetingUrl: 'https://meet.google.com/example', htmlLink: gcal('e2') },
    { id: 'e3', calendarId: 'work', title: 'Review pull requests', start: aroundNow(65), end: aroundNow(125), color: '#059669', calendarName: 'Work', htmlLink: gcal('e3') },
    { id: 'e4', calendarId: 'work', title: 'Ship day', start: todayIso, end: tomorrowIso, isAllDay: true, color: '#eb8909', calendarName: 'Work', htmlLink: gcal('e4') }
  ];

  const due = (offsetDays, label) => ({ date: localDateKey(new Date(now + offsetDays * 864e5)), string: label, is_recurring: false });

  const TASKS = [
    { id: 't1', content: 'Finish the blocked-page restyle', priority: 4, labels: ['deep-work'], project_id: 'p2', due: due(0, 'today'), order: 1 },
    { id: 't2', content: 'Write design token tests for options page', priority: 3, labels: [], project_id: 'p2', due: due(0, 'today'), order: 2 },
    { id: 't3', content: 'Reply to worker deploy thread', priority: 2, labels: ['quick'], project_id: 'p1', due: due(-1, 'yesterday'), order: 3 },
    { id: 't4', content: 'Read the OKLCH color article', priority: 1, labels: [], due: null, order: 4 },
    { id: 't5', content: 'Plan next week', priority: 1, labels: [], due: due(2, 'Tuesday'), order: 5 },
    { id: 't1a', content: 'Unify unblock rail spacing', parent_id: 't1', priority: 2, labels: [], due: null, order: 1 },
    { id: 't1b', content: 'Check dark theme contrast', parent_id: 't1', priority: 2, labels: [], due: null, order: 2 }
  ];

  const COMPLETED = [
    { id: 'c1', content: 'Morning review', completed_at: new Date(now - 2 * 36e5).toISOString() },
    { id: 'c2', content: 'Inbox zero pass', completed_at: new Date(now - 5 * 36e5).toISOString() }
  ];

  // ---------------------------------------------------------------------------
  // chrome.storage.local (in-memory)
  // ---------------------------------------------------------------------------

  const params = new URLSearchParams(window.location.search);

  const store = {
    theme: params.get('preview-theme') === 'dark' ? 'dark' : 'light',
    themeSyncWithBrowser: false,
    todoistToken: 'preview-token',
    settings: { ...SETTINGS },
    calendarSettings: {
      connected: true,
      email: 'preview@example.com',
      selectedCalendars: ['primary', 'work', 'team'],
      calendarListCache: structuredClone(CALENDAR_LIST)
    },
    weatherCache: {
      current: { temperature_2m: 21.4, weather_code: 2, is_day: 1 },
      daily: { temperature_2m_max: [24.1], temperature_2m_min: [16.3] }
    },
    weatherCacheTime: now
  };
  if (params.get('preview-state') === 'todoist-disconnected' || fixture?.todoistDisconnected) delete store.todoistToken;

  const changeListeners = [];
  // Cross-page sync: settings changes in the options preview must reach open
  // new-tab previews, so writes broadcast the diff to sibling tabs.
  const channel = typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('focus-preview-storage')
    : null;
  const applyRemoteValues = (values) => {
    const changes = {};
    for (const [k, v] of Object.entries(values)) {
      changes[k] = { oldValue: store[k], newValue: v };
      store[k] = v;
    }
    changeListeners.forEach((fn) => fn(changes, 'local'));
  };
  if (channel) {
    channel.onmessage = (event) => applyRemoteValues(event.data || {});
  }
  const normalize = (keys) => {
    if (keys == null) return { ...store };
    if (typeof keys === 'string') return keys in store ? { [keys]: store[keys] } : {};
    if (Array.isArray(keys)) return keys.reduce((acc, k) => (k in store && (acc[k] = store[k]), acc), {});
    return Object.entries(keys).reduce((acc, [k, fallback]) => (acc[k] = k in store ? store[k] : fallback, acc), {});
  };

  const storageArea = {
    get(keys, cb) {
      const result = normalize(typeof keys === 'function' ? null : keys);
      const callback = typeof keys === 'function' ? keys : cb;
      if (callback) { callback(result); return undefined; }
      return Promise.resolve(result);
    },
    set(values, cb) {
      const changes = {};
      for (const [k, v] of Object.entries(values)) { changes[k] = { oldValue: store[k], newValue: v }; store[k] = v; }
      changeListeners.forEach((fn) => fn(changes, 'local'));
      channel?.postMessage(values);
      if (cb) { cb(); return undefined; }
      return Promise.resolve();
    },
    remove(keys, cb) {
      (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete store[k]);
      if (cb) { cb(); return undefined; }
      return Promise.resolve();
    }
  };

  // ---------------------------------------------------------------------------
  // Message fixtures
  // ---------------------------------------------------------------------------

  // ?preview-state=calendar-disconnected | calendar-expired | calendar-error |
  // calendar-stale | empty | mutation-error | todoist-disconnected — exercise
  // the new tab's health variants.
  const previewState = params.get('preview-state');
  if (fixture?.calendarConnected === false || previewState === 'calendar-disconnected') calConnected = false;
  if (!calConnected) store.calendarSettings.connected = false;
  // ?preview-hide=todos,calendar — exercise the new tab's hidden-panel layouts.
  (params.get('preview-hide') || '').split(',').forEach((part) => {
    if (part === 'todos') store.settings.newtabShowTodos = false;
    if (part === 'calendar') store.settings.newtabShowCalendar = false;
  });

  const respond = (message) => {
    switch (message.type) {
      case 'GET_SETTINGS': return structuredClone(store.settings);
      case 'UPDATE_SETTINGS': {
        storageArea.set({ settings: { ...store.settings, ...message.settings } });
        return { success: true };
      }
      case 'GET_CALENDAR_STATUS': {
        const cs = store.calendarSettings;
        return {
          connected: (calConnected || calRecovered) && cs.connected !== false,
          email: cs.email || 'preview@example.com',
          selectedCalendars: cs.selectedCalendars || [],
          calendars: cs.calendarListCache || []
        };
      }
      case 'CONNECT_GOOGLE_CALENDAR':
        calConnected = true; calRecovered = true;
        storageArea.set({ calendarSettings: { ...store.calendarSettings, connected: true } });
        return { success: true, calendars: structuredClone(CALENDAR_LIST) };
      case 'DISCONNECT_GOOGLE_CALENDAR':
        calConnected = false; calRecovered = false;
        storageArea.set({ calendarSettings: { ...store.calendarSettings, connected: false, selectedCalendars: [], calendarListCache: [] } });
        return { success: true };
      case 'GET_PLANNER_EVENTS': {
        let eventSource = fixture?.events ? fixture.events(message.date)
          : previewState === 'empty' ? []
          : structuredClone(previewNowParam ? eventsForDate(message.date) : EVENTS);
        // ?preview-order=reverse delivers the same set in the opposite order,
        // so checks can prove layout is provider-order independent.
        if (params.get('preview-order') === 'reverse') eventSource = [...(eventSource || [])].reverse();
        const base = {
          date: message.date,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          events: structuredClone(eventSource || []),
          stale: previewState === 'calendar-stale',
          partial: previewState === 'calendar-stale',
          updatedAt: Date.now(),
          ...(fixture?.perDay?.(message.date) || {})
        };
        if (previewState === 'calendar-expired') {
          return { ...base, events: [], disconnected: true, status: 401, error: 'Not connected to Google Calendar' };
        }
        if (previewState === 'calendar-error') {
          return { ...base, events: [], partial: true, status: 503, error: 'Calendar refresh temporarily unavailable' };
        }
        return base;
      }
      case 'GET_CALENDAR_LIST':
        return structuredClone(store.calendarSettings.calendarListCache || CALENDAR_LIST);
      case 'UPDATE_CALENDAR_SETTINGS': {
        storageArea.set({ calendarSettings: { ...store.calendarSettings, ...message.settings } });
        return structuredClone(store.calendarSettings);
      }
      default: return null;
    }
  };

  // ---------------------------------------------------------------------------
  // chrome.*
  // ---------------------------------------------------------------------------

  globalThis.chrome = {
    runtime: {
      id: 'preview',
      lastError: undefined,
      getURL: (path) => `/${String(path).replace(/^\/+/, '')}`,
      openOptionsPage: () => { window.location.href = '/options/options.html'; },
      sendMessage: (message, cb) => {
        const result = respond(message || {});
        if (typeof cb === 'function') { setTimeout(() => cb(result), 0); return undefined; }
        return Promise.resolve(result);
      },
      onMessage: { addListener() {}, removeListener() {} }
    },
    storage: {
      local: storageArea,
      sync: storageArea,
      onChanged: { addListener: (fn) => changeListeners.push(fn), removeListener() {} }
    },
    tabs: {
      create: ({ url }) => window.open(url, '_blank'),
      query: (_q, cb) => cb && cb([])
    },
    identity: {
      getRedirectURL: () => 'https://preview.chromiumapp.org/',
      // The Todoist OAuth flow resolves immediately with a fixture code, so
      // Connect Todoist exercises the full success path in preview.
      launchWebAuthFlow: async ({ url }) => {
        const state = new URL(url).searchParams.get('state');
        return `https://preview.chromiumapp.org/?code=preview-code&state=${encodeURIComponent(state || '')}`;
      }
    },
    permissions: { contains: () => Promise.resolve(true), request: () => Promise.resolve(true) },
    extension: { isAllowedIncognitoAccess: (cb) => cb(true) }
  };

  // ---------------------------------------------------------------------------
  // Todoist API interception
  // ---------------------------------------------------------------------------

  const PROJECTS = [
    { id: 'p1', name: 'Inbox', color: 'grey', is_inbox_project: true },
    { id: 'p2', name: 'Focus extension', color: 'blue' },
    { id: 'p3', name: 'Side quests', parent_id: 'p2', color: 'orange' }
  ];
  const LABELS = [
    { id: 'l1', name: 'deep-work', color: 'blue' },
    { id: 'l2', name: 'quick', color: 'yellow' },
    { id: 'l3', name: 'home', color: 'green' }
  ];

  // Tiny Quick Add parser good enough for preview: #Project (escaped spaces),
  // @label, p1-p4, today/tomorrow/every <weekday>/at 5pm, and `// description`.
  function previewQuickAdd(text) {
    let rest = ` ${String(text || '')} `;
    const task = { id: `preview-${Date.now()}`, order: TASKS.length + 1, priority: 1, labels: [] };
    rest = rest.replace(/(^|\s)p([1-4])(?=\s|$)/i, (m, space, n) => { task.priority = 5 - Number(n); return space; });
    rest = rest.replace(/#((?:\\.|[^\s])+)/g, (m, raw) => {
      const name = raw.replace(/\\(.)/g, '$1');
      const project = PROJECTS.find(p => p.name.toLowerCase() === name.toLowerCase());
      if (project) task.project_id = project.id;
      return ' ';
    });
    rest = rest.replace(/@((?:\\.|[^\s])+)/g, (m, raw) => { task.labels.push(raw.replace(/\\(.)/g, '$1')); return ' '; });
    const split = rest.indexOf('//');
    if (split >= 0) { task.description = rest.slice(split + 2).trim(); rest = rest.slice(0, split); }
    const timeMatch = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(rest);
    let due = null;
    const recMatch = /\bevery\s+(\w+)\b/i.exec(rest);
    if (/\btoday\b/i.test(rest)) due = { date: D, string: 'today', is_recurring: false };
    else if (/\btomorrow\b/i.test(rest)) due = { date: DD(1), string: 'tomorrow', is_recurring: false };
    else if (recMatch) due = { date: D, string: recMatch[0], is_recurring: true };
    if (timeMatch) {
      let h = Number(timeMatch[1]) % 12;
      if (timeMatch[3].toLowerCase() === 'pm') h += 12;
      const hhmm = `${String(h).padStart(2, '0')}:${timeMatch[2] || '00'}`;
      const label = `${due ? `${due.string} ` : ''}at ${timeMatch[1]}${timeMatch[2] ? `:${timeMatch[2]}` : ''}${timeMatch[3].toLowerCase()}`;
      due = { date: `${due ? due.date.slice(0, 10) : D}T${hhmm}:00`, string: label, is_recurring: due?.is_recurring || false };
    }
    task.due = due;
    rest = rest
      .replace(/\btoday\b/i, ' ')
      .replace(/\btomorrow\b/i, ' ')
      .replace(timeMatch ? timeMatch[0] : /$^/, ' ')
      .replace(recMatch ? recMatch[0] : /$^/, ' ');
    task.content = rest.replace(/\s{2,}/g, ' ').trim();
    return task;
  }

  const realFetch = window.fetch.bind(window);
  const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    // Token proxy used by the OAuth exchange — mint the preview token.
    if (url.includes('focus-extension-proxy')) return json({ access_token: 'preview-token' });
    if (url.includes('api.todoist.com')) {
      const method = String(init?.method || 'GET').toUpperCase();
      if (url.includes('/tasks/completed')) return json({ items: previewState === 'empty' ? [] : structuredClone(COMPLETED) });
      if (/\/tasks\/quick$/.test(url) && method === 'POST') {
        if (previewState === 'mutation-error' || fixture?.mutationFail) return json({ error: 'Preview mutation failed' }, 503);
        const created = previewQuickAdd(JSON.parse(init?.body || '{}').text);
        TASKS.push(created);
        return json(structuredClone(created));
      }
      const moveMatch = /\/tasks\/([^/]+)\/move$/.exec(url);
      if (moveMatch && method === 'POST') {
        if (previewState === 'mutation-error' || fixture?.mutationFail) return json({ error: 'Preview mutation failed' }, 503);
        const task = TASKS.find(item => item.id === moveMatch[1]);
        if (task) task.project_id = JSON.parse(init?.body || '{}').project_id;
        return json(task ? structuredClone(task) : {});
      }
      const closeMatch = /\/tasks\/([^/]+)\/(close|reopen)/.exec(url);
      if (closeMatch) {
        if (previewState === 'mutation-error' || fixture?.mutationFail) return json({ error: 'Preview mutation failed' }, 503);
        if (closeMatch[2] === 'close') {
          const index = TASKS.findIndex(task => task.id === closeMatch[1]);
          if (index >= 0) TASKS.splice(index, 1);
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      const taskMatch = /\/tasks\/([^/?]+)$/.exec(url);
      if (taskMatch && method === 'POST') {
        if (previewState === 'mutation-error' || fixture?.mutationFail) return json({ error: 'Preview mutation failed' }, 503);
        const task = TASKS.find(item => item.id === taskMatch[1]);
        if (task) {
          const body = JSON.parse(init?.body || '{}');
          Object.assign(task, body);
          if (Object.hasOwn(body, 'due_string')) {
            const s = String(body.due_string || '');
            task.due = !s || s === 'no date'
              ? null
              : {
                  date: /\btomorrow\b/i.test(s) ? DD(1) : /\btoday\b/i.test(s) ? D : /^every\b/i.test(s) ? D : D,
                  string: s,
                  is_recurring: /^every\b/i.test(s)
                };
            delete task.due_string;
          }
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.includes('/tasks') && method === 'POST') {
        if (previewState === 'mutation-error' || fixture?.mutationFail) return json({ error: 'Preview mutation failed' }, 503);
        const body = JSON.parse(init?.body || '{}');
        const created = { id: `preview-${Date.now()}`, order: TASKS.length + 1, ...body, due: body.due_date ? { date: body.due_date, is_recurring: false } : null };
        TASKS.push(created);
        return json(created);
      }
      if (url.includes('/tasks')) {
        if (fixture?.todoistError) return json({ error: 'Preview todoist failure' }, 503);
        const list = fixture?.tasks ?? (previewState === 'empty' ? [] : TASKS);
        return json({ results: structuredClone(list), next_cursor: null });
      }
      if (url.includes('/labels')) return json({ results: structuredClone(LABELS) });
      if (url.includes('/projects')) return json({ results: structuredClone(PROJECTS) });
      return json({});
    }
    return realFetch(input, init);
  };
})();
