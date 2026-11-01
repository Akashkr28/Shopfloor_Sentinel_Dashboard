import { useState } from 'react';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import { fmtDateTime } from '../i18n.js';
import { useLiveRefresh } from '../live.js';
import { useFetch } from '../session.jsx';

const VERDICT = {
  GREEN: ['All OK today', 'No open security problems.'],
  AMBER: ['Mostly OK', 'Some warnings today – your team is on it.'],
  RED: ['Needs attention', 'A red alert is still open.'],
};

function WhatsAppPreview({ text, onClose, onSend }) {
  const [state, setState] = useState(null);
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="wa-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="WhatsApp preview">
        <div className="wa-head">
          <Icon name="shield" size={22} /> Shopfloor Sentinel
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" size={20} />
          </button>
        </div>
        <div className="wa-chat">
          <div className="wa-bubble">{text}</div>
        </div>
        <div className="wa-foot">
          <button
            className="btn btn-primary"
            disabled={state === 'sending'}
            onClick={async () => {
              setState('sending');
              try {
                const r = await onSend();
                setState(r.results.length ? r.results.map((x) => `${x.to}: ${x.status}`).join(', ') : 'No owner phone numbers set');
              } catch (e) {
                setState(e.message);
              }
            }}
          >
            Send to owner now
          </button>
          {state && state !== 'sending' && <span className="small">{state}</span>}
        </div>
      </div>
    </div>
  );
}

const TYPE_LABEL = {
  RED_ALERT: 'Red alert', DAILY_SUMMARY: 'Daily summary', ESCALATION: 'Escalation', RESOLVED_UPDATE: 'Handled update',
  GATEWAY_OFFLINE: 'Gateway status', TEST: 'Test', AI_SUMMARY: 'AI summary',
};

/** WhatsApp-style ticks: ✓ sent, ✓✓ delivered, blue ✓✓ read. */
function Delivery({ n, onRetry }) {
  if (n.status === 'FAILED') {
    return (
      <span className="delivery failed" title={n.error || ''}>
        failed{n.attempts > 1 ? ` after ${n.attempts} tries` : ''}{' '}
        <button className="link-btn" onClick={() => onRetry(n.id)}>retry</button>
      </span>
    );
  }
  if (n.status === 'PENDING') {
    return <span className="delivery pending" title={n.error || ''}>{n.attempts ? `retrying (${n.attempts})` : 'sending…'}</span>;
  }
  const d = n.deliveryStatus || 'sent';
  const ticks = d === 'read' || d === 'delivered' ? '✓✓' : '✓';
  return <span className={`delivery ${d}`}><span className="ticks">{ticks}</span> {d}</span>;
}

