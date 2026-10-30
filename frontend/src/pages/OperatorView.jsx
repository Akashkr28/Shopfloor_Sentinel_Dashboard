import { useEffect, useState } from 'react';
import { qs } from '../api.js';
import AlertCard from '../components/AlertCard.jsx';
import AlertDetail from '../components/AlertDetail.jsx';
import Icon from '../components/Icon.jsx';
import { t } from '../i18n.js';
import { useLiveRefresh } from '../live.js';
import { useFetch, useSession } from '../session.jsx';

/** Short two-tone chime so a new red alert is noticed even when nobody is looking. */
function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 660, 880].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.18, ctx.currentTime + i * 0.22);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.22 + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.22);
      o.stop(ctx.currentTime + i * 0.22 + 0.21);
    });
  } catch {
    /* audio blocked until first tap – fine */
  }
}

export default function OperatorView() {
  const { user } = useSession();
  const lang = user.preferredLanguage;
  const [activeOnly, setActiveOnly] = useState(true);
  const [openId, setOpenId] = useState(null);
  const { data: alerts, error, reload } = useFetch(`/alerts${qs({ activeOnly: activeOnly ? 'true' : undefined, limit: 60 })}`);

  const [, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow((n) => n + 1), 30000); // keep "x min ago" fresh
    return () => clearInterval(id);
  }, []);

  useLiveRefresh(['alert', 'alert-updated', 'templates'], (type, payload) => {
    if (type === 'alert' && payload.severity === 'RED') chime();
    reload();
  });

  const list = (alerts || []).filter((a) => !activeOnly || a.severity !== 'GREEN');
  const worst = list.some((a) => a.severity === 'RED' && a.status !== 'RESOLVED')
    ? 'RED'
    : list.some((a) => a.severity === 'AMBER' && a.status !== 'RESOLVED')
      ? 'AMBER'
      : 'GREEN';
  const openCount = list.filter((a) => a.status !== 'RESOLVED').length;

  // Never flash "all clear" before we actually know.
  if (!alerts) return <div className="floor muted">{error ? error.message : '…'}</div>;

  return (
    <div className="floor">
      <section className={`floor-status sev-bg-${worst}`}>
        <span className="floor-status-icon">
          <Icon name={worst === 'GREEN' ? 'shield' : 'alert'} size={40} />
        </span>
        <div>
          <div className="floor-status-title">{worst === 'GREEN' ? t(lang, 'allClear') : `${t(lang, worst)} · ${openCount}`}</div>
          {worst === 'GREEN' && <div className="floor-status-sub">{t(lang, 'allClearSub')}</div>}
        </div>
      </section>

      <div className="floor-toolbar">
      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={activeOnly} className={activeOnly ? 'active' : ''} onClick={() => setActiveOnly(true)}>
          {t(lang, 'activeOnly')}
        </button>
        <button role="tab" aria-selected={!activeOnly} className={!activeOnly ? 'active' : ''} onClick={() => setActiveOnly(false)}>
          {t(lang, 'all')}
        </button>
      </div>
      </div>

      {list.length === 0 && (
        <div className="empty-state">
          <Icon name="shield" size={32} />
          {t(lang, 'allClearSub')}
        </div>
      )}
      <div className="card-grid">
        {list.map((a) => (
          <AlertCard key={a.id} alert={a} lang={lang} onOpen={(x) => setOpenId(x.id)} />
        ))}
      </div>

      {openId && <AlertDetail alertId={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  );
}
