import { useState } from 'react';
import { api } from '../api.js';
import AlertDetail from '../components/AlertDetail.jsx';
import Icon from '../components/Icon.jsx';
import { fmtDateTime, pickLoc } from '../i18n.js';
import { useLiveRefresh } from '../live.js';
import { useFetch, useSession } from '../session.jsx';

const secs = (n) => (n == null ? '–' : n < 90 ? `${n}s` : `${Math.floor(n / 60)}m ${n % 60}s`);

export default function DrillMode() {
  const { user } = useSession();
  const canRun = user.role === 'ENGINEER' || user.role === 'SUPERVISOR';
  const machines = useFetch('/machines');
  const templates = useFetch('/alert-templates');
  const drills = useFetch('/drills');
  const [form, setForm] = useState({ machineId: '', alertTemplateId: '', team: '' });
  const [msg, setMsg] = useState(null);
  const [openId, setOpenId] = useState(null);

  useLiveRefresh(['alert', 'alert-updated'], drills.reload);

  const start = async (e) => {
    e.preventDefault();
    setMsg(null);
    try {
      const a = await api('/drill/start', {
        method: 'POST',
        body: {
          machineId: Number(form.machineId || machines.data?.[0]?.id),
          alertTemplateId: Number(form.alertTemplateId || drillable[0]?.id),
          team: form.team,
        },
      });
      setMsg({ ok: true, text: `Drill #${a.id} is live on the operator screens. The owner is not notified for drills.` });
      drills.reload();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  };

  const drillable = (templates.data || []).filter((t) => t.defaultSeverity !== 'GREEN');
  const list = drills.data || [];
  const finished = list.filter((d) => d.stepsDone.length === 3);
  const step1Times = list.map((d) => d.step1Seconds).filter((n) => n != null).sort((a, b) => a - b);
  const medianStep1 = step1Times.length ? step1Times[Math.floor(step1Times.length / 2)] : null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Drill mode</h1>
          <p className="muted">Practise the 3-step response at shift change. Owners are never notified.</p>
        </div>
      </div>

      <div className="two-col">
        {canRun ? (
          <form className="panel" onSubmit={start}>
            <h3>
              <Icon name="alert" size={18} /> Start a practice alert
            </h3>
            <p className="muted small">Appears on operator screens like a real alert, with a “Drill” label. Response time and steps are recorded.</p>
            <label>
              Machine / zone
              <select value={form.machineId} onChange={(e) => setForm({ ...form, machineId: e.target.value })}>
                {(machines.data || []).filter((m) => m.isActive).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} – {m.location}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Alert type
              <select value={form.alertTemplateId} onChange={(e) => setForm({ ...form, alertTemplateId: e.target.value })}>
                {drillable.map((t) => (
                  <option key={t.id} value={t.id}>
                    {pickLoc(t.localizations, 'en').loc?.title} ({t.defaultSeverity.toLowerCase()})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Target shift / team
              <input value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })} placeholder="e.g. Shift B – Press shop" />
            </label>
            <button className="btn btn-primary btn-lg">Start drill</button>
            {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.text}</p>}
          </form>
        ) : (
          <div className="panel">
            <p className="muted">Drills are started by engineers or supervisors. You can review results here.</p>
          </div>
        )}

        <div className="panel">
          <h3>Training scorecard</h3>
          <div className="stats compact">
            <div className="stat">
              <div className="stat-value">{list.length}</div>
              <div className="stat-label">Drills run</div>
            </div>
            <div className="stat">
              <div className="stat-value">{list.length ? `${Math.round((finished.length / list.length) * 100)}%` : '–'}</div>
              <div className="stat-label">All 3 steps done</div>
              <div className="muted small">target ≥ 80%</div>
            </div>
            <div className="stat">
              <div className="stat-value">{secs(medianStep1)}</div>
              <div className="stat-label">Median time to step 1</div>
              <div className="muted small">target &lt; 60s</div>
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>Recent drills</h3>
        <div className="table-wrap">
          <table className="timeline">
            <thead>
              <tr>
                <th>Started</th>
                <th>Scenario</th>
                <th>Machine</th>
                <th>Team</th>
                <th>First response</th>
                <th>Step 1</th>
                <th>All steps</th>
                <th>Missed</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id} onClick={() => setOpenId(d.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpenId(d.id)}>
                  <td className="mono">{fmtDateTime(d.timestamp)}</td>
                  <td>
                    <span className="row gap-sm">
                      <Icon name={d.iconName} size={18} /> {d.title}
                    </span>
                  </td>
                  <td>{d.machineName}</td>
                  <td>{d.team || '–'}</td>
                  <td className="mono">{secs(d.responseSeconds)}</td>
                  <td className={`mono ${d.step1Seconds != null && d.step1Seconds < 60 ? 'ok' : ''}`}>{secs(d.step1Seconds)}</td>
                  <td className="mono">{d.completionSeconds != null ? secs(d.completionSeconds) : <span className="muted">{d.stepsDone.length}/3</span>}</td>
                  <td>{d.stepsMissed.length ? d.stepsMissed.map((n) => `#${n}`).join(' ') : <span className="ok">none</span>}</td>
                  <td className="small">{d.notes.map((n) => n.text).join(' · ') || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length === 0 && <p className="muted pad">No drills yet. Start one at shift change.</p>}
        </div>
      </div>

      {openId && <AlertDetail alertId={openId} onClose={() => setOpenId(null)} onChanged={drills.reload} />}
    </div>
  );
}
