import * as Toolbar from '@radix-ui/react-toolbar';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

function NewtabToolbar() {
  return (
    <Toolbar.Root className="top-bar-actions" aria-label="New tab actions">
      <Toolbar.Button
        className="theme-toggle settings-launch"
        id="settings-btn"
        title="Open settings"
        aria-label="Open settings"
        type="button"
      >
        <span className="settings-icon" id="settings-icon" />
      </Toolbar.Button>
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

function mountNewtabShell() {
  const root = document.getElementById('newtab-toolbar-root');
  if (!root) return;
  flushSync(() => createRoot(root).render(<NewtabToolbar />));
}

mountNewtabShell();
