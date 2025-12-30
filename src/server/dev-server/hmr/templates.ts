/**
 * HMR Runtime Templates
 * Client-side JavaScript template strings for Hot Module Replacement
 */

/**
 * Generate the complete HMR client runtime template
 *
 * @param port - WebSocket server port
 * @param hostname - Default hostname constant
 * @param reloadDelay - Client reload delay in milliseconds
 * @returns JavaScript code for complete HMR runtime
 */
export function generateHMRClientTemplate(
  port: number,
  hostname: string,
  reloadDelay: number,
): string {
  return `const HMR_PORT = ${port};
  const HMR_RELOAD_DELAY_MS = ${reloadDelay};
  const host = window.location.hostname || '${hostname}';
  // Connect to HMR server at ws://localhost:${port}
  const ws = new WebSocket('ws://' + host + ':${port}');
  let reactRefreshEnabled = false;
  let reconnectTimeoutId = null;

  window.__veryfrontHMRWebSocket = ws;

  // Notify Studio that the app is ready (clears loading indicator)
  if (window.parent !== window) {
    try {
      window.parent.postMessage({
        action: 'appUpdated',
        isInitialLoad: true,
        url: window.location.href
      }, '*');
    } catch (e) {}
  }

  ws.onopen = () => {
    if (reconnectTimeoutId !== null) {
      clearTimeout(reconnectTimeoutId);
      reconnectTimeoutId = null;
    }
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      switch (message.type) {
        case 'connected':
          reactRefreshEnabled = message.reactRefresh || false;
          if (reactRefreshEnabled) { setupReactRefresh(); }
          break;
        case 'update': handleUpdate(message); break;
        case 'reload': window.location.reload(); break;
        default: console.warn('[HMR] Unknown message type:', message);
      }
    } catch (error) { console.error('[HMR] Failed to process message:', error); }
  };

  ws.onclose = () => {
    reconnectTimeoutId = setTimeout(() => { window.location.reload(); }, HMR_RELOAD_DELAY_MS);
  };

  ws.onerror = (error) => { console.error('[HMR] WebSocket error:', error); };

  window.addEventListener('beforeunload', () => {
    if (reconnectTimeoutId !== null) { clearTimeout(reconnectTimeoutId); reconnectTimeoutId = null; }
    ws.close();
  });

  function handleUpdate(update) {
    if (!update.path) { console.warn('[HMR] Update message missing path'); return; }
    if (update.path.endsWith('.css')) { updateCSS(update.path); return; }
    updateJS(update.path);
  }

  function updateCSS(path) {
    document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
      try {
        const url = new URL(link.href);
        if (url.pathname === path) {
          const newUrl = new URL(link.href);
          newUrl.searchParams.set('t', Date.now().toString());
          link.href = newUrl.toString();
        }
      } catch (error) { console.error('[HMR] Failed to update CSS link:', error); }
    });
  }

  function updateJS(path) {
    try {
      const cacheBusted = path + (path.includes('?') ? '&' : '?') + 't=' + Date.now();
      const script = document.createElement('script');
      script.type = 'module';
      script.crossOrigin = 'anonymous';
      script.onload = () => {
        if (reactRefreshEnabled && window.$RefreshRuntime$?.performReactRefresh) {
          window.$RefreshRuntime$.performReactRefresh();
        } else {
          window.location.reload();
        }
      };
      script.onerror = () => { window.location.reload(); };
      script.src = cacheBusted;
      document.head.appendChild(script);
    } catch (error) {
      console.error('[HMR] Failed to update JS module:', error);
      window.location.reload();
    }
  }

  function setupReactRefresh() {
    if (typeof window.$RefreshRuntime$ !== 'undefined') {
      window.$RefreshRuntime$.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
    }
  }

  if (reactRefreshEnabled) {
    setupReactRefresh();
  }`;
}
