/**
 * Defer work until the page is actually on screen.
 *
 * Both the blocked page and the new tab fire Todoist requests during init.
 * Neither is necessarily being looked at when it loads: Chrome preloads and
 * restores new tabs, and a background tab navigating to a blocked site renders
 * the blocked page without ever being focused. Every one of those was costing
 * a round of API calls for a page nobody saw.
 */

/**
 * Runs `fn` immediately if the page is visible, otherwise on the first
 * transition to visible. Fires at most once.
 *
 * @param {() => void} fn
 * @returns {() => void} Cancels a still-pending deferral; a no-op once fired.
 */
export function runWhenVisible(fn) {
  if (typeof document === 'undefined' || document.visibilityState === 'visible') {
    fn();
    return () => {};
  }

  let done = false;
  const onVisible = () => {
    if (done || document.visibilityState !== 'visible') return;
    done = true;
    document.removeEventListener('visibilitychange', onVisible);
    fn();
  };

  document.addEventListener('visibilitychange', onVisible);

  return () => {
    if (done) return;
    done = true;
    document.removeEventListener('visibilitychange', onVisible);
  };
}
