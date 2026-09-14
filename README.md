## Focus Extension

<p align="center">
  <img src="./icons/icon128.png" alt="Focus Extension icon" width="128" height="128">
</p>

Chrome extension for blocking distracting sites and replacing them with a focused dashboard that shows your Todoist tasks, calendar, and helpful context. The interface uses a red, Modernist-inspired design with light/dark modes and optional animated backgrounds.

### Features

- **Site blocking**: Blocked sites show an in-page focus screen (a full-page intervention rendered inside the tab, not a declarative redirect), with support for:
  - **Blocklist / allowlist** modes
  - **Categories** (e.g., social, entertainment, forums)
  - **Keyword blocking** and URL whitelists
- **Smart unblock flows**:
  - Timed unlock, typing a phrase or reason, math challenge, optional password
  - **Earned time** by completing Todoist tasks
  - Task-goal unlocks based on completing one task now or a required number of tasks today
- **New tab dashboard**:
  - Clock, greeting, motivational quote
  - Weather
  - Google Calendar events
  - Todoist tasks and completed-today summary
- **Profiles & schedules**:
  - Multiple blocking profiles (work, study, relaxed)
  - Time-of-day and day-of-week schedules
- **Todoist integration**:
  - OAuth via a Cloudflare Worker proxy (client secret stays server-side)
  - View, complete, and create tasks from the blocked/new tab pages
- **Google Calendar integration**:
  - Read-only access to your events to show what’s coming up

### Architecture

- **Browser extension (MV3)**
  - `manifest.json` – Chrome extension manifest
  - `background.js` – service worker that manages blocking rules, timers, usage tracking, achievements, etc.
  - `options/` – full settings UI
  - `newtab/` – new tab dashboard
  - `blocked/` – blocked page with Todoist-based unblock flows
  - `lib/todoist.js` – Todoist API wrapper used by the extension UIs
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

All five surfaces can be rendered in a normal browser with fixture data (no
extension load needed):

```bash
npm run preview   # http://localhost:4173
```

- `/newtab/newtab.html`, `/blocked/blocked.html?url=…`, `/options/options.html`
  get a `chrome.*` shim with realistic fixtures injected at request time
  (`scripts/preview/shim.js`); the files on disk are untouched.
- `/popup/popup.html` and `/stats/stats.html` use their built-in preview
  fixtures; append `?shim=1` to use the shim fixtures instead.
- Query params: `preview-theme=dark`, `preview-state=nuclear|limit|empty`
  (blocked page), `preview-bg=ocean|dither` (new tab), `shim=0` to disable.

Design invariants (flat hairline surfaces and token-driven color) are
enforced by `node design-tokens.test.js`.

### Performance and refresh behavior

The new-tab dashboard shares a small set of local caches (`chrome.storage.local`)
across all extension pages, coordinated by Web Locks so concurrent opens dedupe
in-flight requests instead of each page fetching on its own.

| Resource | Freshness | Stale fallback |
| --- | --- | --- |
| Todoist active tasks | 2 min | up to 15 min extra when stale-while-revalidate is used |
| Todoist completed-today | 2 min | up to 15 min extra when stale-while-revalidate is used |
| Todoist labels / projects | 30 min | none — reads past the window refetch |
| New-tab calendar display range | 5 min | same-day display range up to 24 h extra |
| Weather | 30 min | up to 2 h extra (2.5 h maximum total age); the legacy fallback fields follow the same bound |

Freshness and cooldowns are per cache scope — two different pages or queries
only share an entry when their scopes match exactly.

- Todoist responses live in four bounded slots (tasks, completed-today,
  labels, projects). Different filters, limits, or accounts may evict one
  another within a slot rather than coexisting — a repeat of an evicted query
  refetches.
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
- Cache entries are scoped to account, query, selection, and — for
  completed-today, calendar, and weather — the local day: signing out,
  switching accounts, changing selected calendars, a new day, or new
  coordinates all invalidate. Task mutations (complete / reopen / create)
  invalidate the tasks and completed-today caches immediately.
- Failed requests enter a short cooldown (at least 60 s, honoring
  `Retry-After` for 429s) so concurrent pages don't each retry a failing
  endpoint. Auth failures (401/403) are recorded as status-only entries with
  no cached value and are never served as stale data.
- The daily task-goal check used for unblocking stays **live** — it always
  queries Todoist directly — and arbitrary-range `getCompletedTasks` requests
  are never cached.
- Calendar's optional background sync (for auto profile switching) still runs
  on its own 5-minute alarm, independent of the dashboard display cache.
- Animated shader backgrounds load lazily: the module is imported only for the
  selected background while the tab is visible, and the GL harness compiles
  only the active quality program.

#### Measuring

API-call counts for dashboard opens can be reproduced fully offline against
fixtures (no live traffic, no real account data):

```bash
node --experimental-vm-modules scripts/measure-dashboard.mjs
```

Recorded comparison against baseline commit `199983d`: five opens within one
freshness window, one connected account, one selected calendar with no events,
and saved weather coordinates. Each fixture endpoint returns one response page.

| External requests | Sequential opens: before → after | Simultaneous cold opens: before → after |
| --- | --- | --- |
| Todoist tasks | 5 → 1 | 5 → 1 |
| Todoist completed tasks | 5 → 1 | 5 → 1 |
| Calendar list | 1 → 1 | 5 → 1 |
| Calendar events | 5 → 1 | 5 → 1 |
| Weather | 1 → 1 | 5 → 1 |
| **Total** | **17 → 5** | **25 → 5** |

Eager shader imports also dropped from two to zero. These are deterministic
fixture request counts, not real-account latency or Core Web Vitals measurements.
The first uncached load still needs the network; subsequent matching opens reuse
the cache until it expires or is invalidated.

#### Tests

Root tests are plain Node scripts; run the whole suite with:

```bash
for test in *.test.js; do printf '\n=== %s ===\n' "$test"; node "$test" || exit 1; done
```

### Privacy & data

- **Local storage**:
  - Extension settings, focus profiles, schedule configuration.
  - Cached weather location (lat/lon) and weather responses.
  - Cached Todoist task/label/project responses and the new-tab calendar
    display range (see Performance and refresh behavior). Access tokens are
    never copied into cache keys or entries — but cached API responses can
    contain private user data and are stored locally.
  - Theme preference and new-tab layout options.
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
- **Browsing history**:
  - If enabled in settings, the extension uses the `history` permission to analyze productivity and usage patterns locally.
  - Data is stored locally and not sent to any external server by default.

### Contributing

- Issues and PRs are welcome.
- Please avoid committing any personal OAuth client IDs, secrets, or Cloudflare Worker URLs tied to private accounts.
