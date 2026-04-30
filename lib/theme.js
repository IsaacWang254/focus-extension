/**
 * Shared theme + accent-color logic used by every UI surface
 * (popup, stats, options, newtab, blocked).
 */

const ACCENT_COLOR_CSS_VARIABLES = [
  '--indigo',
  '--indigo-foreground',
  '--indigo-hover',
  '--indigo-subtle',
  '--indigo-50',
  '--indigo-100',
  '--indigo-200',
  '--indigo-800',
  '--indigo-900'
];

function hasStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

export function getBrowserThemeBase() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function isThemeSyncEnabled(value) {
  return value !== false;
}

export function getEffectiveThemeBase(base, syncWithBrowser) {
  return syncWithBrowser ? getBrowserThemeBase() : base;
}

export function resolveThemeVariant(base) {
  return base === 'dark' ? 'dashboard-dark' : 'dashboard-light';
}

export function getCurrentResolvedTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dashboard-light';
}

function clearAccentColorOverrides() {
  const rootStyle = document.documentElement.style;
  ACCENT_COLOR_CSS_VARIABLES.forEach((variable) => rootStyle.removeProperty(variable));
}

/**
 * Load the saved theme from storage and apply it to <html data-theme>.
 * Persists `theme: 'light'` if no value was stored.
 */
export async function loadTheme() {
  try {
    if (!hasStorage()) {
      document.documentElement.setAttribute('data-theme', 'dashboard-light');
      return { base: 'light', syncWithBrowser: false, resolved: 'dashboard-light' };
    }

    const result = await chrome.storage.local.get(['theme', 'brutalistEnabled', 'themeSyncWithBrowser']);
    const syncWithBrowser = isThemeSyncEnabled(result.themeSyncWithBrowser);
    const stored = result.theme || 'light';
    if (!result.theme) await chrome.storage.local.set({ theme: 'light' });

    const base = getEffectiveThemeBase(stored, syncWithBrowser);
    const resolved = resolveThemeVariant(base);
    document.documentElement.setAttribute('data-theme', resolved);

    if (result.brutalistEnabled) await chrome.storage.local.remove('brutalistEnabled');

    await applyAccentColorFromStorage();
    return { base, syncWithBrowser, resolved };
  } catch (e) {
    console.error('Failed to load theme:', e);
    return null;
  }
}

/**
 * Watch the OS color-scheme preference and re-run `reload` when it changes
 * (only if the user hasn't opted out of browser sync). Returns a cleanup fn.
 */
export function setupBrowserThemeSyncListener(reload = loadTheme) {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = async () => {
    if (!hasStorage()) return;
    const result = await chrome.storage.local.get('themeSyncWithBrowser');
    if (isThemeSyncEnabled(result.themeSyncWithBrowser)) await reload();
  };
  mediaQuery.addEventListener('change', onChange);
  return () => mediaQuery.removeEventListener('change', onChange);
}

/**
 * Read accentColor from storage and apply it as CSS custom properties.
 * Skipped (and overrides cleared) for the dashboard-* theme variants used
 * by the React surfaces, which use the static design tokens.
 */
export async function applyAccentColorFromStorage() {
  try {
    if (!hasStorage()) return;
    const result = await chrome.storage.local.get('accentColor');
    const hex = result.accentColor || '#6366f1';
    const theme = getCurrentResolvedTheme();
    if (theme.startsWith('dashboard')) {
      clearAccentColorOverrides();
      return;
    }

    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const rgb = { r, g, b };

    const mix = (source, amount, dir) => {
      const target = dir === 'lighten' ? 255 : 0;
      return {
        r: source.r + (target - source.r) * amount,
        g: source.g + (target - source.g) * amount,
        b: source.b + (target - source.b) * amount
      };
    };
    const toHex = (red, green, blue) => `#${[red, green, blue].map((channel) => (
      Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')
    )).join('')}`;
    const s = document.documentElement.style;

    if (theme === 'dark') {
      const lighter = mix(rgb, 0.25, 'lighten');
      const mainHex = toHex(lighter.r, lighter.g, lighter.b);
      const fg = (0.299 * lighter.r + 0.587 * lighter.g + 0.114 * lighter.b) / 255 > 0.5 ? '#09090b' : '#ffffff';
      const s50 = mix(rgb, 0.90, 'darken');
      const s100 = mix(rgb, 0.85, 'darken');
      const s200 = mix(rgb, 0.75, 'darken');
      const s800 = mix(rgb, 0.25, 'lighten');
      const s900 = mix(rgb, 0.40, 'lighten');
      s.setProperty('--indigo', mainHex);
      s.setProperty('--indigo-foreground', fg);
      s.setProperty('--indigo-hover', hex);
      s.setProperty('--indigo-subtle', `rgba(${r}, ${g}, ${b}, 0.15)`);
      s.setProperty('--indigo-50', toHex(s50.r, s50.g, s50.b));
      s.setProperty('--indigo-100', toHex(s100.r, s100.g, s100.b));
      s.setProperty('--indigo-200', toHex(s200.r, s200.g, s200.b));
      s.setProperty('--indigo-800', toHex(s800.r, s800.g, s800.b));
      s.setProperty('--indigo-900', toHex(s900.r, s900.g, s900.b));
    } else {
      const darker = mix(rgb, 0.15, 'darken');
      const fg = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? '#09090b' : '#ffffff';
      const s50 = mix(rgb, 0.92, 'lighten');
      const s100 = mix(rgb, 0.85, 'lighten');
      const s200 = mix(rgb, 0.72, 'lighten');
      const s800 = mix(rgb, 0.55, 'darken');
      const s900 = mix(rgb, 0.65, 'darken');
      s.setProperty('--indigo', hex);
      s.setProperty('--indigo-foreground', fg);
      s.setProperty('--indigo-hover', toHex(darker.r, darker.g, darker.b));
      s.setProperty('--indigo-subtle', `rgba(${r}, ${g}, ${b}, 0.08)`);
      s.setProperty('--indigo-50', toHex(s50.r, s50.g, s50.b));
      s.setProperty('--indigo-100', toHex(s100.r, s100.g, s100.b));
      s.setProperty('--indigo-200', toHex(s200.r, s200.g, s200.b));
      s.setProperty('--indigo-800', toHex(s800.r, s800.g, s800.b));
      s.setProperty('--indigo-900', toHex(s900.r, s900.g, s900.b));
    }
  } catch {
    // Default CSS tokens remain.
  }
}
