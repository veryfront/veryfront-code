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

  function getRenderPath() {
    return window.location.pathname + window.location.search + window.location.hash;
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
        const renderPath = getRenderPath();
        console.log('${logPrefix} Re-rendering page with fresh modules:', renderPath);
        await window.__veryfrontRenderPage(renderPath);
        console.log('${logPrefix} Page re-render complete');
        notifyStudio();
      } else {
        console.log('${logPrefix} No __veryfrontRenderPage, falling back to reload');
        notifyStudioAndReload('missing-renderer');
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
      notifyStudioAndReload('update-failed');
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

let ws = null;
let wasConnected = false;
let reconnectAttempts = 0;
let reconnectTimeoutId = null;
let isUnloading = false;
let lastReloadAt = 0;

const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 5000;
const RELOAD_THROTTLE_MS = 2000;

function getReconnectDelay() {
  return Math.min(
    RECONNECT_BASE_DELAY_MS * Math.pow(1.5, reconnectAttempts),
    RECONNECT_MAX_DELAY_MS,
  );
}

function notifyStudio() {
  if (window.parent !== window) {
    try {
      window.parent.postMessage({ action: 'appUpdated', url: window.location.href }, '*');
    } catch (e) { /* ignore */ }
  }
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

  notifyStudio();
  setTimeout(() => window.location.reload(), 100);
}

function scheduleReconnect() {
  if (isUnloading || reconnectTimeoutId !== null) return;

  reconnectAttempts++;
  const delay = getReconnectDelay();
  console.log('[HMR] Connection closed, reconnecting in ' + Math.round(delay / 1000) + 's...');

  reconnectTimeoutId = setTimeout(() => {
    reconnectTimeoutId = null;
    connect();
  }, delay);
}

function connect() {
  ws = new WebSocket(wsUrl);
  window.__veryfrontHMRWebSocket = ws;

  ws.onopen = () => {
    wasConnected = true;
    reconnectAttempts = 0;
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
          try { ws.send(JSON.stringify({ type: 'pong' })); } catch (e) { /* ignore */ }
          break;
        case 'pong':
          break;
        case 'reload':
          notifyStudioAndReload('server-reload');
          break;
        case 'update':
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
    if (isUnloading) return;

    if (!wasConnected) {
      console.log('[HMR] Connection failed - HMR server may not be running');
      scheduleReconnect();
      return;
    }

    scheduleReconnect();
  };

  ws.onerror = (error) => {
    console.error('[HMR] WebSocket error:', error);
  };
}

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
    notifyStudioAndReload('css-update');
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

    if (paths.length > 1) {
      console.log('[HMR] Processing', paths.length, 'batched updates');
    }

    // Single re-render for all batched updates
    await updateJS(paths[0]);
  }, UPDATE_DEBOUNCE_MS);
}
${getUpdateJSFunction("[HMR]")}

