import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import AuthShell from '../components/AuthShell.jsx';
import { LANGS } from '../i18n.js';
import { useSession } from '../session.jsx';

/** First run: create the factory and its Owner, using the one-time code from the server log. */
export default function SetupFactory() {
  const { adopt } = useSession();
  const nav = useNavigate();
  const [f, setF] = useState({ setupCode: '', factoryName: '', name: '', username: '', password: '', confirm: '', phoneNumber: '', preferredLanguage: 'en' });
  const [state, setState] = useState({});
  const set = (k) => (e) => setF({ ...f, [k]: k === 'username' ? e.target.value.toLowerCase() : e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (f.password !== f.confirm) return setState({ error: 'The passwords do not match' });
    setState({ busy: true });
    try {
      const { confirm, ...body } = f;
      const r = await api('/setup', { method: 'POST', body: { ...body, phoneNumber: body.phoneNumber || null } });
      adopt(r.user);
      nav('/owner', { replace: true });
    } catch (err) {
      setState({ error: err.message });
    }
  };

  return (
    <AuthShell>
      <form className="login-card wide" onSubmit={submit}>
        <h1>Set up your factory</h1>
        <p className="muted">Create the Owner account. Everyone else joins later through invite links you send.</p>

        <label>
          Setup code
          <input value={f.setupCode} onChange={set('setupCode')} className="mono" placeholder="XXXX-XXXX-XXXX" autoComplete="off" required />
          <span className="field-hint">Printed in the server log when Sentinel starts – e.g. <span className="mono">docker compose logs sentinel</span></span>
        </label>
        <label>
          Factory name
          <input value={f.factoryName} onChange={set('factoryName')} placeholder="e.g. Patil Auto Components, Chakan" required maxLength={80} />
        </label>
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
            WhatsApp / mobile (for red alerts)
            <input value={f.phoneNumber} onChange={set('phoneNumber')} placeholder="+91XXXXXXXXXX" pattern="\+[1-9][0-9]{7,14}" title="International format, e.g. +919812345678" />
          </label>
          <label>
            Language
            <select value={f.preferredLanguage} onChange={set('preferredLanguage')}>
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </label>
        </div>
        {state.error && <p className="error small">{state.error}</p>}
        <button className="btn btn-primary btn-lg" disabled={state.busy}>
          {state.busy ? 'Creating…' : 'Create factory'}
        </button>
      </form>
    </AuthShell>
  );
}
