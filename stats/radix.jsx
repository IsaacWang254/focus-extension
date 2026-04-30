import * as Progress from '@radix-ui/react-progress';
import * as Select from '@radix-ui/react-select';
import * as Toolbar from '@radix-ui/react-toolbar';
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

const NAV_ITEMS = [
  ['overview', 'Overview', 'target'],
  ['boundaries', 'Boundaries', 'shield'],
  ['productivity-score', 'Focus Balance', 'trendingUp'],
  ['categories', 'Categories', 'folder'],
  ['hourly', 'Daily Rhythm', 'clock'],
  ['weekly', 'Weekly Rhythm', 'calendar'],
  ['top-sites', 'Top Sites', 'star'],
  ['suggestions', 'Potential Blocks', 'ban'],
  ['insights', 'Reflection Prompts', 'lightbulb']
];

const FALLBACK_ICONS = {
  alertCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v5"/><path d="M12 16h.01"/></svg>',
  alertTriangle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.3 4 2 19h20L13.7 4a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  ban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg>',
  checkCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><path d="m22 4-10 10-3-3"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  graduationCap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m22 10-10-5-10 5 10 5Z"/><path d="M6 12v5c2 2 10 2 12 0v-5"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
  lightbulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M8 14c-.8-1-2-2.5-2-5a6 6 0 1 1 12 0c0 2.5-1.2 4-2 5"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  messageCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a8 8 0 0 1-11.8 7L3 21l2-5.8A8 8 0 1 1 21 12Z"/></svg>',
  minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>',
  newspaper: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 22h14a2 2 0 0 0 2-2V4H6v16a2 2 0 0 1-2 2Z"/><path d="M8 8h8"/><path d="M8 12h8"/><path d="M8 16h5"/></svg>',
  playCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4Z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>',
  shoppingCart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l3 14h10l3-9H6"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 2 3 6 7 .9-5 4.8 1.2 6.8L12 17.3l-6.2 3.2L7 13.7 2 8.9 9 8Z"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
  trendingDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m23 18-9.5-9.5-5 5L1 6"/><path d="M17 18h6v-6"/></svg>',
  trendingUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m23 6-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.5"/><path d="M16 3.5a4 4 0 0 1 0 7"/></svg>',
  zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2 3 14h9l-1 8 10-12h-9Z"/></svg>'
};

const PREVIEW_SETTINGS = {
  blockedSites: ['x.com', 'youtube.com', 'reddit.com'],
  historyAnalysisEnabled: true
};

const PREVIEW_UNBLOCK_REASONS = {
  totalCount: 7,
  domainStats: { 'youtube.com': 3, 'reddit.com': 2, 'x.com': 2 },
  categoryStats: { research: 3, work: 2, other: 2 },
  recentReasons: [
    { domain: 'youtube.com', reason: 'Needed a tutorial for a build issue.', timestamp: Date.now() - 3600000 },
    { domain: 'reddit.com', reason: 'Checking a specific answer thread.', timestamp: Date.now() - 86400000 }
  ]
};

const PREVIEW_CATEGORIES = {
  socialMedia: { name: 'Social' },
  entertainment: { name: 'Entertainment' },
  productivity: { name: 'Productivity' },
  education: { name: 'Education' },
  news: { name: 'News' }
};

function hasExtensionRuntime() {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.sendMessage);
}

async function sendRuntimeMessage(message) {
  if (hasExtensionRuntime()) return chrome.runtime.sendMessage(message);
  return getPreviewResponse(message);
}

