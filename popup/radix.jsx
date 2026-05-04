import * as ToggleGroup from '@radix-ui/react-toggle-group';
import * as Toolbar from '@radix-ui/react-toolbar';
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createRuntimeMessenger, hasExtensionRuntime } from '../lib/runtime.js';
import { loadTheme, setupBrowserThemeSyncListener } from '../lib/theme.js';
import { SimpleSelect } from '../lib/ui.jsx';

const FOCUS_LABELS = {
  pomodoro: 'Pomodoro',
  short: 'Short',
  long: 'Long'
};

const FOCUS_TYPES = ['pomodoro', 'short', 'long'];

const PREVIEW_SETTINGS = {
  mode: 'blocklist',
  blockedSites: ['example.com'],
  allowedSites: [],
  schedule: { enabled: false }
};

const PREVIEW_PROFILES = [
  { id: 'work', name: 'Work' },
  { id: 'study', name: 'Study' },
  { id: 'quiet', name: 'Quiet Hours' }
];

let previewActiveProfileId = 'work';
let previewSettings = clone(PREVIEW_SETTINGS);
let previewFocusSession = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getPreviewResponse(message) {
  switch (message.type) {
    case 'GET_SETTINGS':
      return clone(previewSettings);
    case 'GET_CURRENT_TAB_URL':
      return { domain: 'example.com' };
    case 'GET_DAILY_USAGE':
      return { enabled: true, exceeded: false, remainingMinutes: 42 };
    case 'GET_TEMP_UNBLOCKS':
      return [];
    case 'GET_PROFILES':
      return PREVIEW_PROFILES;
    case 'GET_ACTIVE_PROFILE':
      return PREVIEW_PROFILES.find((profile) => profile.id === previewActiveProfileId);
    case 'SET_ACTIVE_PROFILE':
      previewActiveProfileId = message.profileId;
      return { success: true };
    case 'GET_FOCUS_PRESETS':
      return {
        pomodoro: { workMinutes: 25 },
        short: { workMinutes: 15 },
        long: { workMinutes: 50 }
      };
    case 'GET_FOCUS_SESSION':
      return previewFocusSession;
    case 'START_FOCUS_SESSION': {
      const minutes = message.sessionType === 'short' ? 15 : message.sessionType === 'long' ? 50 : 25;
      previewFocusSession = {
        active: true,
        phase: 'work',
        endTime: Date.now() + minutes * 60 * 1000
      };
      return previewFocusSession;
    }
    case 'STOP_FOCUS_SESSION':
      previewFocusSession = null;
      return { success: true };
    case 'SKIP_FOCUS_PHASE':
      if (previewFocusSession?.phase === 'work') {
        return { success: false, error: 'Focus periods cannot be skipped' };
      }
      previewFocusSession = null;
      return { success: true };
    case 'ADD_BLOCKED_SITE':
      previewSettings.blockedSites = [...new Set([...previewSettings.blockedSites, message.site])];
      return { success: true };
    case 'REMOVE_BLOCKED_SITE':
      previewSettings.blockedSites = previewSettings.blockedSites.filter((site) => site !== message.site);
      return { success: true };
    case 'ADD_ALLOWED_SITE':
      previewSettings.allowedSites = [...new Set([...previewSettings.allowedSites, message.site])];
      return { success: true };
    case 'REMOVE_ALLOWED_SITE':
      previewSettings.allowedSites = previewSettings.allowedSites.filter((site) => site !== message.site);
      return { success: true };
    case 'END_TEMP_UNBLOCK':
      return { success: true };
    default:
      return null;
  }
}

const sendRuntimeMessage = createRuntimeMessenger(getPreviewResponse);

async function isIncognitoAccessAllowed() {
  if (!hasExtensionRuntime() || !chrome.extension || typeof chrome.extension.isAllowedIncognitoAccess !== 'function') {
    return true;
  }

  return new Promise((resolve) => {
    try {
      chrome.extension.isAllowedIncognitoAccess((isAllowedAccess) => {
        if (chrome.runtime.lastError) {
          console.warn('Failed to check incognito access:', chrome.runtime.lastError.message);
          resolve(true);
          return;
        }
        resolve(Boolean(isAllowedAccess));
      });
    } catch (e) {
      console.warn('Incognito access check unavailable:', e);
      resolve(true);
    }
  });
}

function isInAllowedTimeWindow(settings) {
  if (!settings?.schedule?.allowedTimes?.length) return false;
  const now = new Date();
  const currentTime = now.getHours() * 60 + now.getMinutes();

  return settings.schedule.allowedTimes.some((window) => {
    const [startHour, startMin] = window.start.split(':').map(Number);
    const [endHour, endMin] = window.end.split(':').map(Number);
    const startTime = startHour * 60 + startMin;
    const endTime = endHour * 60 + endMin;
    return currentTime >= startTime && currentTime < endTime;
  });
}

