/**
 * SVG Icon Library
 * All icons use currentColor for automatic dark mode support
 */

const Icons = {
  // Navigation/action glyphs (Feather-style)
  chevronUp: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`,

  chevronDown: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,

  arrowUpRight: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>`,



  // Lucide external-link geometry: the arrowhead sits clear above the frame
  // and the shaft leaves through the open corner, so it reads as "opens
  // elsewhere" at 17px instead of a tangle on the frame line.
  externalLink: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>`,

  x: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,

  calendarDot: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17"/><path d="M8 3v3.5M16 3v3.5"/></svg>`,

  overdue: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.5"/><path d="M12 8v4.5"/><circle cx="12" cy="16" r=".6" fill="currentColor"/></svg>`,

  // Lucide calendar-days: the Google Calendar button, same 1.75px set as the
  // external-link beside the task list.
  calendarDays: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/></svg>`,
  plus: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`,

  // Weather icons (Phosphor-style)
  sun: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,

  moon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,

  cloud: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6.5 18h11a4 4 0 0 0 .3-8A6 6 0 0 0 6.4 10.4a3.8 3.8 0 0 0 .1 7.6Z"/></svg>`,

  partlyCloudy: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3.8 8.4a3.5 3.5 0 0 1 6.4-2.8M7 1v1M1 7h1M2.8 2.8l.7.7M11.2 2.8l.7-.7"/><path d="M9 20h9a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6-1.3A4.2 4.2 0 0 0 9 20Z"/></svg>`,

  partlyCloudyNight: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8.5 2.5a5 5 0 0 0-5 5c0 1.5.6 2.9 1.7 3.8M8.5 2.5a4 4 0 0 0 4.3 5.6"/><path d="M9 20h9a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6-1.3A4.2 4.2 0 0 0 9 20Z"/></svg>`,

  cloudRain: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6.5 14h11a4 4 0 0 0 .3-8A6 6 0 0 0 6.4 6.4a3.8 3.8 0 0 0 .1 7.6Z"/><path d="m8 17-1 3m6-3-1 3m6-3-1 3"/></svg>`,

  cloudSnow: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6.5 14h11a4 4 0 0 0 .3-8A6 6 0 0 0 6.4 6.4a3.8 3.8 0 0 0 .1 7.6Z"/><path d="M7 17v4m-1.7-3 3.4 2m-3.4 0 3.4-2M16 17v4m-1.7-3 3.4 2m-3.4 0 3.4-2"/></svg>`,

  cloudLightning: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6.5 14h11a4 4 0 0 0 .3-8A6 6 0 0 0 6.4 6.4a3.8 3.8 0 0 0 .1 7.6Z"/><path d="m13 16-3 4h4l-3 3"/></svg>`,

  cloudFog: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6.5 14h11a4 4 0 0 0 .3-8A6 6 0 0 0 6.4 6.4a3.8 3.8 0 0 0 .1 7.6Z"/><path d="M4 18h10m3 0h3M7 21h10"/></svg>`,
};

// Export for use in modules and for globalThis lookups in module code
if (typeof globalThis !== 'undefined' && !globalThis.Icons) {
  globalThis.Icons = Icons;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Icons };
}
