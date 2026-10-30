import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmtDateTime, LANGS, pickLoc, t, timeAgo } from '../i18n.js';
import { useSession } from '../session.jsx';
import AudioButton from './AudioButton.jsx';
import Icon from './Icon.jsx';

const STEPS = [
  { n: 1, key: 'whatYouSee', field: 'whatYouSee', icon: 'eye' },
  { n: 2, key: 'whatToDo', field: 'whatToDo', icon: 'hand' },
  { n: 3, key: 'whomToCall', field: 'whomToCall', icon: 'phone' },
];

/** Drawer with the 3-step script, language switcher, audio and "I did this" ticks. */
export default function AlertDetail({ alertId, onClose, onChanged }) {
  const { user } = useSession();
  const [alert, setAlert] = useState(null);
  const [lang, setLang] = useState(user.preferredLanguage);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const isFloor = user.role === 'OPERATOR' || user.role === 'SUPERVISOR';
  const canResolve = user.role !== 'OPERATOR';

  useEffect(() => {
    api(`/alerts/${alertId}`).then(setAlert).catch((e) => setError(e.message));
  }, [alertId]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const act = async (body) => {
    setBusy(true);
    setError('');
    try {
      const updated = await api(`/alerts/${alertId}/actions`, { method: 'POST', body });
      setAlert(updated);
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!alert) {
    return (
      <div className="drawer-backdrop" onClick={onClose}>
        <aside className="drawer" onClick={(e) => e.stopPropagation()}>
          <p className="muted">{error || 'Loading…'}</p>
        </aside>
      </div>
    );
  }

  const { loc, fallback } = pickLoc(alert.localizations, lang);
  const fullScript = loc ? `${loc.title}. 1. ${loc.whatYouSee} 2. ${loc.whatToDo} 3. ${loc.whomToCall}` : '';
  const allDone = alert.stepsDone.length === 3;
  const uiLang = lang;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className={`drawer sev-border-${alert.severity}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={loc?.title}>
        <header className={`drawer-head sev-bg-${alert.severity}`}>
          <Icon name={alert.iconName} size={52} />
          <div className="drawer-title">
            <div className="row gap-sm wrap">
              <span className="pill on-color">{t(uiLang, alert.severity)}</span>
              {alert.isDrill && <span className="pill drill">{t(uiLang, 'drill')}</span>}
              <span className="pill on-color">{t(uiLang, alert.status)}</span>
            </div>
            <h2>{loc?.title}</h2>
            <div className="on-color-sub">
              {alert.machineName} · {alert.machineLocation} · {timeAgo(alert.timestamp, uiLang)}
            </div>
          </div>
          <button className="icon-btn on-color" onClick={onClose} aria-label={t(uiLang, 'close')}>
            <Icon name="x" size={28} />
          </button>
        </header>

        <div className="drawer-body">
          {alert.isDrill && <div className="banner drill-banner">{t(uiLang, 'practice')}</div>}

          <div className="lang-switch" role="tablist">
            {LANGS.map((l) => (
              <button key={l.code} role="tab" aria-selected={lang === l.code} className={lang === l.code ? 'active' : ''} onClick={() => setLang(l.code)}>
                {l.label}
              </button>
            ))}
          </div>
          {fallback && <p className="muted small">{t(uiLang, 'noTranslation')}</p>}

          <AudioButton audioUrl={alert.localizations[lang]?.audioUrl} text={fullScript} lang={alert.localizations[lang] ? lang : 'en'} uiLang={uiLang} big />

          <ol className="steps">
            {STEPS.map((s) => {
              const done = alert.stepsDone.includes(s.n);
              return (
                <li key={s.n} className={done ? 'step done' : 'step'}>
                  <div className="step-num">{done ? <Icon name="check" size={30} /> : s.n}</div>
                  <div className="step-body">
                    <div className="step-label">
                      <Icon name={s.icon} size={18} /> {t(uiLang, s.key)}
                    </div>
                    <p className="step-text">{loc?.[s.field]}</p>
                    {alert.severity !== 'GREEN' && (
                      <button className={`btn ${done ? 'btn-done' : 'btn-primary'} btn-lg`} disabled={busy || done} onClick={() => act({ actionType: 'STEP_COMPLETED', stepNumber: s.n })}>
                        <Icon name="check" size={22} /> {done ? t(uiLang, 'done') : t(uiLang, 'iDidThis')}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          {allDone && <div className="banner ok-banner">{t(uiLang, 'allStepsDone')}</div>}
          {error && <p className="error">{error}</p>}

          <div className="row gap-sm wrap">
            {alert.status === 'OPEN' && alert.severity !== 'GREEN' && (
              <button className="btn" disabled={busy} onClick={() => act({ actionType: 'ACKNOWLEDGE' })}>
                <Icon name="eye" size={18} /> {t(uiLang, 'ACKNOWLEDGED')}
              </button>
            )}
            {canResolve && alert.status !== 'RESOLVED' && (
              <button className="btn" disabled={busy} onClick={() => act({ actionType: 'RESOLVE' })}>
                Mark handled
              </button>
            )}
          </div>

          {canResolve ? (
            <form
              className="note-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (note.trim()) act({ actionType: 'NOTE', notes: note.trim() }).then(() => setNote(''));
              }}
            >
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={alert.isDrill ? 'Training note (e.g. step 2 was slow)' : 'Add a note'} />
              <button className="btn" disabled={busy || !note.trim()}>Save note</button>
            </form>
          ) : null}

          {alert.actions?.length > 0 && (
            <section className="activity">
              <h3>Activity</h3>
              <ul>
                {alert.actions.map((a) => (
                  <li key={a.id}>
                    <span className="mono small">{fmtDateTime(a.timestamp)}</span> {a.userName} –{' '}
                    {a.actionType === 'STEP_COMPLETED' ? `step ${a.stepNumber} done` : a.actionType === 'NOTE' ? `“${a.notes}”` : a.actionType.toLowerCase()}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!isFloor && alert.rawPayload && (
            <details className="raw">
              <summary>Technical details (from gateway)</summary>
              <pre>{JSON.stringify(alert.rawPayload, null, 2)}</pre>
            </details>
          )}
        </div>
      </aside>
    </div>
  );
}
