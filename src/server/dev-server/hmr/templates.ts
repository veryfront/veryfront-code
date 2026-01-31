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
    if (reconnectTimeoutId === null) return;
    clearTimeout(reconnectTimeoutId);
    reconnectTimeoutId = null;
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      switch (message.type) {
        case 'connected': {
          reactRefreshEnabled = message.reactRefresh || false;
          if (reactRefreshEnabled) setupReactRefresh();
          break;
        }
        case 'update':
          handleUpdate(message);
          break;
        case 'reload':
          window.location.reload();
          break;
        default:
          console.warn('[HMR] Unknown message type:', message);
      }
    } catch (error) {
      console.error('[HMR] Failed to process message:', error);
    }
  };

  ws.onclose = () => {
    // Only schedule reload if connection was previously established
    // This prevents reload loops when HMR server is not running
    if (!wasConnected) {
      console.warn('[HMR] Connection failed - HMR server may not be running');
      return;
    }
    reconnectTimeoutId = setTimeout(() => {
      window.location.reload();
    }, HMR_RELOAD_DELAY_MS);
  };

  ws.onerror = (error) => {
    console.error('[HMR] WebSocket error:', error);
  };

  window.addEventListener('beforeunload', () => {
    if (reconnectTimeoutId !== null) {
      clearTimeout(reconnectTimeoutId);
      reconnectTimeoutId = null;
    }
    ws.close();
  });

  function handleUpdate(update) {
    if (!update.path) {
      console.warn('[HMR] Update message missing path');
      return;
    }

    if (update.path.endsWith('.css')) {
      console.log('[HMR] CSS changed, refreshing stylesheet');
      refreshTailwindCSS();
      return;
    }

    updateJS(update.path);
  }

  function refreshTailwindCSS() {
    const link = document.getElementById('vf-tailwind-css');
    if (!link) return;
    link.href = '/_vf_styles/styles.css?t=' + Date.now();
    console.log('[HMR] Tailwind CSS link refreshed');
  }

  function notifyStudioUpdateCompleted() {
    if (window.parent === window) return;
    try {
      window.parent.postMessage({ action: 'appUpdated', url: window.location.href }, '*');
    } catch (e) { /* ignore */ }
  }

  function updateJS(path) {
    try {
      const cacheBusted = path + (path.includes('?') ? '&' : '?') + 't=' + Date.now();
      const script = document.createElement('script');
      script.type = 'module';
      script.crossOrigin = 'anonymous';

      script.onload = () => {
        // Clear component cache to ensure fresh components are loaded
        window.__veryfrontClearComponentCache?.();

        // Refresh Tailwind CSS (JS changes may introduce new classes)
        refreshTailwindCSS();

        // Re-render the page with fresh components
        // This is more reliable than React Refresh for our architecture
        // where layouts and pages are dynamically loaded
        if (window.__veryfrontRenderPage) {
          window.__veryfrontRenderPage(window.location.pathname);
          notifyStudioUpdateCompleted();
          return;
        }

        if (reactRefreshEnabled && window.$RefreshRuntime$?.performReactRefresh) {
          window.$RefreshRuntime$.performReactRefresh();
          return;
        }

        window.location.reload();
      };

      script.onerror = () => {
        window.location.reload();
      };

      script.src = cacheBusted;
      document.head.appendChild(script);
    } catch (error) {
      console.error('[HMR] Failed to update JS module:', error);
      window.location.reload();
    }
  }

  function setupReactRefresh() {
    if (typeof window.$RefreshRuntime$ === 'undefined') return;
    window.$RefreshRuntime$.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
  }`;
}
