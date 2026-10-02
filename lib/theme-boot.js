/**
 * Pre-paint theme bootstrap. Runs synchronously in <head> before any
 * stylesheet loads so first paint already carries the resolved
 * `data-theme` on <html>, avoiding a light-theme flash for dark users.
 * Reads the localStorage mirror written by loadTheme() in lib/theme.js;
 * the mirror is authoritative for paint, chrome.storage stays the
 * source of truth once the deferred module script runs.
 */
(() => {
  let cached = { theme: 'light', sync: true };
  try {
    const raw = localStorage.getItem('focus:theme');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        cached = {
          theme: parsed.theme === 'dark' ? 'dark' : 'light',
          sync: parsed.sync !== false
        };
      }
    }
  } catch {
    // Corrupt or unavailable cache: fall back to the storage defaults.
  }

  const base = cached.sync
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : (cached.theme === 'dark' ? 'dark' : 'light');

  document.documentElement.setAttribute(
    'data-theme',
    base === 'dark' ? 'dashboard-dark' : 'dashboard-light'
  );
})();
