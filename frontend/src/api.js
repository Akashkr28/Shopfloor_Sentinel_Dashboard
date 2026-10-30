// The session lives in an HttpOnly cookie set by the backend, so page scripts
// never see the token. Every request carries X-Sentinel-Request, which the
// backend requires on writes as CSRF protection.

export async function api(path, { method = 'GET', body, raw = false, headers = {} } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      'X-Sentinel-Request': '1',
      ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('sentinel:logout'));
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) throw Object.assign(new Error((isJson && data.error) || res.statusText), { status: res.status });
  return data;
}

/** Download a file from the API (the cookie authenticates it). */
export async function download(path, filename) {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin', headers: { 'X-Sentinel-Request': '1' } });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

export const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
