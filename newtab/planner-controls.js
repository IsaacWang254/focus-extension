/**
 * Shared icon-button controls for the planner surfaces: reserved 36px
 * actions with SVG glyphs, accessible labels, and a single floating tooltip
 * that never participates in layout.
 */

function iconHostOf(button) {
  let host = button.querySelector?.('.icon-action-glyph');
  if (!host) {
    host = document.createElement('span');
    host.className = 'icon-action-glyph';
    host.setAttribute('aria-hidden', 'true');
    button.appendChild(host);
  }
  return host;
}

function applyIcon(button, icon) {
  const host = iconHostOf(button);
  host.innerHTML = icon || '';
  const svg = host.querySelector?.('svg');
  if (svg) {
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
  }
}

function applyLabel(button, label, tooltip) {
  if (label !== undefined) button.setAttribute('aria-label', label);
  const tip = tooltip !== undefined ? tooltip : label;
  if (tip === undefined) return;
  if (tip == null || tip === '') button.removeAttribute?.('data-tooltip-label');
  else button.setAttribute('data-tooltip-label', tip);
}

export function createIconButton({ icon, label, tooltip = label, className = '', type = 'button', onClick } = {}) {
  const button = document.createElement('button');
  button.type = type;
  button.className = `icon-action${className ? ` ${className}` : ''}`;
  applyLabel(button, label, tooltip);
  applyIcon(button, icon);
  if (onClick) button.addEventListener('click', event => onClick(event, button));
  return button;
}

export function createIconLink({ icon, label, tooltip = label, className = '', href } = {}) {
  const link = document.createElement('a');
  link.className = `icon-action${className ? ` ${className}` : ''}`;
  link.href = href || '';
  link.target = '_blank';
  link.rel = 'noreferrer';
  applyLabel(link, label, tooltip);
  applyIcon(link, icon);
  return link;
}

export function setIconButton(button, { icon, label, tooltip } = {}) {
  if (typeof button === 'string') button = document.getElementById(button);
  if (!button) return button;
  applyLabel(button, label, tooltip);
  if (icon !== undefined) applyIcon(button, icon);
  return button;
}

/**
 * Toggle a permanently-reserved action slot: the button keeps its layout
 * geometry but is invisible, unfocusable, and unannounced while unavailable.
 */
export function setActionAvailable(button, available) {
  if (!button) return;
  button.classList.toggle('is-reserved', !available);
  if (available) {
    button.removeAttribute('aria-hidden');
    button.removeAttribute('tabindex');
    button.tabIndex = 0;
  } else {
    button.setAttribute('aria-hidden', 'true');
    button.tabIndex = -1;
  }
}

export function setButtonPending(button, pending) {
  if (!button) return;
  const host = iconHostOf(button);
  if (pending) {
    if (button.dataset.pendingHtml === undefined) button.dataset.pendingHtml = host.innerHTML;
    host.innerHTML = '';
    const spinner = document.createElement('span');
    spinner.className = 'planner-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    host.appendChild(spinner);
    button.setAttribute('aria-busy', 'true');
    button.disabled = true;
  } else {
    if (button.dataset.pendingHtml !== undefined) {
      host.innerHTML = button.dataset.pendingHtml;
      delete button.dataset.pendingHtml;
    } else {
      const spinner = host.querySelector?.('.planner-spinner');
      spinner?.remove?.();
    }
    button.removeAttribute('aria-busy');
    button.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Floating tooltip — one body-level element, repositioned per trigger.
// ---------------------------------------------------------------------------

let tooltipEl = null;
let tooltipTarget = null;
let tooltipsInstalled = false;

function tooltipNode() {
  if (!tooltipEl) {
    tooltipEl = document.getElementById('planner-tooltip');
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.id = 'planner-tooltip';
      tooltipEl.setAttribute('role', 'tooltip');
      document.body.appendChild(tooltipEl);
    }
  }
  return tooltipEl;
}

function hideTooltip() {
  tooltipTarget = null;
  if (!tooltipEl) return;
  tooltipEl.classList.remove('is-visible');
  tooltipEl.setAttribute('aria-hidden', 'true');
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function positionTooltip(target) {
  const tip = tooltipNode();
  const label = target.getAttribute('data-tooltip-label');
  tip.textContent = label;
  tip.setAttribute('aria-hidden', 'false');
  tip.classList.add('is-visible');

  const r = target.getBoundingClientRect();
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  const margin = 8;
  const gap = target.dataset.tooltipSide === 'left' ? 12 : 8;
  const bounds = { left: margin, right: window.innerWidth - margin, top: margin, bottom: window.innerHeight - margin };
  const panel = target.closest?.('.edit-modal-panel, .quick-add-panel');
  if (panel?.getBoundingClientRect) {
    const d = panel.getBoundingClientRect();
    bounds.left = Math.max(bounds.left, d.left + margin);
    bounds.right = Math.min(bounds.right, d.right - margin);
    bounds.bottom = Math.min(bounds.bottom, d.bottom - margin);
    bounds.top = Math.max(bounds.top, d.top + margin);
  }

  let x;
  let y;
  if (target.dataset.tooltipSide === 'left') {
    x = clamp(r.left - gap - tw, bounds.left, bounds.right - tw);
    y = clamp(r.top + r.height / 2 - th / 2, bounds.top, bounds.bottom - th);
  } else if (target.dataset.tooltipSide === 'top') {
    x = clamp(r.left + r.width / 2 - tw / 2, bounds.left, bounds.right - tw);
    y = r.top - gap - th;
    if (y < bounds.top) y = r.bottom + gap;
    y = clamp(y, bounds.top, bounds.bottom - th);
  } else {
    x = clamp(r.left + r.width / 2 - tw / 2, bounds.left, bounds.right - tw);
    y = r.bottom + gap;
    if (y + th > bounds.bottom) y = r.top - gap - th;
    y = clamp(y, bounds.top, bounds.bottom - th);
  }
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}

function showTooltip(target) {
  if (!target || target.disabled || target.classList.contains('is-reserved')
    || target.getAttribute('aria-hidden') === 'true'
    || !target.getAttribute('data-tooltip-label')) {
    hideTooltip();
    return;
  }
  tooltipTarget = target;
  positionTooltip(target);
}

function tooltipSourceOf(event) {
  const node = event.target?.closest?.('[data-tooltip-label]');
  return node || null;
}

export function setupPlannerTooltips() {
  if (tooltipsInstalled) return;
  tooltipsInstalled = true;
  document.addEventListener('pointerover', event => {
    const target = tooltipSourceOf(event);
    if (target) showTooltip(target);
    else if (tooltipTarget && !event.target?.closest?.('#planner-tooltip')) hideTooltip();
  });
  document.addEventListener('focusin', event => {
    const target = tooltipSourceOf(event);
    if (target && (!target.matches || target.matches(':focus-visible'))) showTooltip(target);
  });
  document.addEventListener('focusout', event => {
    if (tooltipTarget && (event.target === tooltipTarget || tooltipTarget.contains?.(event.target))) hideTooltip();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') hideTooltip();
  });
  document.addEventListener('scroll', hideTooltip, true);
}
