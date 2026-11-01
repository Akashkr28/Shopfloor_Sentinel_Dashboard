import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import AuthShell from '../components/AuthShell.jsx';
import { LANGS } from '../i18n.js';
import { HOME_BY_ROLE, useSession } from '../session.jsx';

const ROLE_TEXT = {
  OWNER: 'Owner – full overview and WhatsApp summaries',
  ENGINEER: 'Engineer – alerts, templates, drills and setup',
  SUPERVISOR: 'Supervisor – shopfloor alerts and drills',
  OPERATOR: 'Operator – shopfloor alert screen',
};

/** Accept an invite link: the role comes from the invite; the person picks their own username and password. */
export default function JoinPage() {
  const { token } = useParams();
  const { user, adopt, logout } = useSession();
  const nav = useNavigate();
  const [invite, setInvite] = useState(null);
  const [lookupError, setLookupError] = useState('');
  const [f, setF] = useState({ name: '', username: '', password: '', confirm: '', phoneNumber: '', preferredLanguage: 'hi' });
  const [state, setState] = useState({});

  useEffect(() => {
    api(`/join/${encodeURIComponent(token)}`)
      .then((i) => {
        setInvite(i);
        setF((x) => ({ ...x, name: i.name || '', phoneNumber: i.phoneNumber || '', preferredLanguage: i.preferredLanguage }));
      })
      .catch((e) => setLookupError(e.message));
  }, [token]);

  const set = (k) => (e) => setF({ ...f, [k]: k === 'username' ? e.target.value.toLowerCase() : e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (f.password !== f.confirm) return setState({ error: 'The passwords do not match' });
    setState({ busy: true });
    try {
      const { confirm, ...body } = f;
      const r = await api(`/join/${encodeURIComponent(token)}`, { method: 'POST', body: { ...body, phoneNumber: body.phoneNumber || null } });
      adopt(r.user);
      nav(HOME_BY_ROLE[r.user.role], { replace: true });
    } catch (err) {
      setState({ error: err.message });
    }
  };

  let body;
  if (lookupError) {
    body = (
      <div className="login-card">
        <h1>Invite link</h1>
        <p className="error">{lookupError}</p>
        <button className="btn" onClick={() => nav('/login')}>Go to sign in</button>
      </div>
    );
  } else if (!invite) {
    body = <div className="login-card muted">Checking your invite…</div>;
  } else if (user) {
    body = (
      <div className="login-card">
        <h1>You're already signed in</h1>
        <p className="muted">You are signed in as {user.name}. Sign out first to create the new account from this invite.</p>
        <button className="btn btn-primary" onClick={logout}>Sign out</button>
      </div>
    );
  } else {
    body = (
      <form className="login-card wide" onSubmit={submit}>
        <h1>Join {invite.factoryName || 'your factory'}</h1>
        <p className="muted">
          You've been invited as <b>{ROLE_TEXT[invite.role]}</b>. Choose a username and password to finish.
        </p>
        <div className="grid-2">
          <label>
            Your name
            <input value={f.name} onChange={set('name')} autoComplete="name" required maxLength={80} />
          </label>
          <label>
            Username
            <input value={f.username} onChange={set('username')} autoComplete="username" autoCapitalize="none" pattern="[a-z0-9._\-]{3,32}" title="3–32 characters: a–z, 0–9, . _ -" required />
          </label>
          <label>
            Password (8+ characters)
            <input type="password" value={f.password} onChange={set('password')} autoComplete="new-password" minLength={8} required />
          </label>
          <label>
            Repeat password
            <input type="password" value={f.confirm} onChange={set('confirm')} autoComplete="new-password" minLength={8} required />
          </label>
          <label>
            Language for alerts
            <select value={f.preferredLanguage} onChange={set('preferredLanguage')}>
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </label>
          <label>
            WhatsApp / mobile {invite.role === 'OWNER' || invite.role === 'ENGINEER' ? '(for alerts)' : '(optional)'}
            <input value={f.phoneNumber} onChange={set('phoneNumber')} placeholder="+91XXXXXXXXXX" pattern="\+[1-9][0-9]{7,14}" title="International format, e.g. +919812345678" />
          </label>
        </div>
        {state.error && <p className="error small">{state.error}</p>}
        <button className="btn btn-primary btn-lg" disabled={state.busy}>
          {state.busy ? 'Creating account…' : 'Create my account'}
        </button>
        <p className="muted small auth-hint">This link works once and expires {new Date(invite.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}.</p>
      </form>
    );
  }
  return <AuthShell factoryName={invite?.factoryName}>{body}</AuthShell>;
}
