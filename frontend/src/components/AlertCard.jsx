import { pickLoc, t, timeAgo } from '../i18n.js';
import Icon from './Icon.jsx';

/** Big, glanceable operator card: colour + icon + title + machine + age. */
export default function AlertCard({ alert, lang, onOpen }) {
  const { loc } = pickLoc(alert.localizations, lang);
  return (
    <button type="button" className={`alert-card sev-${alert.severity} ${alert.status === 'RESOLVED' ? 'is-resolved' : ''}`} onClick={() => onOpen(alert)}>
      <span className="alert-card-icon">
        <Icon name={alert.iconName} size={44} />
      </span>
      <span className="alert-card-body">
        <span className="alert-card-top">
          <span className={`pill sev-${alert.severity}`}>{t(lang, alert.severity)}</span>
          {alert.isDrill && <span className="pill drill">{t(lang, 'drill')}</span>}
          <span className="pill status">{t(lang, alert.status)}</span>
        </span>
        <span className="alert-card-title">{loc?.title || alert.eventTypeKey}</span>
        <span className="alert-card-meta">
          {alert.machineName} · {timeAgo(alert.timestamp, lang)}
        </span>
      </span>
      {alert.severity !== 'GREEN' && (
        <span className="steps-dots" aria-label={`${alert.stepsDone.length} of 3 steps done`}>
          {[1, 2, 3].map((n) => (
            <span key={n} className={alert.stepsDone.includes(n) ? 'dot on' : 'dot'} />
          ))}
        </span>
      )}
    </button>
  );
}