function getPreviewResponse(message) {
  switch (message.type) {
    case 'GET_ALL_TIME_STATS':
      return { totalSessions: 18, totalMinutes: 460 };
    case 'GET_SETTINGS':
      return PREVIEW_SETTINGS;
    case 'GET_UNBLOCK_REASONS':
      return PREVIEW_UNBLOCK_REASONS;
    case 'GET_SITE_CATEGORIES':
      return PREVIEW_CATEGORIES;
    case 'ANALYZE_HISTORY':
      return {
        categories: [
          { key: 'productivity', name: 'Productivity', visits: 82, color: '#56524d' },
          { key: 'education', name: 'Education', visits: 41, color: '#6b665f' },
          { key: 'socialMedia', name: 'Social', visits: 34, color: '#8a837a' },
          { key: 'entertainment', name: 'Entertainment', visits: 19, color: '#a49c92' }
        ],
        hourlyDistribution: [1, 0, 0, 0, 0, 1, 3, 8, 12, 15, 10, 9, 7, 11, 16, 18, 14, 10, 7, 5, 4, 3, 2, 1],
        topDomains: [
          { domain: 'github.com', visits: 36, category: 'productivity' },
          { domain: 'developer.mozilla.org', visits: 22, category: 'education' },
          { domain: 'youtube.com', visits: 19, category: 'entertainment', categorySource: 'content-scan' },
          { domain: 'reddit.com', visits: 14, category: '' }
        ]
      };
    case 'GET_PRODUCTIVITY_SCORE':
      return {
        score: 72,
        grade: 'b',
        breakdown: { productiveVisits: 82, distractingVisits: 34, neutralVisits: 22 },
        insights: {
          topProductiveSite: 'github.com',
          peakHourLabel: '3 PM',
          avgDailyVisits: 41,
          topDistractingSite: 'youtube.com',
          uniqueSites: 37
        }
      };
    case 'GET_BROWSING_PATTERNS':
      return { dayOfWeek: [9, 18, 22, 19, 24, 17, 8].map((visits) => ({ visits })) };
    case 'GET_BLOCK_SUGGESTIONS':
      return [
        { domain: 'youtube.com', reason: 'Frequently visited entertainment site', visits: 19 },
        { domain: 'reddit.com', reason: 'Recurring social browsing pattern', visits: 14 }
      ];
    case 'SET_SITE_CATEGORY_OVERRIDE':
    case 'ADD_BLOCKED_SITE':
      return { success: true };
    default:
      return null;
  }
}

async function hasHistoryPermission() {
  if (!hasExtensionRuntime()) return true;
  return chrome.permissions.contains({ permissions: ['history'] });
}

async function requestHistoryPermission() {
  if (!hasExtensionRuntime()) return true;
  return chrome.permissions.request({ permissions: ['history'] });
}

async function loadTheme() {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      document.documentElement.setAttribute('data-theme', 'dashboard-light');
      return;
    }

    const result = await chrome.storage.local.get(['theme', 'brutalistEnabled']);
    document.documentElement.setAttribute('data-theme', result.theme === 'dark' ? 'dashboard-dark' : 'dashboard-light');
    if (result.brutalistEnabled) await chrome.storage.local.remove('brutalistEnabled');
  } catch (error) {
    console.error('Failed to load theme:', error);
  }
}

function Icon({ name }) {
  const icons = window.Icons || FALLBACK_ICONS;
  return <span dangerouslySetInnerHTML={{ __html: icons[name] || '' }} />;
}

function formatDate(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatRelativeTime(timestamp) {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return formatDate(new Date(timestamp));
}

function formatDomainLabel(domain) {
  if (typeof domain !== 'string') return 'Unknown site';
  return domain.trim().replace(/^www\./, '') || 'Unknown site';
}

function getFocusBalanceDescriptor(score) {
  if (score >= 80) return { label: 'Steady' };
  if (score >= 65) return { label: 'Good' };
  if (score >= 45) return { label: 'Mixed' };
  if (score >= 25) return { label: 'Drift' };
  return { label: 'Scattered' };
}

function Sidebar({ activeSection, hiddenHistory, onNavigate }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">Stats</span>
      </div>
      <Toolbar.Root className="sidebar-nav" orientation="vertical" aria-label="Stats sections">
        {NAV_ITEMS.filter(([id]) => !hiddenHistory || ![
          'productivity-score', 'categories', 'hourly', 'weekly', 'top-sites', 'suggestions', 'insights'
        ].includes(id)).map(([id, label, icon]) => (
          <Toolbar.Button
            className={`sidebar-link ${activeSection === id ? 'active' : ''}`}
            key={id}
            type="button"
            aria-current={activeSection === id ? 'true' : undefined}
            onClick={() => onNavigate(id)}
          >
            <span className="sidebar-link-icon"><Icon name={icon} /></span>
            <span className="sidebar-link-label">{label}</span>
          </Toolbar.Button>
        ))}
      </Toolbar.Root>
    </aside>
  );
}

