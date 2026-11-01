import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, download, qs } from '../api.js';
import AlertDetail from '../components/AlertDetail.jsx';
import Icon from '../components/Icon.jsx';
import { fmtDateTime, pickLoc } from '../i18n.js';
import { useLiveRefresh } from '../live.js';
import { useFetch, useSession } from '../session.jsx';

const SEV = ['RED', 'AMBER', 'GREEN'];

function Stat({ label, value, tone, sub }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <div className="stat-value">{value ?? '–'}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  );
}

function SimulatePanel({ machines, templates, onDone }) {
  const [machineId, setMachineId] = useState('');
  const [eventTypeKey, setType] = useState('USB_INSERT');
  const [msg, setMsg] = useState('');
  const fire = async () => {
    setMsg('');
    try {
      const a = await api('/simulate', { method: 'POST', body: { machineId: Number(machineId || machines[0]?.id), eventTypeKey } });
      setMsg(`Created #${a.id} (${a.severity})${a.severity === 'RED' ? ' – owner notified unless deduplicated' : ''}`);
      onDone();
    } catch (e) {
      setMsg(e.message);
    }
  };
  return (
    <div className="panel">
      <h3>
        <Icon name="power" size={18} /> Simulate event
      </h3>
      <p className="muted small">Same path as the Raspberry Pi gateway – use it to demo the full flow.</p>
      <div className="form-row">
        <select value={eventTypeKey} onChange={(e) => setType(e.target.value)}>
          {(templates || []).map((t) => (
            <option key={t.id} value={t.eventTypeKey}>
              {pickLoc(t.localizations, 'en').loc?.title || t.eventTypeKey}
            </option>
          ))}
        </select>
        <select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
          {(machines || []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" onClick={fire} disabled={!machines?.length}>
          Simulate
        </button>
      </div>
      {msg && <p className="small">{msg}</p>}
    </div>
  );
}

export default function EngineerView() {
  const { user, meta } = useSession();
  const [f, setF] = useState({ severity: '', machineId: '', status: '', isDrill: 'false', since: '' });
  const [openId, setOpenId] = useState(null);
  const sinceIso = f.since ? new Date(f.since).toISOString() : undefined;
  const alerts = useFetch(`/alerts${qs({ ...f, since: sinceIso, limit: 300 })}`);
  const stats = useFetch('/stats');
  const machines = useFetch('/machines');
  const templates = useFetch('/alert-templates');

  useLiveRefresh(['alert', 'alert-updated', 'notification'], () => {
    alerts.reload();
    stats.reload();
    machines.reload();
  });

  const s = stats.data;
  const maxMachine = Math.max(1, ...(s?.topMachines || []).map((m) => m.n));
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const exportCsv = () => download(`/alerts/export.csv${qs({ since: sinceIso })}`, 'sentinel-alerts.csv').catch((e) => alert(e.message));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{user.role === 'OWNER' ? 'All alerts' : 'Engineer dashboard'}</h1>
          <p className="muted">Every machine, every event – live from the gateway.</p>
        </div>
        <div className="row gap-sm wrap">
          {user.role === 'ENGINEER' && (
            <Link className="btn btn-primary" to="/drills">
              <Icon name="target" size={16} /> Start drill
            </Link>
          )}
          <button className="btn" onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      </div>

      <div className="stats">
        <Stat label="Red · last 24h" value={s?.counts.RED} tone="RED" />
        <Stat label="Amber · last 24h" value={s?.counts.AMBER} tone="AMBER" />
        <Stat label="Green · last 24h" value={s?.counts.GREEN} tone="GREEN" />
        <Stat label="Open, need action" value={s?.openNeedingAction} />
        <Stat label="Median time to first action" value={s?.medianResponseSeconds != null ? `${s.medianResponseSeconds}s` : '–'} sub="target < 60s" />
        <Stat label="Owner red messages · 24h" value={s?.redMessagesLast24h} sub="target ≤ 3 / day" />
      </div>

      <div className="two-col">
        <div className="panel">
          <h3>Machines with most alerts (24h)</h3>
          {s?.topMachines?.length ? (
            <ul className="bars">
              {s.topMachines.map((m) => (
                <li key={m.id}>
                  <span className="bars-label">{m.name}</span>
                  <span className="bars-track">
                    <span className="bars-fill red" style={{ width: `${(m.red / maxMachine) * 100}%` }} />
                    <span className="bars-fill amber" style={{ width: `${((m.n - m.red) / maxMachine) * 100}%` }} />
                  </span>
                  <span className="mono">{m.n}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No warnings in the last 24 hours.</p>
          )}
        </div>
        {meta?.simulate && <SimulatePanel machines={machines.data} templates={templates.data} onDone={alerts.reload} />}
      </div>

      <div className="panel">
        <div className="filters">
          <select value={f.severity} onChange={set('severity')} aria-label="Severity">
            <option value="">All severities</option>
            {SEV.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <select value={f.machineId} onChange={set('machineId')} aria-label="Machine">
            <option value="">All machines</option>
            {(machines.data || []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <select value={f.status} onChange={set('status')} aria-label="Status">
            <option value="">Any status</option>
            <option>OPEN</option>
            <option>ACKNOWLEDGED</option>
            <option>RESOLVED</option>
          </select>
          <select value={f.isDrill} onChange={set('isDrill')} aria-label="Drill">
            <option value="false">Real events</option>
            <option value="true">Drills only</option>
            <option value="">Real + drills</option>
          </select>
          <label className="inline">
            Since <input type="datetime-local" value={f.since} onChange={set('since')} />
          </label>
        </div>

        <div className="table-wrap">
          <table className="timeline">
            <thead>
              <tr>
                <th>Time</th>
                <th>Severity</th>
                <th>Event</th>
                <th>Machine</th>
                <th>Status</th>
                <th>Steps</th>
              </tr>
            </thead>
            <tbody>
              {(alerts.data || []).map((a) => (
                <tr key={a.id} onClick={() => setOpenId(a.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpenId(a.id)}>
                  <td className="mono">{fmtDateTime(a.timestamp)}</td>
                  <td>
                    <span className={`pill sev-${a.severity}`}>{a.severity}</span>
                  </td>
                  <td>
                    <span className="row gap-sm">
                      <Icon name={a.iconName} size={18} />
                      {pickLoc(a.localizations, 'en').loc?.title}
                      {a.isDrill && <span className="pill drill">DRILL</span>}
                    </span>
                  </td>
                  <td>{a.machineName}</td>
                  <td>{a.status.toLowerCase()}</td>
                  <td className="mono">{a.severity === 'GREEN' ? '–' : `${a.stepsDone.length}/3`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {alerts.data?.length === 0 && <p className="muted pad">No alerts match these filters.</p>}
        </div>
      </div>

      {openId && <AlertDetail alertId={openId} onClose={() => setOpenId(null)} onChanged={alerts.reload} />}
    </div>
  );
}
