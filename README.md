## Focus Extension

<p align="center">
  <img src="./icons/icon128.png" alt="Focus Extension icon" width="128" height="128">
</p>

Chrome extension that replaces the new tab page with a calm daily command centre showing your Todoist tasks and today's Google Calendar. Sections and rows are separated by whitespace rather than dividers, with a paper-toned light/dark design.

### Features

- **New tab dashboard**:
  - Clock and date
  - Weather (°C/°F, saved coordinates)
  - Today's Google Calendar timeline: hour rails, side-by-side lanes for overlapping events, all-day chips, a Now marker with a "Back to now" shortcut, and links out to Google Calendar
  - The top three Todoist tasks ranked deadline-first (overdue, then today's timed deadlines, then date-only, then upcoming, then undated)
  - Complete a task from its priority-coloured ring; click a task to edit it in a centred modal (title, description, due date, priority, project, labels)
  - Quick Add spotlight (⌘K / Ctrl+K) using Todoist's own `/tasks/quick` parser — dates, `#project`, `@label`, `p1`–`p4` — with inline project and label suggestions
- **Settings page** (opened via the toolbar icon):
  - Todoist and Google Calendar connect/disconnect
  - "Calendars shown" — pick which calendars feed the timeline
  - New-tab visibility toggles (tasks / calendar / weather) and temperature unit
  - Theme: System / Light / Dark
- **Todoist integration**:
  - OAuth via a Cloudflare Worker proxy (client secret stays server-side)
  - View, complete, create, and edit tasks from the new tab page
- **Google Calendar integration**:
  - Read-only access to your events to show what's coming up

### Architecture

- **Browser extension (MV3)**
  - `manifest.json` – Chrome extension manifest (generated from `manifest.template.json` by `npm run build:local`)
  - `background.js` – service worker for Google Calendar auth/planner events and the one-time cleanup of removed features
  - `options/` – vanilla Settings UI
  - `newtab/` – new tab dashboard:
    - `newtab.js` / `newtab.html` / `newtab.css` – page shell, clock, weather, widget visibility
    - `planner.js` – tasks, calendar timeline wiring, Quick Add spotlight, edit-task modal
    - `planner-model.js` / `planner-actions.js` – ranking, grouping, and payload parsing (pure)
    - `planner-tasks.js` / `planner-calendar.js` / `planner-calendar-data.js` / `planner-timeline.js` / `planner-controls.js` / `planner-color.js` – task rows and timeline rendering
  - `lib/todoist.js` – Todoist API wrapper used by the extension UIs
  - `lib/cleanup.js` – versioned one-time cleanup of data left behind by removed features
  - `lib/nt-tokens.css` – shared new-tab/Settings design tokens
- **Cloudflare Worker**
  - Lives in `worker/`
  - Exposes `POST /api/todoist/token` to exchange a Todoist OAuth authorization code for an access token
  - Uses Cloudflare Worker secrets for `TODOIST_CLIENT_ID` and `TODOIST_CLIENT_SECRET`

### Prerequisites

- Node.js (LTS)
- A **Todoist** developer app (for OAuth)
- A **Google Cloud** project with OAuth credentials for Chrome extensions (for Calendar)
- A **Cloudflare Workers** account

### Setup

#### 1. Clone and install dependencies

```bash
git clone <this-repo-url>
cd focus-extension
npm install
cd worker && npm install && cd ..
```

#### 2. Create your local config from `.env`

1. Create a Todoist developer app.
2. Set the **redirect URI** to Chrome’s extension redirect pattern (see Todoist docs) and to your deployed Worker if needed.
3. Copy `.env.example` to `.env`.
4. Fill in:
   - `GOOGLE_OAUTH_CLIENT_ID`
   - `TODOIST_CLIENT_ID`
   - `TOKEN_PROXY_URL` (your deployed Cloudflare Worker URL, e.g. `https://your-worker-subdomain.workers.dev/api/todoist/token`)
5. Generate local config files:

```bash
npm run build:local
```

This generates:

- `manifest.json`
- `lib/config.js`
- `worker/wrangler.toml`

Re-run `npm run build:local` any time you change `.env`.

6. In your Cloudflare Worker environment, set the **secret**:

```bash
cd worker
npx wrangler secret put TODOIST_CLIENT_SECRET
```

#### 3. Configure Google Calendar OAuth

1. In Google Cloud Console, create OAuth credentials for a Chrome extension.
2. Copy your OAuth client ID into `.env` as `GOOGLE_OAUTH_CLIENT_ID`.
3. Run `npm run build:local` so `manifest.json` is regenerated with that value.
4. Ensure the scopes under `manifest.template.json` `oauth2.scopes` match what you’ve configured (currently read-only Calendar scopes).

#### 4. Run / deploy the Cloudflare Worker

From the `worker/` directory:

```bash
npx wrangler dev
# or
npx wrangler deploy
```

If you change the deployed Worker URL, update `TOKEN_PROXY_URL` in `.env` and re-run `npm run build:local`.

#### 5. Load the extension in Chrome

1. Run `npm run build:local` first so the generated config files exist.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `focus-extension` folder.

### Previewing the UI outside Chrome

Both surfaces can be rendered in a normal browser with fixture data (no
extension load needed):

```bash
npm run preview   # http://localhost:4173
```

- `/newtab/newtab.html` and `/options/options.html` get a `chrome.*` shim with
  realistic fixtures injected at request time (`scripts/preview/shim.js`); the
  files on disk are untouched.
- Query params: `preview-theme=dark`, `preview-now=<iso>` (freeze the clock),
  `preview-fixture=<name>` (see `scripts/preview/shim.js`), `shim=0` to disable.

Design invariants (flat hairline surfaces and token-driven color) are
enforced by `node tests/design-tokens.test.js`.

### Performance and refresh behavior

The new-tab dashboard shares a small set of local caches (`chrome.storage.local`)
across all extension pages, coordinated by Web Locks so concurrent opens dedupe
in-flight requests instead of each page fetching on its own.

| Resource | Freshness | Stale fallback |
| --- | --- | --- |
| Todoist active tasks | 2 min | up to 15 min extra when stale-while-revalidate is used |
| Todoist labels / projects | 30 min | none — reads past the window refetch |
| New-tab calendar planner events | 5 min | same-day events up to 24 h extra |
| Weather | 30 min | up to 2 h extra (2.5 h maximum total age); the legacy fallback fields follow the same bound |

Freshness and cooldowns are per cache scope — two different pages or queries
only share an entry when their scopes match exactly.

- Todoist responses live in three bounded slots (tasks, labels, projects).
  Different filters or accounts may evict one another within a slot rather
  than coexisting — a repeat of an evicted query refetches.
- An **empty** calendar day is a successful cached result — it does not trigger
  a refetch per open.
- Widgets only poll while the tab is **visible and enabled**; hidden or
  disabled widgets make no auth, geolocation, or API calls. Failed geolocation
  lookups back off for five minutes instead of re-prompting on every page.
- Cached tasks and calendar events stay on screen during background refresh
  instead of blanking to a loading state. Weather labels its saved-data
  fallback; Calendar shows an unavailable/saved-schedule message when a
  request reaches the UI as an error. Authentication failures clear the
  cached view and show the reconnect prompt.
- Cache entries are scoped to account, query, selection, and — for calendar
  and weather — the local day: signing out, switching accounts, changing
  selected calendars, a new day, or new coordinates all invalidate. Task
  mutations (complete / reopen / create / update) bump a cache revision that
  invalidates the tasks cache immediately.
- Failed requests enter a short cooldown (at least 60 s, honoring
  `Retry-After` for 429s) so concurrent pages don't each retry a failing
  endpoint. Auth failures (401/403) are recorded as status-only entries with
  no cached value and are never served as stale data.

#### Measuring

API-call counts for dashboard opens can be reproduced fully offline against
fixtures (no live traffic, no real account data):

```bash
node --experimental-vm-modules scripts/measure-dashboard.mjs
```

Five opens within one freshness window, one connected account, one selected
calendar with no events, and saved weather coordinates. Each fixture endpoint
returns one response page. Current output:

| External requests | One cold + four warm opens | Five simultaneous cold opens |
| --- | --- | --- |
| Todoist tasks | 1 | 1 |
| Calendar list | 1 | 1 |
| Calendar events | 1 | 1 |
| Weather | 1 | 1 |
| **Total** | **4** | **4** |

These are deterministic
fixture request counts, not real-account latency or Core Web Vitals measurements.
The first uncached load still needs the network; subsequent matching opens reuse
the cache until it expires or is invalidated.

#### Tests

Tests live in `tests/` and are plain Node scripts; run the whole suite with:

```bash
TZ=UTC node tests/*.test.js   # TZ=UTC is required: calendar-cache tests assume UTC
```

Browser checks drive the preview server with `puppeteer-core` (see `AGENTS.md`
for setup — it is deliberately not a project dependency):

```bash
npm run preview &   # must already be running
PUPPETEER_CORE=/tmp/focus-checks/node_modules/puppeteer-core \
  node scripts/preview/browser-checks.mjs
```

### Privacy & data

- **Local storage**:
  - Extension settings (new-tab visibility toggles, temperature unit) and theme preference.
  - Cached weather location (lat/lon) and weather responses.
  - Cached Todoist task/label/project responses and the new-tab calendar
    planner events (see Performance and refresh behavior). Access tokens are
    never copied into cache keys or entries — but cached API responses can
    contain private user data and are stored locally.
- **Todoist**:
  - OAuth exchange happens via the Cloudflare Worker.
  - The OAuth credential stored locally (`chrome.storage.local`) consists of
    the access token; API responses are cached alongside it as described above.
  - The Todoist `client_secret` lives only in the Worker as an environment secret and is never exposed to the browser.
  - Logging out clears the token and all associated cached Todoist data.
- **Google Calendar**:
  - Access is read-only using the configured OAuth scopes.
  - Used solely to show upcoming events on the new tab page.
  - Disconnecting clears the token and all associated cached calendar data.
- A versioned one-time cleanup runs on install/update and again at browser
  startup until it completes, removing data left behind by removed features —
  site lists, focus sessions, stats/history, shader and background
  preferences, stale blocking rules (cleanup v2), and the old "current task"
  pin (`newtabPlannerState`, removed by cleanup v3). See `lib/cleanup.js`.

### Contributing

- Issues and PRs are welcome.
- Please avoid committing any personal OAuth client IDs, secrets, or Cloudflare Worker URLs tied to private accounts.
