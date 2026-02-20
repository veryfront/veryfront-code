export function generateHMRClientTemplate(
  port: number,
  hostname: string,
  reloadDelay: number,
): string {
  return `const HMR_PORT = ${port};
  const HMR_RECONNECT_DELAY_MS = ${reloadDelay};
  const host = window.location.hostname || '${hostname}';
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = wsProtocol + '//' + host + ':${port}';
  let ws = null;
  let reactRefreshEnabled = false;
  let reconnectTimeoutId = null;
  let wasConnected = false; // Track if connection was ever established
  let isUnloading = false;
  let lastReloadAt = 0;
  const RELOAD_THROTTLE_MS = 2000;

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

  function getRenderPath() {
    return window.location.pathname + window.location.search + window.location.hash;
  }

  function notifyStudioUpdateCompleted() {
    if (window.parent === window) return;
    try {
      window.parent.postMessage({ action: 'appUpdated', url: window.location.href }, '*');
    } catch (e) { /* ignore */ }
  }

  function notifyStudioAndReload(reason) {
    const now = Date.now();
    if (now - lastReloadAt < RELOAD_THROTTLE_MS) {
      console.warn('[HMR] Reload throttled:', reason || 'unknown');
      return;
    }
    lastReloadAt = now;

    if (reason) {
      console.warn('[HMR] Reloading page:', reason);
    }

    notifyStudioUpdateCompleted();
    window.location.reload();
  }

  function connect() {
    ws = new WebSocket(wsUrl);
    window.__veryfrontHMRWebSocket = ws;

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
          case 'connected': {
            reactRefreshEnabled = message.reactRefresh || false;
            if (reactRefreshEnabled) setupReactRefresh();
            break;
          }
          case 'ping':
            try { ws.send(JSON.stringify({ type: 'pong' })); } catch (e) { /* ignore */ }
            break;
          case 'pong':
            break;
          case 'update':
            handleUpdate(message);
            break;
          case 'reload':
            notifyStudioAndReload('server-reload');
            break;
          default:
            console.warn('[HMR] Unknown message type:', message);
        }
      } catch (error) {
        console.error('[HMR] Failed to process message:', error);
      }
    };

    ws.onclose = () => {
      // Avoid reconnect/reload loops on unload
      if (isUnloading) return;

      // Keep trying to reconnect instead of hard-reloading immediately.
      if (!wasConnected) {
        console.warn('[HMR] Connection failed - HMR server may not be running');
      }

      if (reconnectTimeoutId !== null) return;
      reconnectTimeoutId = setTimeout(() => {
        reconnectTimeoutId = null;
        connect();
      }, HMR_RECONNECT_DELAY_MS);
    };

    ws.onerror = (error) => {
      console.error('[HMR] WebSocket error:', error);
    };
  }

  window.addEventListener('beforeunload', () => {
    isUnloading = true;
    if (reconnectTimeoutId !== null) {
      clearTimeout(reconnectTimeoutId);
      reconnectTimeoutId = null;
    }
    try {
      ws && ws.close();
    } catch {
      // Ignore close errors
    }
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
          window.__veryfrontRenderPage(getRenderPath());
          notifyStudioUpdateCompleted();
          return;
        }

        if (reactRefreshEnabled && window.$RefreshRuntime$?.performReactRefresh) {
          window.$RefreshRuntime$.performReactRefresh();
          return;
        }

        notifyStudioAndReload('missing-renderer');
      };

      script.onerror = () => {
        notifyStudioAndReload('module-load-error');
      };

      script.src = cacheBusted;
      document.head.appendChild(script);
    } catch (error) {
      console.error('[HMR] Failed to update JS module:', error);
      notifyStudioAndReload('update-failed');
    }
  }

  function setupReactRefresh() {
    if (typeof window.$RefreshRuntime$ === 'undefined') return;
    window.$RefreshRuntime$.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
  }

  connect();`;
}
