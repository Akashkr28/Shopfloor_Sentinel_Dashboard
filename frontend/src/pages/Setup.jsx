import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import { fmtDateTime, LANGS, timeAgo } from '../i18n.js';
import { useLiveRefresh } from '../live.js';
import { useFetch, useSession } from '../session.jsx';

const ROLES = ['OPERATOR', 'SUPERVISOR', 'ENGINEER', 'OWNER'];
const TABS = [
  ['machines', 'Machines', 'dashboard'],
  ['users', 'Users', 'settings'],
  ['gateways', 'Gateways', 'wifi'],
  ['notifications', 'Notifications', 'bell'],
  ['audit', 'Audit log', 'template'],
];

// ---------------------------------------------------------------- machines
function MachineRow({ m, onSaved }) {
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState('');
  const save = async () => {
    try {
      await api(`/machines/${m.id}`, { method: 'PUT', body: edit });
      setEdit(null);
      setError('');
      onSaved();
    } catch (e) {
      setError(e.message);
    }
  };
  if (edit) {
    return (
      <tr className="no-click">
        <td><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} aria-label="Name" /></td>
        <td><input value={edit.location || ''} onChange={(e) => setEdit({ ...edit, location: e.target.value })} aria-label="Location" /></td>
        <td><input value={edit.identifier} onChange={(e) => setEdit({ ...edit, identifier: e.target.value.toUpperCase() })} className="mono" aria-label="Identifier" /></td>
        <td>
          <label className="inline"><input type="checkbox" checked={edit.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} /> active</label>
          {error && <div className="error small">{error}</div>}
        </td>
        <td className="row gap-sm">
          <button className="btn btn-primary" onClick={save}>Save</button>
          <button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button>
        </td>
      </tr>
    );
  }
  return (
    <tr className={`no-click ${m.isActive ? '' : 'muted'}`}>
      <td>
        {m.name} {m.name.startsWith('Unmapped') && <span className="pill sev-AMBER">needs setup</span>}
      </td>
      <td>{m.location}</td>
      <td className="mono">{m.identifier}</td>
      <td>
        {m.openRed > 0 && <span className="pill sev-RED">{m.openRed} red</span>} {m.openAmber > 0 && <span className="pill sev-AMBER">{m.openAmber} amber</span>}
        {!m.openRed && !m.openAmber && <span className="pill sev-GREEN">ok</span>}
      </td>
      <td>
        <button className="btn btn-ghost" onClick={() => setEdit({ name: m.name, location: m.location, identifier: m.identifier, isActive: !!m.isActive })}>
          Edit
        </button>
      </td>
    </tr>
  );
}