function Overview({ overview }) {
  const cards = [
    ['target', overview.totalSessions || 0, 'Focus Sessions'],
    ['clock', overview.totalMinutes || 0, 'Minutes Focused'],
    ['ban', overview.blockedSites || 0, 'Blocked Sites'],
    ['list', overview.unblockCount || 0, 'Times Unblocked']
  ];

  return (
    <section className="overview-section" id="overview">
      {cards.map(([icon, value, label]) => (
        <div className="stat-card" key={label}>
          <div className="stat-icon"><Icon name={icon} /></div>
          <div className="stat-content">
            <span className="stat-value">{value}</span>
            <span className="stat-label">{label}</span>
          </div>
        </div>
      ))}
    </section>
  );
}

function Boundaries({ settings, unblockReasons }) {
  const domainStats = Object.entries(unblockReasons.domainStats || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const categoryLabels = {
    work: 'Work',
    research: 'Research',
    social: 'Social',
    entertainment: 'Entertainment',
    news: 'News',
    fomo: 'FOMO',
    other: 'Other'
  };
  const categoryStats = Object.entries(unblockReasons.categoryStats || {}).sort((a, b) => b[1] - a[1]);
  const recentReasons = (unblockReasons.recentReasons || []).slice(-5).reverse();

  return (
    <section className="section" id="boundaries">
      <h2 className="section-title">Boundaries</h2>
      <p className="section-desc">A quick view of the sites you&apos;ve put limits around and the moments you chose to step past them.</p>
      <div className="blocking-stats">
        <Metric value={settings.blockedSites?.length || 0} label="Sites Blocked" />
        <Metric value={unblockReasons.totalCount || 0} label="Times Unblocked" />
        <Metric value={(unblockReasons.totalCount || 0) * 10} label="Minutes Unblocked" />
      </div>
      <div className="boundaries-grid">
        <div className="boundary-card">
          <h3 className="boundary-title">Sites You Revisited</h3>
          <div className="top-blocked">
            {domainStats.length ? domainStats.map(([domain, count]) => (
              <div className="blocked-site-item" key={domain}>
                <span className="blocked-site-name">{formatDomainLabel(domain)}</span>
                <span className="blocked-site-count">{count} times</span>
              </div>
            )) : <EmptyState text="You have not unblocked any sites yet." />}
          </div>
        </div>
        <div className="boundary-card">
          <h3 className="boundary-title">Why You Unblocked</h3>
          <div className="reasons-chart">
            {categoryStats.length ? categoryStats.map(([category, count]) => (
              <div className="reason-tag" key={category}>
                {categoryLabels[category] || category}
                <span className="reason-count">{count}</span>
              </div>
            )) : <EmptyState text="No reasons recorded" />}
          </div>
        </div>
      </div>
      <div className="recent-reasons-card">
        <h3 className="boundary-title">Recent Notes to Yourself</h3>
        <div className="recent-reasons">
          {recentReasons.length ? recentReasons.map((reason) => (
            <div className="reason-item" key={`${reason.domain}-${reason.timestamp}`}>
              <div className="reason-header">
                <span className="reason-domain">{reason.domain}</span>
                <span className="reason-time">{formatRelativeTime(reason.timestamp)}</span>
              </div>
              <div className="reason-text">{reason.reason}</div>
            </div>
          )) : <EmptyState text="No notes recorded yet." />}
        </div>
      </div>
    </section>
  );
}

function Metric({ value, label }) {
  return (
    <div className="blocking-stat">
      <span className="blocking-value">{value}</span>
      <span className="blocking-label">{label}</span>
    </div>
  );
}

function ProductivityScore({ data }) {
  const score = data?.score || 0;
  const descriptor = getFocusBalanceDescriptor(score);
  const grade = (data?.grade || 'f').toLowerCase();
  const breakdown = data?.breakdown || {};
  const productive = breakdown.productiveVisits || breakdown.productive || 0;
  const distracting = breakdown.distractingVisits || breakdown.distracting || 0;
  const neutral = breakdown.neutralVisits || breakdown.neutral || 0;
  const total = productive + distracting + neutral || 1;

  return (
    <div className="productivity-score-card" id="productivity-score">
      <div className="productivity-header">
        <div className={`productivity-grade grade-${grade}`}>{descriptor.label}</div>
        <div className="productivity-info">
          <span className="productivity-label">Focus Balance</span>
          <span className="productivity-sublabel">Last 7 days</span>
        </div>
        <div className="productivity-score-container">
          <div className="productivity-score-ring">
            <svg viewBox="0 0 36 36" className="productivity-ring-svg">
              <path className="productivity-ring-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" strokeWidth="3" />
              <path className={`productivity-ring-fill grade-${grade}`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" strokeWidth="3" strokeDasharray={`${score}, 100`} />
            </svg>
            <span className="productivity-score-value">{score}</span>
          </div>
        </div>
      </div>
      <div className="productivity-breakdown">
        <Breakdown type="productive" icon="trendingUp" label="Productive" value={Math.round((productive / total) * 100)} />
        <Breakdown type="distracting" icon="trendingDown" label="Distracting" value={Math.round((distracting / total) * 100)} />
        <Breakdown type="neutral" icon="minus" label="Neutral" value={Math.round((neutral / total) * 100)} />
      </div>
    </div>
  );
}

function Breakdown({ type, icon, label, value }) {
  return (
    <div className={`breakdown-item ${type}`}>
      <span className="breakdown-icon"><Icon name={icon} /></span>
      <span className="breakdown-label">{label}</span>
      <span className="breakdown-value">{value}%</span>
    </div>
  );
}

function CategoryBreakdown({ categories }) {
  const maxVisits = Math.max(...(categories || []).map((category) => category.visits), 1);
  const iconMap = {
    socialMedia: 'messageCircle',
    entertainment: 'playCircle',
    news: 'newspaper',
    gaming: 'gamepad',
    shopping: 'shoppingCart',
    forums: 'users',
    productivity: 'zap',
    education: 'graduationCap',
    email: 'mail'
  };

  return (
    <HistoryCard id="categories" icon="folder" title="Where Your Time Went">
      <div className="category-bars">
        {categories?.length ? categories.slice(0, 8).map((category) => (
          <div className="category-bar-item" key={category.key}>
            <span className="category-bar-icon">
              <Icon name={iconMap[category.key] || 'folder'} />
            </span>
            <span className="category-bar-name">{category.name}</span>
            <Progress.Root className="category-bar-container" value={(category.visits / maxVisits) * 100}>
              <Progress.Indicator
                className="category-bar-fill"
                style={{ transform: `translateX(-${100 - ((category.visits / maxVisits) * 100)}%)` }}
              />
            </Progress.Root>
            <span className="category-bar-value">{category.visits} visits</span>
          </div>
        )) : <EmptyState text="No browsing data" />}
      </div>
    </HistoryCard>
  );
}

function HourlyChart({ hourlyData }) {
  const maxVisits = Math.max(...(hourlyData || []), 1);
  return (
    <HistoryCard id="hourly" icon="clock" title="Daily Rhythm">
      <div className="hourly-chart">
        {(hourlyData || []).map((visits, hour) => (
          <div
            className="hourly-bar"
            key={hour}
            style={{ height: `${Math.max((visits / maxVisits) * 100, 2)}%` }}
            title={`${hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}: ${visits} visits`}
          />
        ))}
      </div>
      <div className="hourly-labels">
        <span>12 AM</span>
        <span>6 AM</span>
        <span>12 PM</span>
        <span>6 PM</span>
        <span>11 PM</span>
      </div>
    </HistoryCard>
  );
}

function WeeklyChart({ patterns }) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayData = patterns?.dayOfWeek || [];
  const maxVisits = Math.max(...dayData.map((day) => day.visits || 0), 1);

  return (
    <HistoryCard id="weekly" icon="calendar" title="Weekly Rhythm">
      <div className="weekly-chart">
        {days.map((day, index) => {
          const visits = dayData[index]?.visits || 0;
          return (
            <div className="weekly-day" key={day}>
              <div className="weekly-day-bar-container">
                <div className="weekly-day-bar" style={{ height: `${Math.max((visits / maxVisits) * 100, 2)}%` }} />
              </div>
              <span className="weekly-day-label">{day}</span>
              <span className="weekly-day-value">{visits}</span>
            </div>
          );
        })}
      </div>
    </HistoryCard>
  );
}

function TopSites({ sites, siteCategories, onSetCategory }) {
  return (
    <HistoryCard id="top-sites" icon="star" title="Sites You Kept Returning To">
      <div className="top-sites-list">
        {sites?.length ? sites.slice(0, 10).map((site, index) => {
          const categoryName = siteCategories[site.category]?.name || site.category || 'Uncategorized';
          const showCategoryEditor = !site.category || site.categorySource === 'content-scan';
          return (
            <div className={`top-site-item ${!site.category ? 'is-uncategorized' : ''}`} key={site.domain}>
              <span className={`top-site-rank ${index < 3 ? `rank-${index + 1}` : ''}`}>{index + 1}</span>
              <div className="top-site-info">
                <div className="top-site-domain">{formatDomainLabel(site.domain)}</div>
                <div className="top-site-meta">
                  <div className="top-site-category">{categoryName}</div>
                  {site.categorySource === 'content-scan' && <span className="top-site-category-hint">Suggested</span>}
                </div>
                {showCategoryEditor && (
                  <CategorySelect
                    categories={siteCategories}
                    domain={site.domain}
                    value={site.category || ''}
                    onSetCategory={onSetCategory}
                  />
                )}
              </div>
              <span className="top-site-visits">{site.visits} visits</span>
            </div>
          );
        }) : <EmptyState text="No browsing data" />}
      </div>
    </HistoryCard>
  );
}

function CategorySelect({ categories, domain, value, onSetCategory }) {
  return (
    <div className="top-site-categorize-panel stats-radix-category-panel">
      <span className="top-site-categorize-label">Category</span>
      <Select.Root value={value || undefined} onValueChange={(category) => onSetCategory(domain, category)}>
        <Select.Trigger className="top-site-category-select stats-radix-select" aria-label={`Category for ${domain}`}>
          <Select.Value placeholder="Choose one..." />
          <Select.Icon className="select-chevron" aria-hidden="true">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m2 4 3 3 3-3" /></svg>
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="radix-select-content" position="popper" sideOffset={4}>
            <Select.Viewport className="radix-select-viewport">
              {Object.entries(categories).map(([key, category]) => (
                <Select.Item className="radix-select-item" key={key} value={key}>
                  <Select.ItemText>{category.name}</Select.ItemText>
                  <Select.ItemIndicator className="radix-select-indicator">
                    <span className="radix-select-dot" aria-hidden="true" />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}

function Suggestions({ suggestions, onBlock }) {
  return (
    <HistoryCard id="suggestions" icon="ban" title="Potential Distractions to Block" className="suggestions-card">
      <p className="suggestions-desc">If a site keeps pulling attention away from what matters, you can turn that pattern into a boundary here.</p>
      <div className="suggestions-list">
        {suggestions?.length ? suggestions.slice(0, 5).map((suggestion) => (
          <div className="suggestion-item" key={suggestion.domain}>
            <div className="suggestion-info">
              <div className="suggestion-domain">{suggestion.domain}</div>
              <div className="suggestion-reason">{suggestion.reason || 'Frequently visited distracting site'}</div>
            </div>
            <span className="suggestion-visits">{suggestion.visits} visits</span>
            <button className="suggestion-btn" type="button" onClick={() => onBlock(suggestion.domain)}>
              <Icon name="ban" />
              <span>Block</span>
            </button>
          </div>
        )) : (
          <EmptyState icon="checkCircle" text="Nothing stands out yet. As patterns become clearer, this area will suggest sites you may want to fence off." />
        )}
      </div>
    </HistoryCard>
  );
}

function Insights({ productivityData }) {
  const insights = useMemo(() => buildInsights(productivityData), [productivityData]);
  const iconMap = {
    positive: 'trendingUp',
    negative: 'trendingDown',
    neutral: 'info',
    tip: 'lightbulb',
    warning: 'alertTriangle'
  };

  return (
    <HistoryCard id="insights" icon="lightbulb" title="Reflection Prompts" className="insights-card">
      <div className="insights-list">
        {insights.length ? insights.map((insight) => (
          <div className={`insight-item insight-${insight.type}`} key={insight.title}>
            <span className="insight-icon"><Icon name={iconMap[insight.type] || 'info'} /></span>
            <div className="insight-content">
              <div className="insight-title">{insight.title}</div>
              <span className="insight-text">{insight.text}</span>
            </div>
          </div>
        )) : <EmptyState icon="info" text="Not enough data for insights yet. Check back after more browsing activity." />}
      </div>
    </HistoryCard>
  );
}

function buildInsights(productivityData = {}) {
  const insightsData = productivityData.insights || {};
  const score = productivityData.score || 0;
  const insights = [];

  if (score >= 80) insights.push({ type: 'positive', title: 'Your attention looked steady', text: 'Most of your recent browsing leaned productive. Notice what helped make that easier.' });
  else if (score >= 70) insights.push({ type: 'positive', title: 'You had a solid balance', text: 'There was a healthy mix of productive browsing this week, with some room to tighten the edges.' });
  if (insightsData.topProductiveSite) insights.push({ type: 'positive', title: 'Anchor site', text: `${insightsData.topProductiveSite} was the place you returned to most for productive work.` });
  if (insightsData.peakHourLabel) insights.push({ type: 'neutral', title: 'Peak browsing window', text: `You were most active online around ${insightsData.peakHourLabel}. Ask whether that time felt intentional or reactive.` });
  if (insightsData.avgDailyVisits > 0) insights.push({ type: 'neutral', title: 'Daily volume', text: `You averaged ${insightsData.avgDailyVisits} site visits per day over the last week.` });
  if (insightsData.topDistractingSite) insights.push({ type: 'warning', title: 'Recurring distraction', text: `${insightsData.topDistractingSite} showed up as the clearest distraction pattern in your recent browsing.` });
  if (score < 40) insights.push({ type: 'tip', title: 'A small next step', text: 'Pick one high-friction site and block it during the hours you most want to protect.' });
  else if (score < 60) insights.push({ type: 'tip', title: 'Where to tighten things up', text: 'Your patterns look mixed. A lighter blocklist or more intentional session timing could reduce drift.' });
  if (insightsData.uniqueSites > 0) insights.push({ type: 'neutral', title: 'Attention spread', text: `You visited ${insightsData.uniqueSites} unique sites in the past week. More variety can mean exploration, but it can also mean fragmentation.` });

  return insights;
}

function HistoryCard({ id, icon, title, children, className = '' }) {
  return (
    <div className={`history-card ${className}`} id={id}>
      <h3 className="history-card-title">
        <Icon name={icon} />
        {title}
      </h3>
      {children}
    </div>
  );
}

function EmptyState({ text, icon }) {
  return (
    <div className="empty-state-text">
      {icon && <Icon name={icon} />}
      <span>{text}</span>
    </div>
  );
}

function HistoryPermission({ onGrant }) {
  return (
    <div className="history-permission">
      <div className="history-permission-icon"><Icon name="alertCircle" /></div>
      <div className="history-permission-title">Permission Required</div>
      <div className="history-permission-desc">Grant browser history access to analyze your browsing patterns and get personalized suggestions.</div>
      <button className="history-permission-btn" type="button" onClick={onGrant}>Grant Permission</button>
    </div>
  );
}

function LoadingHistory() {
  return (
    <div className="history-loading">
      <div className="history-loading-spinner" />
      <span>Analyzing browsing history...</span>
    </div>
  );
}

function StatsApp() {
  const [activeSection, setActiveSection] = useState('overview');
  const [settings, setSettings] = useState(PREVIEW_SETTINGS);
  const [overview, setOverview] = useState({});
  const [unblockReasons, setUnblockReasons] = useState(PREVIEW_UNBLOCK_REASONS);
  const [siteCategories, setSiteCategories] = useState({});
  const [historyData, setHistoryData] = useState(null);
  const [productivityData, setProductivityData] = useState(null);
  const [weeklyPatterns, setWeeklyPatterns] = useState(null);
  const [suggestions, setSuggestions] = useState(null);
  const [historyState, setHistoryState] = useState('loading');
  const [historyError, setHistoryError] = useState('');

  useEffect(() => {
    let cleanup = () => {};
    loadTheme();

    if (hasExtensionRuntime() && chrome.storage?.onChanged) {
      const onChanged = (changes, areaName) => {
        if (areaName === 'local' && (changes.theme || changes.accentColor)) loadTheme();
      };
      chrome.storage.onChanged.addListener(onChanged);
      cleanup = () => chrome.storage.onChanged.removeListener(onChanged);
    }

    loadAllStats();
    return cleanup;
  }, []);

  useEffect(() => {
    let ticking = false;
    const sectionIds = NAV_ITEMS.map(([id]) => id);
    const onScroll = () => {
      if (ticking) return;
      window.requestAnimationFrame(() => {
        const scrollPos = window.scrollY + 100;
        let next = sectionIds[0];
        for (const id of sectionIds) {
          const section = document.getElementById(id);
          if (section && scrollPos >= section.offsetTop) next = id;
        }
        setActiveSection(next);
        ticking = false;
      });
      ticking = true;
    };
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  async function loadAllStats() {
    try {
      const [allTimeStats, nextSettings, nextUnblockReasons] = await Promise.all([
        sendRuntimeMessage({ type: 'GET_ALL_TIME_STATS' }),
        sendRuntimeMessage({ type: 'GET_SETTINGS' }),
        sendRuntimeMessage({ type: 'GET_UNBLOCK_REASONS' })
      ]);

      setSettings(nextSettings || {});
      setUnblockReasons(nextUnblockReasons || {});
      setOverview({
        totalSessions: allTimeStats?.totalSessions || 0,
        totalMinutes: allTimeStats?.totalMinutes || 0,
        blockedSites: nextSettings?.blockedSites?.length || 0,
        unblockCount: nextUnblockReasons?.totalCount || 0
      });

      await loadHistoryAnalysis(nextSettings);
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  }

  async function loadHistoryAnalysis(nextSettings = settings) {
    try {
      if (nextSettings?.historyAnalysisEnabled === false) {
        setHistoryState('hidden');
        return;
      }

      if (!(await hasHistoryPermission())) {
        setHistoryState('permission');
        return;
      }

      setHistoryState('loading');
      setHistoryError('');
      const [categories, history, productivity, weekly, nextSuggestions] = await Promise.all([
        sendRuntimeMessage({ type: 'GET_SITE_CATEGORIES' }),
        sendRuntimeMessage({ type: 'ANALYZE_HISTORY', days: 7 }),
        sendRuntimeMessage({ type: 'GET_PRODUCTIVITY_SCORE', days: 7 }),
        sendRuntimeMessage({ type: 'GET_BROWSING_PATTERNS', days: 7 }),
        sendRuntimeMessage({ type: 'GET_BLOCK_SUGGESTIONS' })
      ]);

      if (history?.error) throw new Error(history.error);
      setSiteCategories(categories || {});
      setHistoryData(history || {});
      setProductivityData(productivity?.error ? null : productivity);
      setWeeklyPatterns(weekly?.error ? null : weekly);
      setSuggestions(nextSuggestions?.error ? [] : nextSuggestions);
      setHistoryState('ready');
    } catch (error) {
      console.error('Failed to load history analysis:', error);
      setHistoryError(error.message);
      setHistoryState('error');
    }
  }

  function navigateTo(id) {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function grantHistoryPermission() {
    if (await requestHistoryPermission()) await loadHistoryAnalysis();
  }

  async function setSiteCategory(domain, category) {
    await sendRuntimeMessage({ type: 'SET_SITE_CATEGORY_OVERRIDE', domain, category });
    setHistoryData((previous) => ({
      ...previous,
      topDomains: (previous?.topDomains || []).map((site) => site.domain === domain ? { ...site, category } : site)
    }));
  }

  async function blockSuggestion(domain) {
    await sendRuntimeMessage({ type: 'ADD_BLOCKED_SITE', site: domain });
    setSuggestions((previous) => (previous || []).filter((suggestion) => suggestion.domain !== domain));
  }

  return (
    <>
      <Sidebar activeSection={activeSection} hiddenHistory={historyState === 'hidden'} onNavigate={navigateTo} />
      <div className="container">
        <header className="header">
          <div className="header-copy">
            <h1>Your Activity</h1>
            <p className="header-desc">A simple look at how you&apos;ve been spending attention online, without streaks or scorekeeping.</p>
          </div>
        </header>

        <Overview overview={overview} />
        <Boundaries settings={settings} unblockReasons={unblockReasons} />

        {historyState !== 'hidden' && (
          <section className="section history-analysis-section" id="history-analysis">
            <h2 className="section-title">Browsing Reflection</h2>
            <p className="section-desc">Use your browser history to notice patterns in attention, spot distractions, and decide what deserves more intention.</p>

            {historyState === 'permission' && <HistoryPermission onGrant={grantHistoryPermission} />}
            {historyState === 'loading' && <LoadingHistory />}
            {historyState === 'error' && (
              <div className="history-error">
                <div className="history-error-icon"><Icon name="alertCircle" /></div>
                <div className="history-error-text">Failed to analyze history: {historyError}</div>
              </div>
            )}
            {historyState === 'ready' && (
              <>
                <ProductivityScore data={productivityData} />
                <CategoryBreakdown categories={historyData?.categories || []} />
                <HourlyChart hourlyData={historyData?.hourlyDistribution || []} />
                <WeeklyChart patterns={weeklyPatterns} />
                <TopSites sites={historyData?.topDomains || []} siteCategories={siteCategories} onSetCategory={setSiteCategory} />
                <Suggestions suggestions={suggestions || []} onBlock={blockSuggestion} />
                <Insights productivityData={productivityData} />
              </>
            )}
          </section>
        )}

        <footer className="footer">
          <Toolbar.Root className="footer-toolbar" aria-label="Stats actions">
            <Toolbar.Button className="btn btn-secondary" type="button" onClick={() => window.close()}>
              Back to Extension
            </Toolbar.Button>
          </Toolbar.Root>
        </footer>
      </div>
    </>
  );
}

export function renderStatsApp(container) {
  createRoot(container).render(<StatsApp />);
}