connect();

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
  const HMR_DEBUG = (() => {
    try {
      return window.localStorage.getItem('VERYFRONT_DEBUG_HMR') === '1';
    } catch {
      return false;
    }
  })();
  const dlog = (...args) => {
    if (HMR_DEBUG) console.log(...args);
  };

  // Notify Studio that the app is ready (clears loading indicator)
  if (window.parent !== window) {
    try {
      window.parent.postMessage({
        action: 'appUpdated',
        isInitialLoad: true,
        url: window.location.href
      }, '*');
    } catch {
      // Cross-origin frame access may fail
    }
  }

  // Determine WebSocket URL (same host, use wss for https)
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = protocol + '//' + window.location.host + '/_ws';

  let ws = null;
  let reconnectAttempts = 0;
  let reconnectTimerId = null;
  let isUnloading = false;
  const baseDelay = 1000;
  const maxDelay = 10000;
  const pingIntervalMs = 30000;
  const pongTimeoutMs = 90000;
  let pingIntervalId = null;
  let lastPongAt = Date.now();
  let lastReloadAt = 0;
  const RELOAD_THROTTLE_MS = 2000;

  function notifyStudio() {
    if (window.parent !== window) {
      try {
        window.parent.postMessage({
          action: 'appUpdated',
          isInitialLoad: false,
          url: window.location.href
        }, '*');
      } catch {
        // Cross-origin frame access may fail
      }
    }
  }

  function notifyStudioAndReload(reason) {
    const now = Date.now();
    if (now - lastReloadAt < RELOAD_THROTTLE_MS) {
      dlog('[Preview HMR] Reload throttled:', reason || 'unknown');
      return;
    }
    lastReloadAt = now;

    if (reason) {
      console.warn('[Preview HMR] Reloading page:', reason);
    }

    notifyStudio();
    setTimeout(() => window.location.reload(), 100);
  }

  // Exponential backoff with jitter
  function getReconnectDelay() {
    const delay = Math.min(baseDelay * Math.pow(1.5, reconnectAttempts), maxDelay);
    const jitter = delay * 0.2 * Math.random();
    return Math.round(delay + jitter);
  }

  function scheduleReconnect() {
    if (isUnloading || reconnectTimerId !== null) return;

    reconnectAttempts++;
    const delay = getReconnectDelay();
    dlog('[Preview HMR] Reconnecting in', delay, 'ms');

    reconnectTimerId = setTimeout(() => {
      reconnectTimerId = null;
      connect();
    }, delay);
  }

  function connect() {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      dlog('[Preview HMR] Connected to', wsUrl);
      reconnectAttempts = 0;
      lastPongAt = Date.now();
      if (reconnectTimerId !== null) {
        clearTimeout(reconnectTimerId);
        reconnectTimerId = null;
      }
      if (pingIntervalId !== null) {
        clearInterval(pingIntervalId);
      }
      pingIntervalId = setInterval(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const sincePong = Date.now() - lastPongAt;
        if (sincePong > pongTimeoutMs) {
          console.warn('[Preview HMR] Pong timeout, reconnecting...');
          try { ws.close(); } catch { /* ignore */ }
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
      try {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case 'pong':
            lastPongAt = Date.now();
            break;
          case 'ping':
            try { ws.send(JSON.stringify({ type: 'pong' })); } catch (e) { /* ignore */ }
            lastPongAt = Date.now();
            break;
          case 'update':
            handleUpdate(data);
            break;
          case 'reload':
            notifyStudioAndReload('server-reload');
            break;
          case 'connected':
            dlog('[Preview HMR] Server acknowledged connection');
            break;
          default:
            dlog('[Preview HMR] Unknown message type:', data.type);
        }
      } catch (e) {
        console.error('[Preview HMR] Failed to parse message:', e);
      }
    };

    ws.onerror = () => {
      dlog('[Preview HMR] WebSocket error', { readyState: ws ? ws.readyState : 'N/A' });
    };

    ws.onclose = () => {
      if (pingIntervalId !== null) {
        clearInterval(pingIntervalId);
        pingIntervalId = null;
      }
      if (isUnloading) return;
      scheduleReconnect();
    };
  }

  // Debounce HMR updates to prevent flashing from rapid-fire cache population
  let pendingUpdates = [];
  let updateDebounceTimer = null;
  const UPDATE_DEBOUNCE_MS = 300;

  async function handleUpdate(update) {
    if (!update.path) {
      console.warn('[Preview HMR] Update message missing path');
      return;
    }

    // CSS changes trigger full reload to get fresh Tailwind compilation
    if (update.path.endsWith('.css')) {
      notifyStudioAndReload('css-update');
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

      if (paths.length > 1) {
        dlog('[Preview HMR] Processing', paths.length, 'batched updates');
      }

      // Single re-render for all batched updates
      await updateJS(paths[0]);
    }, UPDATE_DEBOUNCE_MS);
  }
${getUpdateJSFunction("[Preview HMR]")}

  // Start connection
  connect();

  window.addEventListener('beforeunload', () => {
    isUnloading = true;
    if (reconnectTimerId !== null) {
      clearTimeout(reconnectTimerId);
      reconnectTimerId = null;
    }
    if (pingIntervalId !== null) {
      clearInterval(pingIntervalId);
      pingIntervalId = null;
    }
    try {
      ws && ws.close();
    } catch {
      // Ignore close errors
    }
  });

  // Expose for debugging
  window.__veryfrontPreviewHMR = { getSocket: () => ws, debug: HMR_DEBUG };
})();
    `.trim();
}
