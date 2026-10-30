// Predefined icon set referenced by AlertTemplate.iconName. Simple, bold
// pictograms that read at a glance from across the shopfloor.
const PATHS = {
  remote: (
    <>
      <rect x="3" y="4" width="13" height="10" rx="1.5" />
      <path d="M7 18h5M9.5 14v4" />
      <path d="M17 8c2 0 3.5 1.5 3.5 3.5M17 5c3.6 0 6.5 2.9 6.5 6.5" />
      <circle cx="17.5" cy="11.5" r="1" fill="currentColor" />
    </>
  ),
  usb: (
    <>
      <path d="M12 2v14" />
      <path d="M8 6l4-4 4 4" />
      <path d="M12 12l-4-2.5V7M12 10l4-2V6" />
      <rect x="9" y="16" width="6" height="6" rx="1" />
    </>
  ),
  network: (
    <>
      <rect x="9" y="2" width="6" height="5" rx="1" />
      <rect x="2" y="17" width="6" height="5" rx="1" />
      <rect x="16" y="17" width="6" height="5" rx="1" />
      <path d="M12 7v5M5 17v-3h14v3" />
      <path d="M12 12v2" />
    </>
  ),
  bug: (
    <>
      <rect x="7" y="7" width="10" height="13" rx="5" />
      <path d="M12 11v9M7 12H3M21 12h-4M7 17H4M20 17h-3M9 7l-2-3M15 7l2-3" />
    </>
  ),
  device: (
    <>
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <path d="M11 18h2" />
      <path d="M2 8v8M22 8v8" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2l8 3.5v6c0 5-3.4 9-8 10.5C7.4 20.5 4 16.5 4 11.5v-6z" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v5" />
      <circle cx="12" cy="18" r="0.6" fill="currentColor" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10" width="16" height="12" rx="2" />
      <path d="M8 10V7a4 4 0 018 0v3M12 15v3" />
    </>
  ),
  wifi: (
    <>
      <path d="M2 8.5a15 15 0 0120 0M5 12a10 10 0 0114 0M8.5 15.5a5 5 0 017 0" />
      <circle cx="12" cy="19" r="1" fill="currentColor" />
    </>
  ),
  power: (
    <>
      <path d="M12 2v10" />
      <path d="M6.3 6.3a8 8 0 1011.4 0" />
    </>
  ),
  speaker: (
    <>
      <path d="M4 9h4l5-4v14l-5-4H4z" />
      <path d="M16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11" />
    </>
  ),
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  template: (
    <>
      <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" />
      <path d="M14 3v6h6M8 13h8M8 17h5" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </>
  ),
  settings: <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4" />,
  home: (
    <>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v10h14V10" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16V11a6 6 0 0112 0v5l2 2H4z" />
      <path d="M10 20a2 2 0 004 0" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z" />,
  logout: (
    <>
      <path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3" />
      <path d="M10 8l-4 4 4 4M6 12h10" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
    </>
  ),
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  send: <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />,
  check: <path d="M4 12.5l5 5L20 6.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  phone: <path d="M5 3h4l2 5-2.5 1.5a11 11 0 006 6L16 13l5 2v4a2 2 0 01-2 2A17 17 0 013 5a2 2 0 012-2z" />,
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  hand: <path d="M8 13V5.5a1.5 1.5 0 013 0V11m0-6.5a1.5 1.5 0 013 0V11m0-5a1.5 1.5 0 013 0v7c0 4.4-2.6 9-7 9-3 0-4.6-1.6-6.2-4.2L3 13.6a1.5 1.5 0 012.5-1.6L8 15" />,
};

export const ICON_NAMES = ['remote', 'usb', 'network', 'bug', 'device', 'shield', 'alert', 'lock', 'wifi', 'power'];

export default function Icon({ name, size = 24, className = '', title }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {PATHS[name] || PATHS.alert}
    </svg>
  );
}