function MachinesPanel() {
  const machines = useFetch('/machines');
  const [nm, setNm] = useState({ name: '', location: '', identifier: '' });
  const [error, setError] = useState('');
  useLiveRefresh(['machines', 'alert', 'alert-updated'], machines.reload);
  const add = async (e) => {
    e.preventDefault();
    try {
      await api('/machines', { method: 'POST', body: nm });
      setNm({ name: '', location: '', identifier: '' });
      setError('');
      machines.reload();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <div className="panel">
      <h3>Machines / zones</h3>
      <p className="muted small">
        The identifier must match what the gateway sends as <span className="mono">machineIdentifier</span> (in the gateway's <span className="mono">config.json → network.assets</span>). Unknown identifiers appear here as “Unmapped” – rename them.
      </p>
      <div className="table-wrap">
        <table className="timeline">
          <thead>
            <tr><th>Name</th><th>Location</th><th>Gateway identifier</th><th>Open alerts</th><th /></tr>
          </thead>
          <tbody>{(machines.data || []).map((m) => <MachineRow key={m.id} m={m} onSaved={machines.reload} />)}</tbody>
        </table>
      </div>
      <form className="form-row" onSubmit={add}>
        <input placeholder="Name (e.g. Press Line 3)" value={nm.name} onChange={(e) => setNm({ ...nm, name: e.target.value })} required />
        <input placeholder="Location" value={nm.location} onChange={(e) => setNm({ ...nm, location: e.target.value })} />
        <input placeholder="IDENTIFIER" className="mono" value={nm.identifier} onChange={(e) => setNm({ ...nm, identifier: e.target.value.toUpperCase() })} required />
        <button className="btn btn-primary">Add machine</button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- users
function ResetPassword({ target, onClose }) {
  const [pw, setPw] = useState('');
  const [state, setState] = useState({});
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api(`/users/${target.id}/password`, { method: 'POST', body: { newPassword: pw } });
      setState({ done: true });
    } catch (err) {
      setState({ error: err.message });
    }
  };
  return (
    <Modal title={`Reset password – ${target.name}`} onClose={onClose}>
      {state.done ? (
        <>
          <p className="ok">Password reset. {target.name} has been signed out everywhere; give them the new password in person.</p>
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </>
      ) : (
        <form onSubmit={submit}>
          <label>
            New password (8+ characters)
            <input type="text" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} required autoComplete="off" />
          </label>
          {state.error && <p className="error small">{state.error}</p>}
          <button className="btn btn-primary">Reset password</button>
        </form>
      )}
    </Modal>
  );
}

function UserRow({ u, me, onSaved, onReset }) {
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState('');
  const canManage = me.role === 'OWNER' || u.role !== 'OWNER';
  const save = async (patch) => {
    try {
      await api(`/users/${u.id}`, { method: 'PATCH', body: patch });
      setEdit(null);
      setError('');
      onSaved();
    } catch (e) {
      setError(e.message);
    }
  };
  if (edit) {
    return (
      <tr className="no-click">
        <td><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} aria-label="Name" /></td>
        <td className="mono">{u.username}</td>
        <td>
          <select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })} disabled={u.id === me.id} aria-label="Role">
            {ROLES.filter((r) => r !== 'OWNER' || me.role === 'OWNER').map((r) => <option key={r}>{r}</option>)}
          </select>
        </td>
        <td>
          <select value={edit.preferredLanguage} onChange={(e) => setEdit({ ...edit, preferredLanguage: e.target.value })} aria-label="Language">
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </td>
        <td>
          <input value={edit.phoneNumber || ''} onChange={(e) => setEdit({ ...edit, phoneNumber: e.target.value || null })} placeholder="+91…" className="mono" aria-label="Phone" />
          {error && <div className="error small">{error}</div>}
        </td>
        <td className="row gap-sm">
          <button className="btn btn-primary" onClick={() => save(edit)}>Save</button>
          <button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button>
        </td>
      </tr>
    );
  }
  return (
    <tr className={`no-click ${u.isActive ? '' : 'muted'}`}>
      <td>
        {u.name} {!u.isActive && <span className="pill status">disabled</span>}
        {error && <div className="error small">{error}</div>}
      </td>
      <td className="mono">{u.username}</td>
      <td><span className="pill status">{u.role.toLowerCase()}</span></td>
      <td>{LANGS.find((l) => l.code === u.preferredLanguage)?.label}</td>
      <td className="mono">{u.phoneNumber || '–'}</td>
      <td>
        {canManage && (
          <span className="row gap-sm">
            <button className="btn btn-ghost" onClick={() => setEdit({ name: u.name, role: u.role, preferredLanguage: u.preferredLanguage, phoneNumber: u.phoneNumber })}>Edit</button>
            <button className="btn btn-ghost" onClick={() => onReset(u)}>Password</button>
            {u.id !== me.id && (
              <button className="btn btn-ghost" onClick={() => save({ isActive: !u.isActive })}>{u.isActive ? 'Disable' : 'Enable'}</button>
            )}
          </span>
        )}
      </td>
    </tr>
  );
}

