## Focus Extension

Chrome extension for blocking distracting sites and replacing them with a focused dashboard that shows your Todoist tasks, calendar, and helpful context.

### Features

- **Site blocking**: Block distracting sites using `declarativeNetRequest`, with support for:
  - **Blocklist / allowlist** modes
  - **Categories** (e.g., social, entertainment, forums)
  - **Keyword blocking** and URL whitelists
- **Smart unblock flows**:
  - Timed unlock, typing a phrase or reason, math challenge, optional password
  - **Earned time** by completing Todoist tasks
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
3. In this repo:
   - Open `lib/todoist.js` and set:
     - `TODOIST_CLIENT_ID` to your Todoist client ID.
     - `TOKEN_PROXY_URL` to your deployed Cloudflare Worker URL, e.g. `https://your-worker-subdomain.workers.dev/api/todoist/token`.
   - In `worker/wrangler.toml`, set:
     - `TODOIST_CLIENT_ID` under `[vars]` to the same client ID.
   - In your Cloudflare Worker environment, set the **secret**:

```bash
cd worker
npx wrangler secret put TODOIST_CLIENT_SECRET
```

#### 3. Configure Google Calendar OAuth

1. In Google Cloud Console, create OAuth credentials for a Chrome extension.
2. Copy your OAuth client ID.
3. In `manifest.json`, set:
   - `oauth2.client_id` to your Google OAuth client ID.
4. Ensure the scopes under `oauth2.scopes` match what you’ve configured (currently read-only Calendar scopes).

#### 4. Run / deploy the Cloudflare Worker

From the `worker/` directory:

```bash
npx wrangler dev
# or
npx wrangler deploy
```

Update `TOKEN_PROXY_URL` in `lib/todoist.js` to match your deployed URL.

#### 5. Load the extension in Chrome

1. Build step is not required; the extension runs directly from source.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `focus-extension` folder.

### Privacy & data

- **Local storage**:
  - Extension settings, focus profiles, schedule configuration.
  - Cached weather location (lat/lon) and weather responses.
  - Theme preference and new-tab layout options.
- **Todoist**:
  - OAuth exchange happens via the Cloudflare Worker.
  - Only the **access token** is stored locally (`chrome.storage.local`).
  - The Todoist `client_secret` lives only in the Worker as an environment secret and is never exposed to the browser.
- **Google Calendar**:
  - Access is read-only using the configured OAuth scopes.
  - Used solely to show upcoming events on the new tab page.
- **Browsing history**:
  - If enabled in settings, the extension uses the `history` permission to analyze productivity and usage patterns locally.
  - Data is stored locally and not sent to any external server by default.

### Contributing

- Issues and PRs are welcome.
- Please avoid committing any personal OAuth client IDs, secrets, or Cloudflare Worker URLs tied to private accounts.

