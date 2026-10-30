import { useRef, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { LANGS, t } from '../i18n.js';
import { LiveContext, useLiveRefresh } from '../live.js';
import { isManager, useFetch, useLive, useSession } from '../session.jsx';
import { useTheme } from '../theme.js';
import AccountDialog from './AccountDialog.jsx';
import Icon from './Icon.jsx';

// [path, label, short label for the phone tab bar, icon]
const NAV = {
  OWNER: [
    ['/owner', 'Today', 'Today', 'home'],
    ['/engineer', 'All alerts', 'Alerts', 'bell'],
    ['/drills', 'Drills', 'Drills', 'target'],
    ['/setup', 'Setup', 'Setup', 'settings'],
  ],
  ENGINEER: [
    ['/engineer', 'Dashboard', 'Home', 'dashboard'],
    ['/templates', 'Alert templates', 'Templates', 'template'],
    ['/drills', 'Drill mode', 'Drills', 'target'],
    ['/setup', 'Setup', 'Setup', 'settings'],
    ['/owner', 'Owner view', 'Owner', 'chart'],
    ['/floor', 'Operator screen', 'Floor', 'shield'],
  ],
  SUPERVISOR: [
    ['/floor', 'Alerts', 'Alerts', 'bell'],
    ['/drills', 'Drill mode', 'Drills', 'target'],
  ],
  OPERATOR: [['/floor', 'Alerts', 'Alerts', 'bell']],
};

const initials = (name) => name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <img src="/favicon.svg" alt="" width="22" height="22" />
      </span>
      <span className="brand-text">
        Shopfloor <b>Sentinel</b>
      </span>
    </div>
  );
}

function Controls({ lang, connected, compact }) {
  const { setLanguage, logout } = useSession();
  const [theme, toggleTheme] = useTheme();
  return (
    <div className={`controls ${compact ? 'compact' : ''}`}>
      <span className={`live-chip ${connected ? 'on' : ''}`} title={connected ? 'Live updates on' : 'Reconnecting'}>
        <span className="live-dot" />
        <span className="live-text">{connected ? t(lang, 'live') : t(lang, 'offline')}</span>
      </span>
      <label className="lang-select" title="Language">
        <Icon name="globe" size={16} />
        <select aria-label="Language" value={lang} onChange={(e) => setLanguage(e.target.value)}>
          {LANGS.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      <button className="icon-btn ghost" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title="Theme">
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
      </button>
      <button className="icon-btn ghost" onClick={logout} aria-label={t(lang, 'logout')} title={t(lang, 'logout')}>
        <Icon name="logout" size={18} />
      </button>
    </div>
  );
}

/** Monitoring is blind while a gateway is down – say so on every manager screen. */
function GatewayBanner() {
  const status = useFetch('/gateway/status');
  useLiveRefresh(['gateway'], status.reload);
  const offline = (status.data?.gateways || []).filter((g) => !g.online);
  if (!offline.length) return null;
  return (
    <div className="gw-banner" role="alert">
      <Icon name="wifi" size={18} />
      <span>
        <b>Gateway offline:</b> {offline.map((g) => g.id).join(', ')} – security monitoring is paused. Check the Pi's power and network cable.
      </span>
      <Link to="/setup?tab=gateways">Details</Link>
    </div>
  );
}

export default function Layout() {
  const { user } = useSession();
  const subscribers = useRef(new Set());
  const connected = useLive((type, payload) => subscribers.current.forEach((fn) => fn(type, payload)));
  const lang = user.preferredLanguage;
  const nav = NAV[user.role];
  // Shopfloor roles get a full-width screen (TV / phone); office roles get a sidebar.
  const isFloor = user.role === 'OPERATOR' || user.role === 'SUPERVISOR';
  const [account, setAccount] = useState(false);
  const dialog = account && <AccountDialog onClose={() => setAccount(false)} />;

  if (isFloor) {
    return (
      <LiveContext.Provider value={subscribers.current}>
        <div className="shell floor-shell">
          <header className="floor-bar">
            <Brand />
            {nav.length > 1 && (
              <nav className="floor-tabs">
                {nav.map(([to, label, , icon]) => (
                  <NavLink key={to} to={to}>
                    <Icon name={icon} size={18} /> {label}
                  </NavLink>
                ))}
              </nav>
            )}
            <button className="floor-user" onClick={() => setAccount(true)} title="Your account">
              <span className="avatar">{initials(user.name)}</span>
              <span className="who">{user.name}</span>
            </button>
            <Controls lang={lang} connected={connected} compact />
          </header>
          <main className="content">
            <Outlet />
          </main>
          {dialog}
        </div>
      </LiveContext.Provider>
    );
  }

  return (
    <LiveContext.Provider value={subscribers.current}>
      <div className="shell app-shell">
        <aside className="sidebar">
          <Brand />
          <nav className="side-nav">
            <span className="side-label">Workspace</span>
            {nav.map(([to, label, , icon]) => (
              <NavLink key={to} to={to}>
                <Icon name={icon} size={19} />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="side-foot">
            <button className="user-card" onClick={() => setAccount(true)} title="Your account">
              <span className="avatar">{initials(user.name)}</span>
              <span className="user-meta">
                <span className="who">{user.name}</span>
                <span className="role">{user.role.toLowerCase()}</span>
              </span>
            </button>
            <Controls lang={lang} connected={connected} />
          </div>
        </aside>

        <header className="mobile-bar">
          <Brand />
          <Controls lang={lang} connected={connected} compact />
        </header>

        <main className="content">
          {isManager(user) && <GatewayBanner />}
          <Outlet />
        </main>
        {dialog}

        <nav className="tab-bar">
          {nav.slice(0, 5).map(([to, , short, icon]) => (
            <NavLink key={to} to={to}>
              <Icon name={icon} size={22} />
              <span>{short}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </LiveContext.Provider>
  );
}
