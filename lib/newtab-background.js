/**
 * Animated new-tab background selection.
 *
 * Replaces the older boolean `newtabShowOceanBackground`. The old key is still
 * read as a fallback so existing installs keep whatever they had; it is also
 * still written on save, so rolling back to a previous build does not silently
 * turn someone's background off.
 */

export const NEWTAB_BACKGROUNDS = ['none', 'ocean', 'dither'];

export const DEFAULT_NEWTAB_BACKGROUND = 'ocean';

/**
 * @param {object} settings Raw settings object from storage.
 * @returns {'none'|'ocean'|'dither'}
 */
export function resolveNewtabBackground(settings = {}) {
  const explicit = settings.newtabBackground;
  if (NEWTAB_BACKGROUNDS.includes(explicit)) return explicit;
  // Migration: no picker value stored yet, so fall back to the old toggle.
  if (settings.newtabShowOceanBackground === false) return 'none';
  return DEFAULT_NEWTAB_BACKGROUND;
}
