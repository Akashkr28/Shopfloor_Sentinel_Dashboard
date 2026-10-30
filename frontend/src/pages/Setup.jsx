import { useState } from 'react';
import { api } from '../api.js';
import { LANGS } from '../i18n.js';
import { useLiveRefresh } from '../live.js';
import { useFetch, useSession } from '../session.jsx';

function MachineRow({ m, onSaved }) {
  const [edit, setEdit] = useState(null);
  const save = async () => {
    await api(`/machines/${m.id}`, { method: 'PUT', body: edit });
    setEdit(null);
    onSaved();
  };
  if (edit) {
    return (
      <tr className="no-click">
        <td><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></td>
        <td><input value={edit.location || ''} onChange={(e) => setEdit({ ...edit, location: e.target.value })} /></td>
        <td><input value={edit.identifier} onChange={(e) => setEdit({ ...edit, identifier: e.target.value })} className="mono" /></td>
        <td>
          <label className="inline"><input type="checkbox" checked={edit.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} /> active</label>
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

export default function Setup() {
  const { user } = useSession();
  const machines = useFetch('/machines');
  const users = useFetch('/users');
  const [nm, setNm] = useState({ name: '', location: '', identifier: '' });
  const [nu, setNu] = useState({ username: '', name: '', password: '', role: 'OPERATOR', phoneNumber: '', preferredLanguage: 'hi' });
  const [msg, setMsg] = useState({});
  useLiveRefresh(['machines', 'alert', 'alert-updated'], machines.reload);

  const addMachine = async (e) => {
    e.preventDefault();
    try {
      await api('/machines', { method: 'POST', body: nm });
      setNm({ name: '', location: '', identifier: '' });
      setMsg({ m: null });
      machines.reload();
    } catch (err) {
      setMsg({ m: err.message });
    }
  };
  const addUser = async (e) => {
    e.preventDefault();
    try {
      await api('/users', { method: 'POST', body: { ...nu, phoneNumber: nu.phoneNumber || null } });
      setNu({ ...nu, username: '', name: '', password: '', phoneNumber: '' });
      setMsg({ u: null });
      users.reload();
    } catch (err) {
      setMsg({ u: err.message });
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Machines & users</h1>
          <p className="muted">Map gateway identifiers to machines and decide who sees what.</p>
        </div>
      </div>

      <div className="panel">
        <h3>Machines / zones</h3>
        <p className="muted small">The identifier must match what the gateway sends as <span className="mono">machineIdentifier</span>. Unknown identifiers show up here as “Unmapped” – rename them.</p>
        <div className="table-wrap">
          <table className="timeline">
            <thead>
              <tr><th>Name</th><th>Location</th><th>Gateway identifier</th><th>Open alerts</th><th /></tr>
            </thead>
            <tbody>
              {(machines.data || []).map((m) => <MachineRow key={m.id} m={m} onSaved={machines.reload} />)}
            </tbody>
          </table>
        </div>
        <form className="form-row" onSubmit={addMachine}>
          <input placeholder="Name (e.g. Press Line 3)" value={nm.name} onChange={(e) => setNm({ ...nm, name: e.target.value })} required />
          <input placeholder="Location" value={nm.location} onChange={(e) => setNm({ ...nm, location: e.target.value })} />
          <input placeholder="IDENTIFIER" className="mono" value={nm.identifier} onChange={(e) => setNm({ ...nm, identifier: e.target.value.toUpperCase() })} required />
          <button className="btn btn-primary">Add machine</button>
        </form>
        {msg.m && <p className="error">{msg.m}</p>}
      </div>

      <div className="panel">
        <h3>Users & roles</h3>
        <div className="table-wrap">
          <table className="timeline">
            <thead>
              <tr><th>Name</th><th>Username</th><th>Role</th><th>Language</th><th>Phone (WhatsApp/SMS)</th></tr>
            </thead>
            <tbody>
              {(users.data || []).map((u) => (
                <tr key={u.id} className="no-click">
                  <td>{u.name}</td>
                  <td className="mono">{u.username}</td>
                  <td><span className="pill status">{u.role.toLowerCase()}</span></td>
                  <td>{LANGS.find((l) => l.code === u.preferredLanguage)?.label}</td>
                  <td className="mono">{u.phoneNumber || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="form-row" onSubmit={addUser}>
          <input placeholder="Full name" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} required />
          <input placeholder="username" value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} required autoCapitalize="none" />
          <input placeholder="password" type="password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} required autoComplete="new-password" />
          <select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}>
            {['OPERATOR', 'SUPERVISOR', 'ENGINEER', ...(user.role === 'OWNER' ? ['OWNER'] : [])].map((r) => <option key={r}>{r}</option>)}
          </select>
          <select value={nu.preferredLanguage} onChange={(e) => setNu({ ...nu, preferredLanguage: e.target.value })}>
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
          <input placeholder="+91… (owners)" value={nu.phoneNumber} onChange={(e) => setNu({ ...nu, phoneNumber: e.target.value })} />
          <button className="btn btn-primary">Add user</button>
        </form>
        {msg.u && <p className="error">{msg.u}</p>}
      </div>
    </div>
  );
}
