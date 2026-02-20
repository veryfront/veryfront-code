/****
 * HMR Script Generators
 * Generates client-side JavaScript for Hot Module Replacement (HMR)
 */

/**
 * Shared HMR JS update logic used by both local dev and preview HMR scripts.
 *
 * How it works:
 * 1. Client sets HMR timestamp and re-renders page
 * 2. Page module is requested with ?t=timestamp
 * 3. Server sees ?t= param and adds timestamp to ALL local imports in the response
 * 4. This cascades: every nested import also gets the timestamp
 * 5. Browser fetches fresh versions of all modules in the dependency tree
 *
 * This is Vite-style server-side import rewriting for proper HMR.
 */
function getUpdateJSFunction(logPrefix: string): string {
  return `
  function refreshTailwindCSS() {
    const link = document.getElementById('vf-tailwind-css');
    if (!link) return;
    link.href = '/_vf_styles/styles.css?t=' + Date.now();
    console.log('${logPrefix} Tailwind CSS link refreshed');
  }

  async function updateJS(path) {
    console.log('${logPrefix} Updating JS module:', path);

    try {
      const timestamp = Date.now();

      // Set HMR refresh timestamp - this will be added to all module requests
      // The server propagates this timestamp to ALL nested imports
      if (window.__veryfrontSetHMRRefreshTimestamp) {
        window.__veryfrontSetHMRRefreshTimestamp(timestamp);
        console.log('${logPrefix} Refresh timestamp set:', timestamp);
      }

      // Clear component cache for fresh components
      if (window.__veryfrontClearComponentCache) {
        window.__veryfrontClearComponentCache();
        console.log('${logPrefix} Component cache cleared');
      }

      // Refresh Tailwind CSS (new classes may be needed from JS changes)
      refreshTailwindCSS();

      // Re-render the page with fresh modules
      // The server will add ?t=timestamp to all imports in the module response
      if (window.__veryfrontRenderPage) {
        console.log('${logPrefix} Re-rendering page with fresh modules');
        await window.__veryfrontRenderPage(window.location.pathname);
        console.log('${logPrefix} Page re-render complete');
        notifyStudio();
      } else {
        console.log('${logPrefix} No __veryfrontRenderPage, falling back to reload');
        notifyStudioAndReload();
      }

      // Clear timestamp after render for normal SPA caching
      if (window.__veryfrontSetHMRRefreshTimestamp) {
        window.__veryfrontSetHMRRefreshTimestamp(null);
        console.log('${logPrefix} Refresh timestamp cleared');
      }
    } catch (error) {
      console.error('${logPrefix} Failed to update JS module:', error);
      if (window.__veryfrontSetHMRRefreshTimestamp) {
        window.__veryfrontSetHMRRefreshTimestamp(null);
      }
      notifyStudioAndReload();
    }
  }`;
}

/**
 * HMR WebSocket client script for local development.
 * Connects to /_ws and handles reload/update messages with debouncing.
 */
