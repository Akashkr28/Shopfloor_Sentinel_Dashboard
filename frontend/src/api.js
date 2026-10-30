// JWT lives in memory, mirrored to sessionStorage so a page refresh on the
// shopfloor screen doesn't log the operator out (cleared when the tab closes).
const KEY = 'sentinel.session';
let session = null;
try {
  session = JSON.parse(sessionStorage.getItem(KEY) || 'null');
} catch {
  session = null;
}

export const getSession = () => session;
export const getToken = () => session?.token || null;

export function setSession(next) {
  session = next;
  try {
    if (next) sessionStorage.setItem(KEY, JSON.stringify(next));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* private mode – memory only */
  }
}

export async function api(path, { method = 'GET', body, raw = false, headers = {} } = {}) {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  if (res.status === 401 && token && path !== '/auth/login') {
    setSession(null);
    window.dispatchEvent(new Event('sentinel:logout'));
  }
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new Error((isJson && data.error) || res.statusText);
  return data;
}

export const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
