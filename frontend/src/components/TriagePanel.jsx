import { useState } from 'react';
import { api } from '../api.js';
import { fmtDateTime } from '../i18n.js';
import { useLiveRefresh } from '../live.js';
import { isManager, useFetch, useSession } from '../session.jsx';
import Icon from './Icon.jsx';

const WHO = { OWNER: 'Owner', ENGINEER: 'Engineer', OPERATOR: 'Operator', IT_VENDOR: 'IT vendor' };
const URGENCY = { NOW: 'sev-RED', TODAY: 'sev-AMBER', THIS_WEEK: 'status' };
const TOOL_LABEL = {
  get_alert: 'Read the alert', find_related_events: 'Looked for related events', get_machine_history: 'Checked machine history',
  get_gateway_status: 'Checked gateway health', search_knowledge_base: 'Searched playbooks', submit_triage: 'Wrote the triage',
};

function Citation({ n, source, open, onToggle }) {
  return (
    <button type="button" className={`cite ${open ? 'open' : ''}`} onClick={onToggle} title={source ? `${source.title}${source.section ? ` › ${source.section}` : ''}` : ''}>
      {n}
    </button>
  );
}

/** AI incident triage for one alert: summary, cited next steps, related events, how the agent got there. */
export default function TriagePanel({ alert, onOpenAlert }) {
  const { user } = useSession();
  const t = useFetch(`/alerts/${alert.id}/triage`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [openSource, setOpenSource] = useState(null);
  useLiveRefresh(['triage'], (_type, p) => p.alertId === alert.id && t.reload());

  if (!t.data) return null;
  const { ai, triage } = t.data;
  const canRun = isManager(user) && ai.enabled;
  const running = triage && ['PENDING', 'RUNNING'].includes(triage.status);
  const r = triage?.status === 'DONE' ? triage.result : null;
  const sources = triage?.sources || [];
  const num = Object.fromEntries(sources.map((s, i) => [s.id, i + 1]));

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      await api(`/alerts/${alert.id}/triage`, { method: 'POST' });
      t.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!ai.enabled && !triage) {
    return isManager(user) ? (
      <section className="triage off">
        <h3><Icon name="spark" size={18} /> AI triage</h3>
        <p className="muted small">Not configured. Add <span className="mono">ANTHROPIC_API_KEY</span> to backend/.env to get an AI incident summary for every red alert.</p>
      </section>
    ) : null;
  }

  return (
    <section className={`triage ${r?.isLikelyBenign ? 'benign' : ''}`}>
      <div className="triage-head">
        <h3><Icon name="spark" size={18} /> AI incident triage</h3>
        {canRun && !running && (
          <button className="btn btn-ghost" onClick={run} disabled={busy}>
            {triage ? 'Re-run' : 'Triage with AI'}
          </button>
        )}
      </div>

      {running && (
        <div className="triage-running">
          <span className="spinner" aria-hidden="true" /> Investigating – checking related events and playbooks…
        </div>
      )}
      {triage?.status === 'FAILED' && <p className="error small">Triage failed: {triage.error}</p>}
      {error && <p className="error small">{error}</p>}
      {!triage && !running && <p className="muted small">No triage yet for this alert.</p>}

      {r && (
        <>
          <div className="triage-headline">
            <strong>{r.headline}</strong>
            <span className={`pill ${r.confidence === 'high' ? 'sev-GREEN' : r.confidence === 'medium' ? 'sev-AMBER' : 'status'}`}>{r.confidence} confidence</span>
            {r.isLikelyBenign && <span className="pill sev-GREEN">likely benign</span>}
          </div>
          <p className="triage-summary">{r.ownerSummary}</p>

          <h4>Next steps</h4>
          <ol className="triage-steps">
            {r.nextSteps.map((s, i) => (
              <li key={i}>
                <span className={`pill ${URGENCY[s.urgency]}`}>{s.urgency.replace('_', ' ').toLowerCase()}</span>
                <span className="who">{WHO[s.who]}</span>
                <span className="action">
                  {s.action}
                  {s.sourceIds.map((id) => (
                    <Citation key={id} n={num[id]} source={sources[num[id] - 1]} open={openSource === id} onToggle={() => setOpenSource(openSource === id ? null : id)} />
                  ))}
                </span>
              </li>
            ))}
          </ol>

          {openSource && sources[num[openSource] - 1] && (
            <blockquote className="source-peek">
              <div className="small"><b>[{num[openSource]}] {sources[num[openSource] - 1].title}</b>{sources[num[openSource] - 1].section ? ` › ${sources[num[openSource] - 1].section}` : ''}</div>
              <p>{sources[num[openSource] - 1].snippet}…</p>
            </blockquote>
          )}

          {user.role !== 'OWNER' && (
            <details className="raw">
              <summary>Technical assessment</summary>
              <p className="small"><b>What happened:</b> {r.whatHappened}</p>
              <p className="small"><b>Likely cause:</b> {r.likelyCause}</p>
            </details>
          )}

          {r.relatedEventIds.length > 0 && (
            <p className="small">
              Related alerts:{' '}
              {r.relatedEventIds.map((id) => (
                <button key={id} className="link-btn related" onClick={() => onOpenAlert?.(id)}>#{id}</button>
              ))}
            </p>
          )}

          {sources.length > 0 && (
            <div className="sources">
              <h4>Sources</h4>
              <ol>
                {sources.map((s, i) => (
                  <li key={s.id}>
                    <span className={`pill ${s.kind === 'ADVISORY' ? 'sev-AMBER' : 'status'}`}>{s.kind.toLowerCase()}</span>{' '}
                    {s.url ? <a href={s.url} target="_blank" rel="noreferrer noopener">{s.title}</a> : s.title}
                    {s.section && <span className="muted"> › {s.section}</span>}
                    {s.why && <span className="muted small"> – {s.why}</span>}
                    <span className="mono small muted"> [{i + 1}]</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <details className="raw">
            <summary>How the agent got there</summary>
            <ul className="trace">
              {triage.trace.map((s, i) => (
                <li key={i} className={s.ok ? '' : 'error'}>
                  {TOOL_LABEL[s.tool] || s.tool}
                  {s.tool === 'search_knowledge_base' && <span className="muted"> “{s.input.query}”</span>}
                  {s.tool === 'find_related_events' && <span className="muted"> (±{s.input.hours} h)</span>}
                  <span className="muted small"> · {s.ms} ms</span>
                </li>
              ))}
            </ul>
            <p className="muted small">
              {triage.model} · {fmtDateTime(triage.finishedAt)} · {triage.trigger.toLowerCase()} · {triage.usage?.requests} requests,{' '}
              {triage.usage ? `${Math.round((triage.usage.input_tokens + triage.usage.cache_read_input_tokens) / 1000)}k in / ${Math.round(triage.usage.output_tokens / 1000)}k out tokens` : ''}
              {r.droppedCitations?.length ? ` · ${r.droppedCitations.length} unverifiable citation(s) removed` : ''}
            </p>
          </details>
          <p className="muted small ai-note">AI-generated from Sentinel's data and your playbooks – check before acting on anything that affects production.</p>
        </>
      )}
    </section>
  );
}
