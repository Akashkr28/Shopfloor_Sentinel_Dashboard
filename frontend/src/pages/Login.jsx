import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AuthShell from '../components/AuthShell.jsx';
import { HOME_BY_ROLE, useSession } from '../session.jsx';

// One-tap accounts – shown only when the server runs with demo data (SEED_DEMO=true).
const DEMO = [
  ['owner', 'Owner', 'Suresh Patil', 'SP'],
  ['engineer', 'Engineer', 'Ramesh Kumar', 'RK'],
  ['supervisor', 'Supervisor', 'தமிழ்', 'LI'],
  ['operator', 'Operator', 'हिन्दी', 'RY'],
  ['operator2', 'Operator', 'मराठी', 'GS'],
];

export default function Login() {
  const { login, meta } = useSession();
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
    <AuthShell factoryName={meta?.factoryName}>
      <form
        className="login-card"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h1>Welcome back</h1>
        <p className="muted">Sign in to {meta?.factoryName || 'your factory dashboard'}.</p>
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" placeholder="e.g. ramesh" required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="••••••••" required />
        </label>
        {error && <p className="error small">{error}</p>}
        <button className="btn btn-primary btn-lg" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        {meta?.demo ? (
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
        ) : (
          <p className="muted small auth-hint">No account yet? Ask your factory owner or engineer for an invite link.</p>
        )}
      </form>
    </AuthShell>
  );
}
