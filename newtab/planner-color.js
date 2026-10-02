import { validateProviderColor } from './planner-model.js';

const PAPER = { light: '#fafafa', dark: '#141414' };
const INK = { light: '#1f1f1f', dark: '#ededed' };
const CONTRAST_TARGET = 4.5;

function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16)
  };
}

function rgbToHex({ r, g, b }) {
  const channel = value => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function mixRgb(a, b, t) {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

function mixHex(a, b, t) {
  return rgbToHex(mixRgb(hexToRgb(a), hexToRgb(b), t));
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const channel = value => {
    const srgb = value / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

// Todoist colour names → approximate hexes; hex values pass through.
export const TODOIST_COLORS = {
  berry_red: '#b8255f', red: '#dc4c3e', orange: '#eb8909', yellow: '#f2c94c',
  olive_green: '#949c31', lime_green: '#65a33a', green: '#369307', mint_green: '#42b883',
  teal: '#148fad', sky_blue: '#59c2ff', light_blue: '#96c3eb', blue: '#246fe0',
  grape: '#884dff', violet: '#af38eb', lavender: '#eb96eb', magenta: '#e05194',
  salmon: '#ff8d85', charcoal: '#808080', grey: '#b8b8b8', taupe: '#ccac93'
};

export function todoistColor(color) {
  if (!color) return '#808080';
  if (String(color).startsWith('#')) return color;
  return TODOIST_COLORS[String(color).toLowerCase()] || '#808080';
}

export function contrastRatio(a, b) {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function alphaBlend(foreground, background, alpha) {
  return rgbToHex(mixRgb(hexToRgb(background), hexToRgb(foreground), Math.max(0, Math.min(1, alpha))));
}

/**
 * Theme-aware colors for a calendar event block. `bar` is the validated
 * provider color; `background` mixes it into the theme paper; `text` starts
 * from a color/ink blend and steps toward theme ink until its effective color
 * (alpha-blended at `fade` over the background) reaches 4.5:1 contrast.
 */
export function eventColors(color, theme, { fade = 1 } = {}) {
  const dark = theme === 'dark';
  const bar = validateProviderColor(color);
  const background = mixHex(dark ? PAPER.dark : PAPER.light, bar, dark ? 0.24 : 0.16);
  const ink = dark ? INK.dark : INK.light;
  const initialText = mixHex(dark ? '#ffffff' : '#000000', bar, dark ? 0.66 : 0.68);
  const opacity = Math.max(0, Math.min(1, Number(fade)));

  let text = initialText;
  for (let step = 0; step <= 10; step += 1) {
    const candidate = mixHex(initialText, ink, step / 10);
    const effective = alphaBlend(candidate, background, opacity);
    if (contrastRatio(effective, background) >= CONTRAST_TARGET) {
      text = candidate;
      break;
    }
    if (step === 10) text = ink;
  }
  return { bar, background, text };
}

/**
 * A provider colour readable as meta text on the theme paper: the raw colour
 * when it already reaches 4.5:1, otherwise blended toward the theme ink in
 * 0.1 steps until it does.
 */
export function readableTagColor(color, theme) {
  const dark = theme === 'dark';
  const paper = dark ? PAPER.dark : PAPER.light;
  const ink = dark ? INK.dark : INK.light;
  const base = todoistColor(color);
  for (let step = 0; step <= 10; step += 1) {
    const candidate = step === 0 ? base : mixHex(base, ink, step / 10);
    if (contrastRatio(candidate, paper) >= CONTRAST_TARGET) return candidate;
  }
  return ink;
}
