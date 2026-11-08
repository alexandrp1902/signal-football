export function normalizeServerUrl(raw: string, pageProtocol = 'http:'): string {
  const url = new URL(raw);
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error('Недопустимый адрес сервера');
  url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
  if (pageProtocol === 'https:' && url.protocol !== 'wss:') throw new Error('HTTPS требует защищённый сервер WSS');
  url.pathname = '/ws';
  return url.toString();
}
export function resolveServerUrl(): string {
  const query = new URLSearchParams(location.search).get('server');
  let saved: string | null = null;
  try {saved = localStorage.getItem('catsFootball.server');} catch { /* Storage may be unavailable. */ }
  const result = normalizeServerUrl(query || saved || import.meta.env.VITE_GAME_SERVER_URL || location.origin, location.protocol);
  if (query) try {localStorage.setItem('catsFootball.server', result);} catch { /* Optional preference. */ }
  return result;
}
