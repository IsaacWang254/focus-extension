import * as Toolbar from '@radix-ui/react-toolbar';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

function BlockedHeaderControls() {
  return (
    <Toolbar.Root className="blocked-header-toolbar" aria-label="Blocked page actions">
      <Toolbar.Button
        className="theme-toggle"
        id="theme-toggle"
        title="Toggle dark mode"
        type="button"
      >
        <span className="theme-icon-light" id="theme-icon-light" />
        <span className="theme-icon-dark" id="theme-icon-dark" />
      </Toolbar.Button>
    </Toolbar.Root>
  );
}

function BlockedFooterActions() {
  return (
    <Toolbar.Root className="blocked-footer-toolbar" aria-label="Blocked page links">
      <Toolbar.Link asChild>
        <a href="#" id="settings-link">Settings</a>
      </Toolbar.Link>
      <Toolbar.Separator className="separator" />
      <Toolbar.Link asChild>
        <a href="#" id="go-back">Go Back</a>
      </Toolbar.Link>
    </Toolbar.Root>
  );
}

function mountBlockedShell() {
  const headerRoot = document.getElementById('blocked-header-controls-root');
  if (headerRoot) {
    flushSync(() => createRoot(headerRoot).render(<BlockedHeaderControls />));
  }

  const footerRoot = document.getElementById('blocked-footer-actions-root');
  if (footerRoot) {
    flushSync(() => createRoot(footerRoot).render(<BlockedFooterActions />));
  }
}

mountBlockedShell();
