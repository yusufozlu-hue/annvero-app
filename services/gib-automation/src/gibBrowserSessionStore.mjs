const globalStore = globalThis;

if (!globalStore.__gibBrowserSessions) {
  globalStore.__gibBrowserSessions = new Map();
}

export function storeBrowserSession(sessionId, bundle) {
  if (!sessionId || !bundle) return;
  globalStore.__gibBrowserSessions.set(sessionId, bundle);
}

export function takeBrowserSession(sessionId) {
  const bundle = globalStore.__gibBrowserSessions.get(sessionId);
  globalStore.__gibBrowserSessions.delete(sessionId);
  return bundle || null;
}

export function clearBrowserSession(sessionId) {
  globalStore.__gibBrowserSessions.delete(sessionId);
}