function formatFocusTime(session, now) {
  const remainingMs = Math.max(0, session.endTime - now);
  const mins = Math.floor(remainingMs / 60000);
  const secs = Math.floor((remainingMs % 60000) / 1000);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function isCurrentSiteBlocked(settings, currentDomain) {
  if (!settings || !currentDomain || currentDomain === 'N/A' || currentDomain.includes('chrome')) return false;
  if (settings.mode === 'blocklist') return settings.blockedSites.includes(currentDomain);
  return !settings.allowedSites.includes(currentDomain);
}

function getSiteAction(settings, currentDomain) {
  if (!settings || !currentDomain || currentDomain === 'N/A' || currentDomain.includes('chrome')) return null;

  const isBlocked = settings.blockedSites.includes(currentDomain);
  const isAllowed = settings.allowedSites.includes(currentDomain);

  if (settings.mode === 'blocklist') {
    return isBlocked
      ? { type: 'unblock', label: 'Unblock', className: 'btn btn-small btn-primary' }
      : { type: 'block', label: 'Block', className: 'btn btn-small btn-danger' };
  }

  return isAllowed
    ? { type: 'block', label: 'Remove', className: 'btn btn-small btn-danger' }
    : { type: 'unblock', label: 'Allow', className: 'btn btn-small btn-primary' };
}

function ProfileSelect({ activeProfileId, profiles, onSelect }) {
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId);
  const items = useMemo(
    () => profiles.map((profile) => ({ value: profile.id, label: profile.name })),
    [profiles]
  );

  return (
    <SimpleSelect
      ariaLabel="Active profile"
      items={items}
      onValueChange={onSelect}
      placeholder={activeProfile?.name || 'Choose profile'}
      triggerClassName="profile-select radix-select-trigger"
      value={activeProfileId}
    />
  );
}

function FocusPresetToggleGroup({ presets, selectedType, onSelect }) {
  return (
    <ToggleGroup.Root
      aria-label="Focus session preset"
      className="focus-presets radix-toggle-group"
      type="single"
      value={selectedType}
      onValueChange={(value) => {
        if (value) onSelect(value);
      }}
      rovingFocus
    >
      {FOCUS_TYPES.map((type) => {
        const preset = presets[type] || presets.pomodoro;

        return (
          <ToggleGroup.Item
            aria-label={`${FOCUS_LABELS[type]} focus preset, ${preset.workMinutes} minutes`}
            className="focus-preset-btn"
            data-type={type}
            key={type}
            value={type}
          >
            <span className="preset-time">{preset.workMinutes}</span>
            <span className="preset-label">{FOCUS_LABELS[type]}</span>
          </ToggleGroup.Item>
        );
      })}
    </ToggleGroup.Root>
  );
}

function PopupFooter({ onOpenSettings, onOpenStats }) {
  return (
    <Toolbar.Root className="footer-toolbar" aria-label="Popup links">
      <Toolbar.Button className="footer-link" type="button" onClick={onOpenStats}>
        Stats
      </Toolbar.Button>
      <Toolbar.Separator className="footer-sep" />
      <Toolbar.Button className="footer-link" type="button" onClick={onOpenSettings}>
        Settings
      </Toolbar.Button>
    </Toolbar.Root>
  );
}

