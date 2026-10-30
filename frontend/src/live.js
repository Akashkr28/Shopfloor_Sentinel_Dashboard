import { createContext, useContext, useEffect, useRef } from 'react';

// One SSE connection per tab (opened in Layout); pages subscribe here.
export const LiveContext = createContext(null);

/** Call `fn(type, payload)` for live events whose type is in `types`, debounced. */
export function useLiveRefresh(types, fn, delay = 250) {
  const subs = useContext(LiveContext);
  const cb = useRef(fn);
  cb.current = fn;
  const key = types.join(',');
  useEffect(() => {
    if (!subs) return undefined;
    let timer;
    const wanted = new Set(key.split(','));
    const sub = (type, payload) => {
      if (!wanted.has(type)) return;
      clearTimeout(timer);
      timer = setTimeout(() => cb.current(type, payload), delay);
    };
    subs.add(sub);
    return () => {
      clearTimeout(timer);
      subs.delete(sub);
    };
  }, [subs, key, delay]);
}
