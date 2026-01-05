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
  let wasConnected = false; // Track if connection was ever established

  window.__veryfrontHMRWebSocket = ws;

  // Notify Studio that the app is ready (clears loading indicator)
  if (window.parent !== window) {
    try {
      window.parent.postMessage({
        action: 'appUpdated',
        isInitialLoad: true,
        url: window.location.href
      }, '*');
    } catch (e) { /* postMessage may fail in cross-origin iframes - expected */ }
  }

  ws.onopen = () => {
    wasConnected = true;
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
    // Only schedule reload if connection was previously established
    // This prevents reload loops when HMR server is not running
    if (wasConnected) {
      reconnectTimeoutId = setTimeout(() => { window.location.reload(); }, HMR_RELOAD_DELAY_MS);
    } else {
      console.warn('[HMR] Connection failed - HMR server may not be running');
    }
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
        // Clear component cache to ensure fresh components are loaded
        if (window.__veryfrontClearComponentCache) {
          window.__veryfrontClearComponentCache();
        }
        // Re-render the page with fresh components
        // This is more reliable than React Refresh for our architecture
        // where layouts and pages are dynamically loaded
        if (window.__veryfrontRenderPage) {
          window.__veryfrontRenderPage(window.location.pathname);
          console.log('[HMR] Page re-rendered with updated components');
          // Notify Studio that update completed
          if (window.parent !== window) {
            try {
              window.parent.postMessage({ action: 'appUpdated', url: window.location.href }, '*');
            } catch (e) { /* ignore */ }
          }
        } else if (reactRefreshEnabled && window.$RefreshRuntime$?.performReactRefresh) {
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
