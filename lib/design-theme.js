const ICON_BUTTON_SELECTOR = '.theme-toggle, .settings-dialog-close';

export function setIconButtonLabel(button, label) {
  if (!button) return;
  button.setAttribute('aria-label', label);
  button.removeAttribute('title');
}

export function applyModernistDesign() {
  document.documentElement.setAttribute('data-design', 'modernist');
  document.querySelectorAll(ICON_BUTTON_SELECTOR).forEach(button => {
    const label = button.getAttribute('aria-label') || button.getAttribute('title');
    if (label) setIconButtonLabel(button, label);
    else button.removeAttribute('title');
  });
}
