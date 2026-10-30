import { useEffect, useState } from 'react';

// Light / dark theme. Remembers the viewer's choice; otherwise follows the device.
const KEY = 'sentinel.theme';

function stored() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches;

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0b0f17' : '#f6f7fb');
}

export function initTheme() {
  applyTheme(stored() || (systemDark() ? 'dark' : 'light'));
}

export function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light');
  useEffect(() => applyTheme(theme), [theme]);
  const toggle = () =>
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* storage blocked – theme still switches for this visit */
      }
      return next;
    });
  return [theme, toggle];
}
