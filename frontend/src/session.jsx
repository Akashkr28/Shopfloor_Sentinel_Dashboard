import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, getSession, getToken, setSession } from './api.js';

const SessionCtx = createContext(null);

export function SessionProvider({ children }) {
  const [session, setState] = useState(getSession());

  const login = useCallback(async (username, password) => {
    const s = await api('/auth/login', { method: 'POST', body: { username, password } });
    setSession(s);
    setState(s);
    return s.user;
  }, []);

  const logout = useCallback(() => {
    setSession(null);
    setState(null);
  }, []);

  const setLanguage = useCallback(async (preferredLanguage) => {
    const next = { ...getSession(), user: { ...getSession().user, preferredLanguage } };
    setSession(next);
    setState(next);
    api('/me', { method: 'PATCH', body: { preferredLanguage } }).catch(() => {});
  }, []);

  useEffect(() => {
    const onLogout = () => setState(null);
    window.addEventListener('sentinel:logout', onLogout);
    return () => window.removeEventListener('sentinel:logout', onLogout);
  }, []);

  return <SessionCtx.Provider value={{ user: session?.user || null, login, logout, setLanguage }}>{children}</SessionCtx.Provider>;
}

export const useSession = () => useContext(SessionCtx);

export const HOME_BY_ROLE = { OWNER: '/owner', ENGINEER: '/engineer', SUPERVISOR: '/floor', OPERATOR: '/floor' };

/**
 * Subscribe to the backend's Server-Sent Events stream. `onEvent` fires for
 * alert / alert-updated / notification / templates / machines events.
 */
export function useLive(onEvent) {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const token = getToken();
    if (!token) return undefined;
    const es = new EventSource(`/api/stream?token=${encodeURIComponent(token)}`);
    const types = ['alert', 'alert-updated', 'notification', 'templates', 'machines'];
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