export default function OwnerView() {
  const summary = useFetch('/owner/daily-summary');
  const notifications = useFetch('/notifications');
  const [preview, setPreview] = useState(false);
  useLiveRefresh(['alert', 'alert-updated', 'notification', 'triage'], () => {
    summary.reload();
    notifications.reload();
  });

  const s = summary.data;
  const items = notifications.data?.items || [];
  const st = notifications.data?.summaryStats;
  const readRate = st?.sent ? `${Math.round((st.read / st.sent) * 100)}%` : '–';
  const retry = (id) => api(`/notifications/${id}/retry`, { method: 'POST' }).then(notifications.reload, notifications.reload);
  if (!s) return <div className="page muted">{summary.error?.message || 'Loading…'}</div>;
  const [headline, sub] = VERDICT[s.light];

  return (
    <div className="page owner">
      <section className={`owner-hero light-${s.light}`}>
        <div className="traffic-light" aria-label={`Status ${s.light}`}>
          {['RED', 'AMBER', 'GREEN'].map((c) => (
            <span key={c} className={`lamp lamp-${c} ${s.light === c ? 'on' : ''}`} />
          ))}
        </div>
        <div>
          <div className="muted">Today · {s.date}</div>
          <h1 className="owner-headline">{headline}</h1>
          <p className="owner-sub">{sub}</p>
          <button className="btn btn-primary" onClick={() => setPreview(true)}>
            <Icon name="send" size={16} /> Preview today’s WhatsApp summary
          </button>
        </div>
      </section>

      <div className="stats">
        <div className="stat stat-RED">
          <div className="stat-value">{s.counts.RED}</div>
          <div className="stat-label">Red</div>
        </div>
        <div className="stat stat-AMBER">
          <div className="stat-value">{s.counts.AMBER}</div>
          <div className="stat-label">Amber</div>
        </div>
        <div className="stat stat-GREEN">
          <div className="stat-value">{s.counts.GREEN}</div>
          <div className="stat-label">Green checks</div>
        </div>
        <div className="stat">
          <div className="stat-value">
            {s.actedOn}/{s.needingAction}
          </div>
          <div className="stat-label">Warnings acted on by team</div>
        </div>
        <div className="stat">
          <div className="stat-value">{readRate}</div>
          <div className="stat-label">Daily summaries read · 30 days</div>
          <div className="muted small">target ≥ 70%</div>
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <h3>Red alerts today</h3>
          {s.reds.length === 0 ? (
            <p className="muted">None. 👍</p>
          ) : (
            <ul className="red-list">
              {s.reds.map((r) => (
                <li key={r.id}>
                  <div className="row gap-sm wrap">
                    <span className="mono">{fmtDateTime(r.timestamp)}</span>
                    <strong>{r.title}</strong>
                    <span>– {r.machineName}</span>
                    <span className={`pill ${r.status === 'RESOLVED' ? 'sev-GREEN' : 'sev-RED'}`}>{r.status.toLowerCase()}</span>
                    <span className="muted small">operator acted: {r.operatorActed ? 'yes' : 'not yet'}</span>
                  </div>
                  {r.ai && (
                    <div className="ai-inline">
                      <Icon name="spark" size={15} />
                      <span><b>{r.ai.headline}</b> {r.ai.ownerSummary}</span>
                    </div>
                  )}
                  {r.status !== 'RESOLVED' && r.ownerFollowUp && <p className="small follow">→ {r.ownerFollowUp}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="panel">
          <h3>Top issues</h3>
          {s.topIssues.length === 0 ? (
            <p className="muted">Nothing to report.</p>
          ) : (
            <ol className="top-issues">
              {s.topIssues.map((t) => (
                <li key={t.eventTypeKey}>
                  <span className="row gap-sm">
                    <strong>{t.title}</strong> <span className={`pill sev-${t.worst}`}>{t.count}×</span>
                  </span>
                  <span className="muted small">{t.machines.join(', ')}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <div className="panel">
        <h3>WhatsApp / SMS messages</h3>
        <div className="table-wrap">
          <table className="timeline">
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>To</th>
                <th>Channel</th>
                <th>Delivery</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {items.map((n) => (
                <tr key={n.id} className="no-click">
                  <td className="mono">{fmtDateTime(n.timestamp)}</td>
                  <td>
                    {TYPE_LABEL[n.type] || n.type}
                    {n.escalationLevel ? <span className="muted small"> · level {n.escalationLevel}</span> : null}
                  </td>
                  <td>{n.userName || '–'}</td>
                  <td>
                    {n.channel.toLowerCase()} <span className="muted small">({n.provider})</span>
                  </td>
                  <td>
                    <Delivery n={n} onRetry={retry} />
                  </td>
                  <td className="small msg-cell" title={n.message}>
                    {n.message.split('\n')[1] || n.message.split('\n')[0]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length === 0 && notifications.data && <p className="muted pad">No messages yet. The daily summary goes out at 8 PM.</p>}
        </div>
      </div>

      {preview && (
        <WhatsAppPreview
          text={s.message}
          onClose={() => setPreview(false)}
          onSend={() => api('/owner/daily-summary/send', { method: 'POST' }).then((r) => (notifications.reload(), r))}
        />
      )}
    </div>
  );
}
