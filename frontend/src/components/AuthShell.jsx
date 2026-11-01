import Icon from './Icon.jsx';

const HIGHLIGHTS = [
  ['RED', 'usb', 'USB drive plugged into machine', 'Press Line 1 · just now'],
  ['AMBER', 'network', 'नेटवर्क में असामान्य गतिविधि', 'Packaging HMI A · 4 min ago'],
  ['GREEN', 'shield', 'வழக்கமான பாதுகாப்பு சோதனை சரி', 'CNC Cell 3 · 12 min ago'],
];

/** Split-screen frame for the public pages: sign in, first-run setup, accept invite. */
export default function AuthShell({ factoryName, children }) {
  return (
    <div className="login-wrap">
      <section className="login-hero">
        <div>
          <div className="brand">
            <span className="brand-mark">
              <img src="/favicon.svg" alt="" width="22" height="22" />
            </span>
            <span className="brand-text">
              Shopfloor <b>Sentinel</b>
            </span>
          </div>
          {factoryName && <div className="hero-factory">{factoryName}</div>}
          <h2>Cyber health your whole shopfloor understands.</h2>
          <p>Passive monitoring, traffic-light alerts and 3-step scripts in Hindi, Marathi and Tamil – with WhatsApp updates for owners.</p>
          <div className="hero-cards" aria-hidden="true">
            {HIGHLIGHTS.map(([sev, icon, title, meta]) => (
              <div className="hero-card" key={title}>
                <span className={`hc-icon sev-bg-${sev}`}>
                  <Icon name={icon} size={20} />
                </span>
                <div>
                  <b>{title}</b>
                  <span>{meta}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="hero-foot">Read-only gateway · never sends commands to PLCs or HMIs</div>
      </section>
      <section className="login-side">{children}</section>
    </div>
  );
}