export function getHMRScript(_port: number): string {
  return `
// Veryfront HMR WebSocket Client

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

// Connect to HMR WebSocket via /_ws endpoint (works in both direct and proxy mode)
// The server's HMRHandler handles WebSocket upgrades at this path
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = protocol + '//' + window.location.host + '/_ws';
const ws = new WebSocket(wsUrl);
let wasConnected = false;
let reconnectTimeoutId = null;

ws.onopen = () => {
  wasConnected = true;
  if (reconnectTimeoutId !== null) {
    clearTimeout(reconnectTimeoutId);
    reconnectTimeoutId = null;
  }
  console.log('[HMR] Connected to ' + wsUrl);
};

ws.onmessage = (event) => {
  try {
    const data = JSON.parse(event.data);
    switch (data.type) {
      case 'connected':
        console.log('[HMR] Server acknowledged connection');
        break;
      case 'ping':
        console.log('[HMR] Ping received, sending pong');
        try { ws.send(JSON.stringify({ type: 'pong' })); } catch (e) { /* ignore */ }
        break;
      case 'pong':
        break;
      case 'reload':
        console.log('[HMR] Reload requested');
        notifyStudioAndReload();
        break;
      case 'update':
        console.log('[HMR] Update received for:', data.path);
        handleUpdate(data);
        break;
      default:
        console.log('[HMR] Unknown message type:', data.type);
    }
  } catch (e) {
    console.error('[HMR] Failed to parse message', e);
  }
};

ws.onclose = () => {
  if (!wasConnected) {
    console.log('[HMR] Connection failed - HMR server may not be running');
  } else {
    // Reconnect after delay if connection was established
    console.log('[HMR] Connection closed, will reload in 2s...');
    reconnectTimeoutId = setTimeout(() => window.location.reload(), 2000);
  }
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

// Debounce HMR updates to prevent flashing from rapid-fire cache population
let pendingUpdates = [];
let updateDebounceTimer = null;
const UPDATE_DEBOUNCE_MS = 300;

async function handleUpdate(update) {
  if (!update.path) {
    console.warn('[HMR] Update message missing path');
    return;
  }
  // CSS changes trigger full reload to get fresh Tailwind compilation
  if (update.path.endsWith('.css')) {
    console.log('[HMR] CSS changed, reloading page');
    notifyStudioAndReload();
    return;
  }

  // Debounce JS updates - batch rapid updates into single re-render
  pendingUpdates.push(update.path);

  if (updateDebounceTimer) {
    clearTimeout(updateDebounceTimer);
  }

  updateDebounceTimer = setTimeout(async () => {
    const paths = pendingUpdates;
    pendingUpdates = [];
    updateDebounceTimer = null;

    if (paths.length === 1) {
      console.log('[HMR] Processing single update:', paths[0]);
    } else {
      console.log('[HMR] Processing', paths.length, 'batched updates');
    }

    // Single re-render for all batched updates
    await updateJS(paths[0]);
  }, UPDATE_DEBOUNCE_MS);
}
${getUpdateJSFunction("[HMR]")}

function notifyStudio() {
  if (window.parent !== window) {
    try {
      window.parent.postMessage({ action: 'appUpdated', url: window.location.href }, '*');
    } catch (e) { /* ignore */ }
  }
}

function notifyStudioAndReload() {
  notifyStudio();
  setTimeout(() => window.location.reload(), 100);
}

window.__veryfrontHMRWebSocket = ws;
    `.trim();
}

/**
 * HMR Runtime script — handles CSS-only updates via WebSocket.
 * Full page reloads are handled by the inline HMR runtime (templates.ts).
 */
export function getHMRRuntime(): string {
  return `
// Veryfront HMR Runtime
// NOTE: This runtime only handles CSS updates. Full page reloads are handled
// by the inline HMR runtime (templates.ts) to avoid duplicate reloads.
(function() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = protocol + '//' + window.location.host + '/_ws';
  const ws = new WebSocket(wsUrl);
  let wasConnected = false;

  ws.onopen = () => {
    wasConnected = true;
    console.log('[HMR Runtime] Connected to ' + wsUrl);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleHMRMessage(data);
    } catch (e) {
      console.error('[HMR Runtime] Failed to parse message', e);
    }
  };

  ws.onerror = (error) => {
    console.error('[HMR Runtime] WebSocket error', error);
  };

  ws.onclose = () => {
    if (!wasConnected) {
      console.log('[HMR Runtime] Connection failed - HMR server may not be running');
    }
    // Don't reload on close - inline HMR runtime handles reconnection
  };

  function handleHMRMessage(data) {
    switch (data.type) {
      case 'reload':
        // Don't reload - inline HMR runtime handles this
        console.log('[HMR Runtime] Reload signal (handled by inline runtime)');
        break;
      case 'css-update':
        updateCSS(data.path);
        break;
      case 'connected':
        console.log('[HMR Runtime] Server acknowledged connection');
        break;
      case 'ping':
        try { ws.send(JSON.stringify({ type: 'pong' })); } catch (e) { /* ignore */ }
        break;
      case 'pong':
        break;
      default:
        console.log('[HMR Runtime] Message:', data.type);
    }
  }

  function updateCSS(path) {
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
      const href = link.getAttribute('href');
      if (href && href.includes(path)) {
        const newHref = href.split('?')[0] + '?t=' + Date.now();
        link.setAttribute('href', newHref);
        console.log('[HMR Runtime] Updated CSS:', path);
      }
    }
  }
})();
    `.trim();
}

