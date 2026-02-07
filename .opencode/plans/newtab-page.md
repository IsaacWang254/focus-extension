# New Tab Page — Calendar, Todos & Quotes

## Overview
Create a new `newtab/` page that overrides Chrome's default new tab. Minimal centered layout (Momentum-style) with a clock/greeting, Google Calendar schedule, Todoist tasks, and rotating motivational quotes. Dark/light mode using the existing theme system.

## Layout (top to bottom, centered)
1. **Greeting + Clock** — "Good morning" with current time (large, centered)
2. **Motivational Quote** — Small italic text below the greeting (toggleable)
3. **Two-column row below** — Calendar events (left) and Todoist tasks (right)
4. **Theme toggle** — Small button in the top-right corner
5. **Settings gear** — Top-right, opens dropdown with toggles for quotes/calendar/todos visibility

## Files to create
- `newtab/newtab.html`
- `newtab/newtab.css` (imports `../lib/common.css`)
- `newtab/newtab.js` (ES module, imports `../lib/todoist.js` and `./quotes.js`)
- `newtab/quotes.js` (~50 built-in motivational quotes)

## Files to modify
- `manifest.json` — add `chrome_url_overrides` and update `web_accessible_resources`

## Implementation steps

### 1. Create `newtab/quotes.js`
- Export array of ~50 `{ text, author }` objects
- `getDailyQuote()` — picks quote based on day-of-year for consistency
- `getRandomQuote()` — random pick

### 2. Create `newtab/newtab.html`
- Standard extension HTML structure (same as blocked.html pattern)
- Include `../lib/icons.js` script
- Theme toggle button (top-right)
- Settings gear button (top-right, next to theme)
- Settings dropdown panel with toggles: show quotes, show calendar, show todos
- Clock display (large centered)
- Greeting text
- Quote section (blockquote + cite)
- Two-column content area:
  - Left: Calendar section with event list, or "Connect Google Calendar" prompt
  - Right: Todos section with task list + checkboxes, or "Connect Todoist" prompt

### 3. Create `newtab/newtab.css`
- `@import '../lib/common.css'`
- Full-height body layout (`min-height: 100vh`, flexbox centered)
- Large clock font (~4rem)
- Greeting text (~1.5rem, muted color)
- Quote: italic, muted, smaller font
- Two-column grid for calendar + todos (responsive, stack on narrow)
- Event list: time on left, title on right, color dot from calendar color
- Todo list: checkbox, task content, priority indicator, due date
- Settings dropdown: positioned absolute from gear icon
- Smooth transitions for show/hide sections

### 4. Create `newtab/newtab.js`
**Imports:** `../lib/todoist.js`, `./quotes.js`

**Theme:** Reuse exact `loadTheme()` / `setupThemeToggle()` pattern

**Clock & Greeting:**
- Update time every second (HH:MM format)
- Greeting based on hour: morning (<12), afternoon (<18), evening (>=18)

**Quotes:**
- Call `getDailyQuote()` on load
- Read `newtabShowQuotes` from chrome.storage.local (default: true)
- Show/hide quote section based on setting

**Calendar:**
- Send `GET_TODAY_EVENTS` message to background.js
- If calendar not connected, show "Connect Calendar" button
- Connect button sends `CONNECT_GOOGLE_CALENDAR` to background
- Render events as timeline list sorted by start time
- All-day events shown at top
- Show event time (HH:MM - HH:MM) and title
- Color dot using event.color

**Todos:**
- Import todoist.js, call `isAuthenticated()` to check
- If not authenticated, show "Connect Todoist" prompt
- Connect button calls `todoist.authenticate()`
- Fetch tasks with `getTasksWithSubtasks()`
- Sort by priority (desc) then due date
- Show up to 8 tasks, "show more" button for rest (up to 20)
- Checkbox to complete tasks (calls `todoist.completeTask()`)
- Show due date badge, priority color indicator
- Animate task removal on completion

**Settings:**
- Store in chrome.storage.local: `newtabShowQuotes`, `newtabShowCalendar`, `newtabShowTodos`
- All default to `true`
- Gear icon click toggles dropdown visibility
- Each toggle updates storage and immediately shows/hides section
- Click outside closes dropdown

### 5. Update `manifest.json`
- Add: `"chrome_url_overrides": { "newtab": "newtab/newtab.html" }`
- Add newtab files to `web_accessible_resources` resources array

## Key patterns to follow (from existing code)
- Theme: `chrome.storage.local.get('theme')`, `data-theme` attribute on `<html>`
- Icons: `Icons.sun`, `Icons.moon`, `Icons.calendar`, `Icons.settings`, `Icons.check`, `Icons.clock`
- Todoist: import as ES module, same auth/fetch/complete pattern as blocked.js
- Calendar: message passing to background.js (`chrome.runtime.sendMessage`)
- CSS: use design tokens from common.css (--background, --foreground, --card, --border, etc.)
