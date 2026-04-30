import * as Toolbar from '@radix-ui/react-toolbar';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

const NAV_ITEMS = [
  ['page-blocking', 'Blocking'],
  ['page-filters', 'Filters'],
  ['page-automation', 'Automation'],
  ['page-integrations', 'Integrations'],
  ['page-appearance', 'Appearance'],
  ['page-privacy', 'Privacy & Backup']
];

function OptionsNav() {
  return (
    <Toolbar.Root className="sidebar-nav" orientation="vertical" aria-label="Settings sections">
      {NAV_ITEMS.map(([pageId, label], index) => (
        <Toolbar.Link asChild key={pageId}>
          <a
            className={`sidebar-link ${index === 0 ? 'active' : ''}`}
            data-page={pageId}
            href={`#${pageId}`}
          >
            {label}
          </a>
        </Toolbar.Link>
      ))}
    </Toolbar.Root>
  );
}

function mountOptionsShell() {
  const root = document.getElementById('sidebar-nav');
  if (!root) return;
  flushSync(() => createRoot(root).render(<OptionsNav />));
}

mountOptionsShell();