/**
 * Preview HMR client script — connects to /_ws with exponential backoff
 * reconnection, keepalive pings, and debounced updates.
 */
export function getPreviewHMRScript(): string {
  return `
// Veryfront Preview HMR Client
// Connects to /_ws WebSocket and handles true HMR updates

(function() {
  console.log('[Preview HMR] Script loaded at', new Date().toISOString());
  console.log('[Preview HMR] Location:', window.location.href);
  console.log('[Preview HMR] Global functions available:', {
    __veryfrontRenderPage: typeof window.__veryfrontRenderPage,
    __veryfrontSetHMRRefreshTimestamp: typeof window.__veryfrontSetHMRRefreshTimestamp,
    __veryfrontClearComponentCache: typeof window.__veryfrontClearComponentCache
  });

  // Notify Studio that the app is ready (clears loading indicator)
  if (window.parent !== window) {
    try {
      console.log('[Preview HMR] Notifying Studio of initial load');
      window.parent.postMessage({
        action: 'appUpdated',
        isInitialLoad: true,
        url: window.location.href
      }, '*');
    } catch (e) {
      console.warn('[Preview HMR] Failed to notify Studio:', e.message);
    }
  }

  // Determine WebSocket URL (same host, use wss for https)
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = protocol + '//' + window.location.host + '/_ws';

  let ws = null;
  let reconnectAttempts = 0;
  const baseDelay = 1000; // Start with 1s
  const maxDelay = 10000; // Cap at 10s
  const pingIntervalMs = 30000; // Keepalive ping every 30s
  const pongTimeoutMs = 90000; // Reconnect if no pong for 90s
  let pingIntervalId = null;
  let lastPongAt = Date.now();

  // Exponential backoff with jitter
  function getReconnectDelay() {
    const delay = Math.min(baseDelay * Math.pow(1.5, reconnectAttempts), maxDelay);
    const jitter = delay * 0.2 * Math.random(); // Add up to 20% jitter
    return Math.round(delay + jitter);
  }

  function connect() {
    if (reconnectAttempts > 0) {
      console.log('[Preview HMR] Reconnecting... (attempt ' + (reconnectAttempts + 1) + ')');
    }

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[Preview HMR] Connected to', wsUrl);
      if (reconnectAttempts > 0) {
        console.log('[Preview HMR] Reconnected successfully after ' + reconnectAttempts + ' attempts');
      }
      reconnectAttempts = 0;
      lastPongAt = Date.now();
      if (pingIntervalId !== null) {
        clearInterval(pingIntervalId);
      }
      pingIntervalId = setInterval(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const sincePong = Date.now() - lastPongAt;
        if (sincePong > pongTimeoutMs) {
          console.warn('[Preview HMR] Pong timeout (' + sincePong + 'ms), reconnecting...');
          try { ws.close(); } catch { /* SILENT: WebSocket already closed */ }
          return;
        }
        try {
          ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        } catch (e) {
          console.warn('[Preview HMR] Failed to send ping:', e && e.message ? e.message : e);
        }
      }, pingIntervalMs);
    };

    ws.onmessage = (event) => {
      console.log('[Preview HMR] Raw message received:', event.data);
      try {
        const data = JSON.parse(event.data);
        console.log('[Preview HMR] Parsed message:', JSON.stringify(data, null, 2));

        switch (data.type) {
          case 'pong':
            lastPongAt = Date.now();
            break;
          case 'ping':
            console.log('[Preview HMR] Ping received from server, sending pong');
            try { ws.send(JSON.stringify({ type: 'pong' })); } catch (e) { /* ignore */ }
            lastPongAt = Date.now();
            break;
          case 'update':
            console.log('[Preview HMR] Handling update for path:', data.path);
            handleUpdate(data);
            break;
          case 'reload':
            console.log('[Preview HMR] Full reload requested by server');
            notifyStudioAndReload();
            break;
          case 'connected':
            console.log('[Preview HMR] Server acknowledged connection, clientId:', data.clientId || 'none');
            break;
          default:
            console.log('[Preview HMR] Unknown message type:', data.type, data);
        }
      } catch (e) {
        console.error('[Preview HMR] Failed to parse message:', e, 'Raw:', event.data);
      }
    };

    ws.onerror = () => {
      // Log more details about the error
      console.error('[Preview HMR] WebSocket error:', {
        url: wsUrl,
        readyState: ws ? ws.readyState : 'N/A',
        attempt: reconnectAttempts + 1
      });
    };

    ws.onclose = (event) => {
      if (pingIntervalId !== null) {
        clearInterval(pingIntervalId);
        pingIntervalId = null;
      }
      reconnectAttempts++;
      const delay = getReconnectDelay();
      console.log('[Preview HMR] Connection closed (code: ' + event.code + ', reason: ' + (event.reason || 'none') + ')');
      console.log('[Preview HMR] Reconnecting in ' + Math.round(delay / 1000) + 's...');
      setTimeout(connect, delay);
    };
  }

  // Debounce HMR updates to prevent flashing from rapid-fire cache population
  let pendingUpdates = [];
  let updateDebounceTimer = null;
  const UPDATE_DEBOUNCE_MS = 300;

  async function handleUpdate(update) {
    console.log('[Preview HMR] handleUpdate called with:', JSON.stringify(update));
    if (!update.path) {
      console.warn('[Preview HMR] Update message missing path');
      return;
    }

    console.log('[Preview HMR] Processing update for:', update.path);

    // CSS changes trigger full reload to get fresh Tailwind compilation
    if (update.path.endsWith('.css')) {
      console.log('[Preview HMR] CSS changed, reloading page');
      notifyStudioAndReload();
      return;
    }

    // Debounce JS updates - batch rapid updates into single re-render
    pendingUpdates.push(update.path);

    if (updateDebounceTimer) {
      clearTimeout(updateDebounceTimer);
    }

    updateDebounceTimer = setTimeout(async () => {
      const paths = pendingUpdates;
      pendingUpdates = [];
      updateDebounceTimer = null;

      if (paths.length === 1) {
        console.log('[Preview HMR] Processing single update:', paths[0]);
      } else {
        console.log('[Preview HMR] Processing', paths.length, 'batched updates');
      }

      // Single re-render for all batched updates
      await updateJS(paths[0]);
    }, UPDATE_DEBOUNCE_MS);
  }
${getUpdateJSFunction("[Preview HMR]")}

  function notifyStudio() {
    console.log('[Preview HMR] notifyStudio called, isInIframe:', window.parent !== window);
    if (window.parent !== window) {
      try {
        const message = {
          action: 'appUpdated',
          isInitialLoad: false,
          url: window.location.href
        };
        console.log('[Preview HMR] Posting message to Studio:', JSON.stringify(message));
        window.parent.postMessage(message, '*');
        console.log('[Preview HMR] Message posted successfully');
      } catch (e) {
        console.warn('[Preview HMR] Failed to notify Studio:', e.message);
      }
    }
  }

  function notifyStudioAndReload() {
    console.log('[Preview HMR] notifyStudioAndReload called - will reload in 100ms');
    notifyStudio();
    // Small delay to let Studio know, then reload
    setTimeout(() => {
      console.log('[Preview HMR] Reloading page now');
      window.location.reload();
    }, 100);
  }

  // Start connection
  connect();

  // Expose for debugging
  window.__veryfrontPreviewHMR = { getSocket: () => ws };
})();
    `.trim();
}