function UsersPanel() {
  const { user } = useSession();
  const users = useFetch('/users');
  const [nu, setNu] = useState({ username: '', name: '', password: '', role: 'OPERATOR', phoneNumber: '', preferredLanguage: 'hi' });
  const [error, setError] = useState('');
  const [resetFor, setResetFor] = useState(null);
  const add = async (e) => {
    e.preventDefault();
    try {
      await api('/users', { method: 'POST', body: { ...nu, phoneNumber: nu.phoneNumber || null } });
      setNu({ ...nu, username: '', name: '', password: '', phoneNumber: '' });
      setError('');
      users.reload();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <div className="panel">
      <h3>Users & roles</h3>
      <p className="muted small">Owners and engineers with a phone number receive WhatsApp/SMS: owners get red alerts and the daily summary, engineers get escalations and gateway-offline warnings. Disabled users are signed out immediately.</p>
      <div className="table-wrap">
        <table className="timeline">
          <thead>
            <tr><th>Name</th><th>Username</th><th>Role</th><th>Language</th><th>Phone (WhatsApp/SMS)</th><th /></tr>
          </thead>
          <tbody>
            {(users.data || []).map((u) => <UserRow key={u.id} u={u} me={user} onSaved={users.reload} onReset={setResetFor} />)}
          </tbody>
        </table>
      </div>
      <form className="form-row" onSubmit={add}>
        <input placeholder="Full name" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} required />
        <input placeholder="username" value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value.toLowerCase() })} required autoCapitalize="none" />
        <input placeholder="password (8+)" type="password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} required minLength={8} autoComplete="new-password" />
        <select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })} aria-label="Role">
          {ROLES.filter((r) => r !== 'OWNER' || user.role === 'OWNER').map((r) => <option key={r}>{r}</option>)}
        </select>
        <select value={nu.preferredLanguage} onChange={(e) => setNu({ ...nu, preferredLanguage: e.target.value })} aria-label="Language">
          {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
        <input placeholder="+91… (owners, engineers)" value={nu.phoneNumber} onChange={(e) => setNu({ ...nu, phoneNumber: e.target.value })} />
        <button className="btn btn-primary">Add user</button>
      </form>
      {error && <p className="error">{error}</p>}
      {resetFor && <ResetPassword target={resetFor} onClose={() => setResetFor(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- gateways
function GatewaysPanel() {
  const status = useFetch('/gateway/status');
  useLiveRefresh(['gateway'], status.reload);
  const list = status.data?.gateways || [];
  return (
    <div className="panel">
      <h3>Gateways</h3>
      <p className="muted small">
        Each Raspberry Pi / PC gateway sends a heartbeat every minute. If one is silent for {status.data?.offlineAfterMinutes ?? 10} minutes, owners and engineers get a WhatsApp/SMS – monitoring is blind until it is back.
      </p>
      {list.length === 0 ? (
        <div className="empty-state">
          <Icon name="wifi" size={28} />
          No gateway has connected yet. Start <span className="mono">net_monitor.py</span> or <span className="mono">log_monitor.py</span> on the Pi.
        </div>
      ) : (
        <div className="gw-grid">
          {list.map((g) => (
            <div key={g.id} className={`gw-card ${g.online ? 'on' : 'off'}`}>
              <div className="row gap-sm">
                <span className={`pill ${g.online ? 'sev-GREEN' : 'sev-RED'}`}>{g.online ? 'online' : 'offline'}</span>
                <strong>{g.id}</strong>
              </div>
              <div className="muted small">
                Last seen {timeAgo(g.lastSeenAt)} · {g.hostname || 'unknown host'} · v{g.version || '?'} · {g.ip}
              </div>
              <div className="row gap-sm wrap">
                {g.monitors.map((m) => <span key={m} className="pill status">{m}</span>)}
              </div>
              {g.stats && (
                <div className="gw-stats">
                  {Object.entries(g.stats).map(([k, v]) => (
                    <span key={k}>
                      <b>{String(v)}</b> {k.replace(/([A-Z])/g, ' $1').toLowerCase()}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- notifications
const TYPE_LABEL = { RED_ALERT: 'Red alert', DAILY_SUMMARY: 'Daily summary', ESCALATION: 'Escalation', RESOLVED_UPDATE: 'Handled update', GATEWAY_OFFLINE: 'Gateway offline' };

function NotificationsPanel() {
  const cfg = useFetch('/notifications/config');
  const users = useFetch('/users');
  const [target, setTarget] = useState('');
  const [result, setResult] = useState(null);
  const c = cfg.data;
  const withPhone = (users.data || []).filter((u) => u.phoneNumber && u.isActive);
  const test = async () => {
    setResult({ busy: true });
    try {
      const r = await api('/notifications/test', { method: 'POST', body: target ? { userId: Number(target) } : {} });
      setResult({ items: r.results });
    } catch (e) {
      setResult({ error: e.message });
    }
  };
  if (!c) return <div className="panel muted">Loading…</div>;
  return (
    <div className="two-col">
      <div className="panel">
        <h3>Messaging provider</h3>
        <div className="kv">
          <span>Provider</span>
          <b className="mono">{c.provider}</b>
          <span>Channel</span>
          <b>{c.channel.toLowerCase()}{c.smsFallback ? ' (SMS fallback on)' : ''}</b>
          <span>Status</span>
          <b className={c.ready ? 'ok' : 'error'}>{c.ready ? (c.provider === 'mock' ? 'Demo mode – messages print in the server log' : 'Ready') : 'Not configured'}</b>
          <span>Recipients</span>
          <b>{c.recipients.owners} owner(s), {c.recipients.engineers} engineer(s) with a phone</b>
        </div>
        {c.missing.length > 0 && (
          <p className="error small">Missing in backend/.env: {c.missing.join(', ')}</p>
        )}
        {Object.keys(c.templates).length > 0 && (
          <>
            <p className="small muted">Approved WhatsApp templates (needed to message owners outside the 24-hour window):</p>
            <div className="row gap-sm wrap">
              {Object.entries(c.templates).map(([k, ok]) => (
                <span key={k} className={`pill ${ok ? 'sev-GREEN' : 'status'}`}>{TYPE_LABEL[k] || k}{ok ? '' : ' – free text'}</span>
              ))}
            </div>
          </>
        )}
        {c.webhooks ? (
          <p className="small muted">
            Delivery-status webhooks: <span className="mono">{c.webhooks.twilio}</span> (Twilio) · <span className="mono">{c.webhooks.whatsapp}</span> (WhatsApp)
          </p>
        ) : (
          c.provider !== 'mock' && <p className="small muted">Set PUBLIC_URL to receive delivered / read receipts.</p>
        )}
      </div>

      <div className="panel">
        <h3>Escalation rules</h3>
        <ul className="rules">
          <li><span className="pill sev-RED">Red</span> alert → owners at once (same alert on same machine at most once per 30 min)</li>
          <li><b>{c.escalation.unackMinutes} min</b> with nobody acknowledging → owners + engineers</li>
          <li><b>{c.escalation.unresolvedMinutes} min</b> still unresolved → owners again</li>
          <li>Marked handled → owners get a “✅ handled” update</li>
          <li>Gateway silent <b>{c.escalation.gatewayOfflineMinutes} min</b> → owners + engineers</li>
          <li>8 PM → daily summary to owners. Drills never message anyone.</li>
        </ul>
        <h3>Send a test message</h3>
        <div className="form-row">
          <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Recipient">
            <option value="">Me</option>
            {withPhone.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.phoneNumber})</option>)}
          </select>
          <button className="btn btn-primary" onClick={test} disabled={result?.busy}>
            <Icon name="send" size={16} /> Send test
          </button>
        </div>
        {result?.error && <p className="error small">{result.error}</p>}
        {result?.items?.map((r) => (
          <p key={r.id} className={`small ${r.status === 'SENT' ? 'ok' : r.status === 'FAILED' ? 'error' : ''}`}>
            {r.to}: {r.status.toLowerCase()}{r.deliveryStatus ? ` (${r.deliveryStatus})` : ''}{r.error ? ` – ${r.error}` : ''}
          </p>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- audit
const ACTIONS = ['', 'LOGIN', 'LOGIN_FAILED', 'LOGIN_BLOCKED', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'USER_CREATED', 'USER_UPDATED', 'USER_DISABLED', 'MACHINE_CREATED', 'MACHINE_UPDATED', 'TEMPLATE_CREATED', 'TEMPLATE_UPDATED', 'DRILL_STARTED', 'ALERT_RESOLVED', 'ALERTS_EXPORTED', 'NOTIFICATION_TEST'];
const RISKY = new Set(['LOGIN_FAILED', 'LOGIN_BLOCKED', 'PASSWORD_CHANGE_FAILED', 'USER_DISABLED', 'PASSWORD_RESET']);

function AuditPanel() {
  const [action, setAction] = useState('');
  const audit = useFetch(`/audit?limit=200${action ? `&action=${action}` : ''}`);
  return (
    <div className="panel">
      <div className="row gap-sm wrap" style={{ justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <h3 style={{ margin: 0 }}>Audit log</h3>
        <select value={action} onChange={(e) => setAction(e.target.value)} style={{ width: 'auto' }} aria-label="Filter by action">
          {ACTIONS.map((a) => <option key={a} value={a}>{a ? a.toLowerCase().replace(/_/g, ' ') : 'All actions'}</option>)}
        </select>
      </div>
      <p className="muted small">Who did what and when – logins, account changes, template edits, drills and exports. Share with your security consultant if something goes wrong.</p>
      <div className="table-wrap">
        <table className="timeline">
          <thead>
            <tr><th>Time</th><th>User</th><th>Action</th><th>Target</th><th>Details</th><th>IP</th></tr>
          </thead>
          <tbody>
            {(audit.data || []).map((a) => (
              <tr key={a.id} className="no-click">
                <td className="mono">{fmtDateTime(a.timestamp)}</td>
                <td>{a.username || '–'}</td>
                <td><span className={`pill ${RISKY.has(a.action) ? 'sev-AMBER' : 'status'}`}>{a.action.toLowerCase().replace(/_/g, ' ')}</span></td>
                <td className="mono small">{a.target || '–'}</td>
                <td className="small msg-cell" title={a.details ? JSON.stringify(a.details) : ''}>{a.details ? JSON.stringify(a.details) : '–'}</td>
                <td className="mono small">{a.ip || '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {audit.data?.length === 0 && <p className="muted pad">Nothing recorded yet.</p>}
      </div>
    </div>
  );
}

export default function Setup() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'machines';
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Setup</h1>
          <p className="muted">Machines, people, gateways, messaging and the audit trail.</p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map(([k, label, icon]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setParams({ tab: k })}>
            <Icon name={icon} size={16} /> {label}
          </button>
        ))}
      </div>
      {tab === 'machines' && <MachinesPanel />}
      {tab === 'users' && <UsersPanel />}
      {tab === 'gateways' && <GatewaysPanel />}
      {tab === 'notifications' && <NotificationsPanel />}
      {tab === 'audit' && <AuditPanel />}
    </div>
  );
}
