import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

const SessionCtx = createContext(null);

export function SessionProvider({ children }) {
  // undefined = still checking the cookie, null = logged out
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    api('/auth/session')
      .then((s) => setUser(s.user))
      .catch(() => setUser(null));
  }, []);

  const login = useCallback(async (username, password) => {
    const s = await api('/auth/login', { method: 'POST', body: { username, password } });
    setUser(s.user);
    return s.user;
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  }, []);

  const setLanguage = useCallback((preferredLanguage) => {
    setUser((u) => ({ ...u, preferredLanguage }));
    api('/me', { method: 'PATCH', body: { preferredLanguage } }).catch(() => {});
  }, []);

  useEffect(() => {
    const onLogout = () => setUser(null);
    window.addEventListener('sentinel:logout', onLogout);
    return () => window.removeEventListener('sentinel:logout', onLogout);
  }, []);

  return <SessionCtx.Provider value={{ user, ready: user !== undefined, login, logout, setLanguage }}>{children}</SessionCtx.Provider>;
}

export const useSession = () => useContext(SessionCtx);

export const HOME_BY_ROLE = { OWNER: '/owner', ENGINEER: '/engineer', SUPERVISOR: '/floor', OPERATOR: '/floor' };
export const isManager = (u) => u?.role === 'OWNER' || u?.role === 'ENGINEER';

/**
 * Subscribe to the backend's Server-Sent Events stream (authenticated by the
 * session cookie). `onEvent` fires for alert / alert-updated / notification /
 * templates / machines / gateway events.
 */
export function useLive(onEvent) {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const es = new EventSource('/api/stream', { withCredentials: true });
    const types = ['alert', 'alert-updated', 'notification', 'templates', 'machines', 'gateway'];
    const listeners = types.map((type) => {
      const fn = (e) => handler.current?.(type, JSON.parse(e.data || '{}'));
      es.addEventListener(type, fn);
      return [type, fn];
    });
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    return () => {
      listeners.forEach(([type, fn]) => es.removeEventListener(type, fn));
      es.close();
    };
  }, []);

  return connected;
}

/** Fetch helper that refetches when `deps` change or `reload()` is called. */
export function useFetch(path, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    if (!path) return undefined;
    api(path)
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState((s) => ({ ...s, error, loading: false })));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);
  return { ...state, reload: useCallback(() => setTick((n) => n + 1), []) };
}
