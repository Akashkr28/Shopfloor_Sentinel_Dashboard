import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { HOME_BY_ROLE, useSession } from '../session.jsx';

const DEMO = [
  ['owner', 'Owner', 'Suresh Patil', 'SP'],
  ['engineer', 'Engineer', 'Ramesh Kumar', 'RK'],
  ['supervisor', 'Supervisor', 'தமிழ்', 'LI'],
  ['operator', 'Operator', 'हिन्दी', 'RY'],
  ['operator2', 'Operator', 'मराठी', 'GS'],
];

const HIGHLIGHTS = [
  ['RED', 'usb', 'USB drive plugged into machine', 'Press Line 1 · just now'],
  ['AMBER', 'network', 'नेटवर्क में असामान्य गतिविधि', 'Packaging HMI A · 4 min ago'],
  ['GREEN', 'shield', 'வழக்கமான பாதுகாப்பு சோதனை சரி', 'CNC Cell 3 · 12 min ago'],
];

export default function Login() {
  const { login } = useSession();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (u = username, p = password) => {
    setBusy(true);
    setError('');
    try {
      const user = await login(u, p);
      nav(HOME_BY_ROLE[user.role], { replace: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <section className="login-hero">
        <div>
          <div className="brand">
            <span className="brand-mark">
              <img src="/favicon.svg" alt="" width="22" height="22" />
            </span>
            <span className="brand-text">
              Shopfloor <b>Sentinel</b>
            </span>
          </div>
          <h2>Cyber health your whole shopfloor understands.</h2>
          <p>Passive monitoring, traffic-light alerts and 3-step scripts in Hindi, Marathi and Tamil – with WhatsApp updates for owners.</p>
          <div className="hero-cards" aria-hidden="true">
            {HIGHLIGHTS.map(([sev, icon, title, meta]) => (
              <div className="hero-card" key={title}>
                <span className={`hc-icon sev-bg-${sev}`}>
                  <Icon name={icon} size={20} />
                </span>
                <div>
                  <b>{title}</b>
                  <span>{meta}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="hero-foot">Read-only gateway · never sends commands to PLCs or HMIs</div>
      </section>

      <section className="login-side">
        <form
          className="login-card"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <h1>Welcome back</h1>
          <p className="muted">Sign in to your factory dashboard.</p>
          <label>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" placeholder="e.g. engineer" required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="••••••••" required />
          </label>
          {error && <p className="error small">{error}</p>}
          <button className="btn btn-primary btn-lg" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <div className="demo-logins">
            <div className="demo-title">Demo accounts · password sentinel123</div>
            <div className="demo-grid">
              {DEMO.map(([u, role, sub, ini]) => (
                <button type="button" key={u} className="demo-btn" disabled={busy} onClick={() => submit(u, 'sentinel123')}>
                  <span className="avatar">{ini}</span>
                  <span>
                    <b>{role}</b>
                    <span>{sub}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