function PopupApp() {
  const [settings, setSettings] = useState(null);
  const [currentDomain, setCurrentDomain] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [activeProfileId, setActiveProfileId] = useState('');
  const [alerts, setAlerts] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [presets, setPresets] = useState(null);
  const [selectedPresetType, setSelectedPresetType] = useState('pomodoro');
  const [focusSession, setFocusSession] = useState(null);
  const [now, setNow] = useState(Date.now());

  async function loadProfiles() {
    const nextProfiles = await sendRuntimeMessage({ type: 'GET_PROFILES' });
    const activeProfile = await sendRuntimeMessage({ type: 'GET_ACTIVE_PROFILE' });
    setProfiles(nextProfiles || []);
    setActiveProfileId(activeProfile?.id || '');
  }

  async function loadAlerts(nextSettings = settings) {
    if (!nextSettings) return;

    const nextAlerts = [];
    const incognitoAllowed = await isIncognitoAccessAllowed();
    if (!incognitoAllowed) {
      nextAlerts.push({ type: 'incognito', text: 'Enable "Allow in Incognito" so your blocks apply in private windows too.' });
    }

    if (nextSettings.schedule?.enabled) {
      const allowedTimes = nextSettings.schedule.allowedTimes || [];
      if (allowedTimes.length === 0) {
        setAlerts([...nextAlerts, { type: 'locked', text: 'Schedule: Always locked' }]);
        return;
      }

      const currentDay = new Date().getDay();
      const isActiveDay = nextSettings.schedule.activeDays?.includes(currentDay);
      if (isActiveDay && !isInAllowedTimeWindow(nextSettings)) {
        setAlerts([...nextAlerts, { type: 'locked', text: 'Schedule locked' }]);
        return;
      }
    }

    const usageInfo = await sendRuntimeMessage({ type: 'GET_DAILY_USAGE' });
    if (usageInfo?.enabled) {
      nextAlerts.push({
        type: usageInfo.exceeded ? 'locked' : 'info',
        text: usageInfo.exceeded
          ? `Daily limit reached (${usageInfo.usedMinutes}/${usageInfo.limitMinutes} min)`
          : `${usageInfo.remainingMinutes} min remaining today`
      });
    }

    setAlerts(nextAlerts);
  }

  async function loadSessions() {
    setSessions(await sendRuntimeMessage({ type: 'GET_TEMP_UNBLOCKS' }) || []);
  }

  async function loadFocusSession() {
    setFocusSession(await sendRuntimeMessage({ type: 'GET_FOCUS_SESSION' }));
  }

  async function refreshSettings() {
    const nextSettings = await sendRuntimeMessage({ type: 'GET_SETTINGS' });
    setSettings(nextSettings);
    await loadAlerts(nextSettings);
    return nextSettings;
  }

  useEffect(() => {
    let mounted = true;
    let cleanupThemeListener = () => {};
    let sessionInterval = null;
    let focusInterval = null;
    let tickInterval = null;

    async function initialize() {
      await loadTheme();
      cleanupThemeListener = setupBrowserThemeSyncListener();
      const [nextSettings, tabInfo, nextPresets] = await Promise.all([
        sendRuntimeMessage({ type: 'GET_SETTINGS' }),
        sendRuntimeMessage({ type: 'GET_CURRENT_TAB_URL' }),
        sendRuntimeMessage({ type: 'GET_FOCUS_PRESETS' })
      ]);

      if (!mounted) return;
      setSettings(nextSettings);
      setCurrentDomain(tabInfo?.domain || null);
      setPresets(nextPresets);
      await Promise.all([
        loadProfiles(),
        loadAlerts(nextSettings),
        loadSessions(),
        loadFocusSession()
      ]);

      if (!mounted) return;
      sessionInterval = setInterval(loadSessions, 2000);
      focusInterval = setInterval(loadFocusSession, 1000);
      tickInterval = setInterval(() => setNow(Date.now()), 1000);
    }

    initialize();

    return () => {
      mounted = false;
      cleanupThemeListener();
      if (sessionInterval) clearInterval(sessionInterval);
      if (focusInterval) clearInterval(focusInterval);
      if (tickInterval) clearInterval(tickInterval);
    };
  }, []);

  const currentSiteBlocked = useMemo(
    () => isCurrentSiteBlocked(settings, currentDomain),
    [settings, currentDomain]
  );
  const siteAction = useMemo(
    () => getSiteAction(settings, currentDomain),
    [settings, currentDomain]
  );
  const sessionSummary = useMemo(() => {
    if (!sessions.length) return '';
    const first = sessions[0].label || (sessions[0].domain === '__all__' ? 'All blocked sites' : sessions[0].domain);
    return sessions.length === 1
      ? `${first} temporarily unblocked`
      : `${first} +${sessions.length - 1} more unblocked`;
  }, [sessions]);

  async function handleProfileSelect(profileId) {
    const result = await sendRuntimeMessage({ type: 'SET_ACTIVE_PROFILE', profileId });
    if (!result?.success) return;
    await refreshSettings();
    await loadProfiles();
  }

  async function handleSiteAction() {
    if (!settings || !siteAction) return;

    if (settings.mode === 'blocklist') {
      if (siteAction.type === 'block') {
        await sendRuntimeMessage({ type: 'ADD_BLOCKED_SITE', site: currentDomain });
        setSettings((previous) => ({
          ...previous,
          blockedSites: [...new Set([...previous.blockedSites, currentDomain])]
        }));
      } else {
        await sendRuntimeMessage({ type: 'REMOVE_BLOCKED_SITE', site: currentDomain });
        setSettings((previous) => ({
          ...previous,
          blockedSites: previous.blockedSites.filter((site) => site !== currentDomain)
        }));
      }
      return;
    }

    if (siteAction.type === 'block') {
      await sendRuntimeMessage({ type: 'REMOVE_ALLOWED_SITE', site: currentDomain });
      setSettings((previous) => ({
        ...previous,
        allowedSites: previous.allowedSites.filter((site) => site !== currentDomain)
      }));
    } else {
      await sendRuntimeMessage({ type: 'ADD_ALLOWED_SITE', site: currentDomain });
      setSettings((previous) => ({
        ...previous,
        allowedSites: [...new Set([...previous.allowedSites, currentDomain])]
      }));
    }
  }

  async function endSessions() {
    for (const session of sessions) {
      await sendRuntimeMessage({ type: 'END_TEMP_UNBLOCK', domain: session.domain });
    }
    await loadSessions();
  }

  async function startFocusSession() {
    const session = await sendRuntimeMessage({
      type: 'START_FOCUS_SESSION',
      sessionType: selectedPresetType
    });
    if (session?.active) setFocusSession(session);
  }

  async function skipFocusBreak() {
    await sendRuntimeMessage({ type: 'SKIP_FOCUS_PHASE' });
    await loadFocusSession();
  }

  async function stopFocusSession() {
    await sendRuntimeMessage({ type: 'STOP_FOCUS_SESSION' });
    await loadFocusSession();
  }

  function openOptions() {
    if (hasExtensionRuntime()) {
      chrome.runtime.openOptionsPage();
    } else {
      window.location.href = '../options/options.html';
    }
  }

  function openStats() {
    if (hasExtensionRuntime()) {
      chrome.tabs.create({ url: chrome.runtime.getURL('stats/stats.html') });
    } else {
      window.location.href = '../stats/stats.html';
    }
  }

  async function openIncognitoSettings() {
    if (hasExtensionRuntime()) {
      await chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
    }
  }

  if (!settings || !presets) {
    return (
      <div className="popup">
        <header className="header">
          <h1>Focus</h1>
        </header>
      </div>
    );
  }

  return (
    <div className="popup">
      <header className="header">
        <h1>Focus</h1>
      </header>

      <div className="status">
        <span id="status-text">Blocking enabled</span>
        <span id="mode-badge" className={settings.mode === 'allowlist' ? 'allowlist' : ''}>
          {settings.mode === 'blocklist' ? 'Blocklist' : 'Allowlist'}
        </span>
      </div>

      {profiles.length > 1 && (
        <div className="profile-row visible">
          <ProfileSelect
            activeProfileId={activeProfileId}
            profiles={profiles}
            onSelect={handleProfileSelect}
          />
        </div>
      )}

      {alerts.length > 0 && (
        <div className="alerts">
          {alerts.map((alert, index) => (
            <div
              className={`alert-item ${alert.type === 'locked' ? 'locked' : ''} ${alert.type === 'incognito' ? 'incognito-alert' : ''}`}
              key={`${alert.type}-${index}`}
            >
              <span className={alert.type === 'incognito' ? 'incognito-alert-text' : undefined}>{alert.text}</span>
              {alert.type === 'incognito' && (
                <button type="button" className="btn btn-small btn-secondary incognito-alert-btn" onClick={openIncognitoSettings}>
                  Enable
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="current-site">
        <div className="site-row">
          <span className="site-label">Current site</span>
          <span className={`site-domain ${currentSiteBlocked ? 'blocked' : ''}`}>{currentDomain || '-'}</span>
        </div>
        {siteAction && (
          <div className="site-actions">
            <button type="button" className={siteAction.className} onClick={handleSiteAction}>
              {siteAction.label}
            </button>
          </div>
        )}
      </div>

      {sessions.length > 0 && (
        <div className="sessions-row">
          <span className="sessions-label">{sessionSummary}</span>
          <button type="button" className="btn btn-tiny" onClick={endSessions}>
            {sessions.length > 1 ? 'End all' : 'End'}
          </button>
        </div>
      )}

      <div className="focus-section">
        <div className="focus-label">Focus session</div>
        {focusSession?.active ? (
          <div className="focus-active">
            <div className="focus-timer-row">
              <span className={`focus-phase-badge ${focusSession.phase}`}>
                {{ work: 'Focus', break: 'Break', longBreak: 'Long Break' }[focusSession.phase] || 'Focus'}
              </span>
              <span className="focus-time">{formatFocusTime(focusSession, now)}</span>
            </div>
            <div className="focus-actions">
              {focusSession.phase !== 'work' && (
                <button className="btn btn-secondary" type="button" onClick={skipFocusBreak}>Skip</button>
              )}
              <button className="btn btn-danger" type="button" onClick={stopFocusSession}>Stop</button>
            </div>
          </div>
        ) : (
          <div className="focus-start">
            <FocusPresetToggleGroup
              presets={presets}
              selectedType={selectedPresetType}
              onSelect={setSelectedPresetType}
            />
            <div className="focus-start-row">
              <button className="btn btn-primary" type="button" onClick={startFocusSession}>Start</button>
            </div>
          </div>
        )}
      </div>

      <footer className="footer">
        <PopupFooter onOpenSettings={openOptions} onOpenStats={openStats} />
      </footer>
    </div>
  );
}

export function renderPopupApp(container) {
  createRoot(container).render(<PopupApp />);
}
