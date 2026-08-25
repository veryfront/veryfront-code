/****
 * HMR Script Generator
 * Generates client-side JavaScript for Hot Module Replacement (HMR)
 *
 * Single unified script for both local dev and preview modes.
 * Connects to /_ws WebSocket with exponential backoff reconnection,
 * keepalive pings, debounced updates, and CSS hot-swap.
 */

import { studioTargetOriginHelperSource } from "#veryfront/security/http/studio-origin-policy.ts";
import { PROJECT_STYLESHEET_IDS } from "#veryfront/html";

interface HMRScriptOptions {
  /** Log prefix for console messages */
  logPrefix: string;
}

/**
 * Shared JS update logic used by the HMR client.
 *
 * How it works:
 * 1. Client sets HMR timestamp and re-renders page
 * 2. Page module is requested with ?t=timestamp
 * 3. Server sees ?t= param and adds timestamp to ALL local imports in the response
 * 4. This cascades: every nested import also gets the timestamp
 * 5. Browser fetches fresh versions of all modules in the dependency tree
 */
function getUpdateJSFunction(logPrefix: string): string {
  const stylesheetIds = JSON.stringify(PROJECT_STYLESHEET_IDS);
  return `
  const PROJECT_STYLESHEET_IDS = ${stylesheetIds};
  let stylesheetUpdateQueue = Promise.resolve();

  function getProjectStylesheet() {
    for (const id of PROJECT_STYLESHEET_IDS) {
      const stylesheet = document.getElementById(id);
      if (stylesheet) return stylesheet;
    }
    return null;
  }

  function refreshStylesheets(changedPath) {
    // Try targeted stylesheet refresh first
    if (changedPath) {
      for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
        const href = link.getAttribute('href');
        if (href && href.includes(changedPath)) {
          link.setAttribute('href', href.split('?')[0] + '?t=' + Date.now());
          dlog('${logPrefix} Updated stylesheet:', changedPath);
          return true;
        }
      }
    }

    // Fall back to the generated project stylesheet.
    const projectStylesheet = getProjectStylesheet();
    if (projectStylesheet instanceof HTMLLinkElement) {
      projectStylesheet.href = '/_vf_styles/styles.css?t=' + Date.now();
      dlog('${logPrefix} Project stylesheet refreshed');
      return true;
    }
    return false;
  }

  async function swapProjectStylesheet(nextHref) {
    const current = getProjectStylesheet();
    if (!(current instanceof HTMLLinkElement) || !nextHref || !current.parentNode) {
      return false;
    }

    const nextUrl = new URL(nextHref, window.location.origin).toString();
    const currentHref = current.getAttribute('href');
    const currentUrl = currentHref ? new URL(currentHref, window.location.href).toString() : '';
    if (currentUrl === nextUrl) {
      return true;
    }

    const pending = current.cloneNode(false);
    if (!(pending instanceof HTMLLinkElement)) {
      return false;
    }

    pending.removeAttribute('id');
    pending.setAttribute('data-vf-stylesheet-pending', 'true');
    pending.href = nextHref;

    await new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        cleanup(new Error('stylesheet-timeout'));
      }, 5000);

      let settled = false;

      function cleanup(error) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        pending.removeEventListener('load', onLoad);
        pending.removeEventListener('error', onError);

        if (error) {
          pending.remove();
          reject(error);
          return;
        }

        pending.removeAttribute('data-vf-stylesheet-pending');
        pending.id = current.id;
        current.remove();
        resolve(true);
      }

      function onLoad() {
        cleanup(null);
      }

      function onError() {
        cleanup(new Error('stylesheet-load-failed'));
      }

      pending.addEventListener('load', onLoad, { once: true });
      pending.addEventListener('error', onError, { once: true });
      current.parentNode.insertBefore(pending, current.nextSibling);
    });

    return true;
  }

  function applyStyleUpdate(changedPath, styleHref) {
    const update = stylesheetUpdateQueue.then(() =>
      applyStyleUpdateNow(changedPath, styleHref)
    );
    stylesheetUpdateQueue = update.then(
      () => undefined,
      () => undefined,
    );
    return update;
  }

  async function applyStyleUpdateNow(changedPath, styleHref) {
    if (styleHref) {
      try {
        const swapped = await swapProjectStylesheet(styleHref);
        if (swapped) {
          dlog('${logPrefix} Swapped stylesheet:', styleHref);
          return true;
        }
      } catch (error) {
        dlog('${logPrefix} Failed to swap stylesheet:', error);
      }
    }

    return refreshStylesheets(changedPath) || refreshStylesheets();
  }

  function getRenderPath() {
    return window.location.pathname + window.location.search + window.location.hash;
  }

  async function updateJS(path, styleHref) {
    dlog('${logPrefix} Updating JS module:', path);

    try {
      const timestamp = Date.now();

      // Set HMR refresh timestamp - this will be added to all module requests
      // The server propagates this timestamp to ALL nested imports
      if (window.__veryfrontSetHMRRefreshTimestamp) {
        window.__veryfrontSetHMRRefreshTimestamp(timestamp);
      }

      // Clear component cache for fresh components
      if (window.__veryfrontClearComponentCache) {
        window.__veryfrontClearComponentCache();
      }

      // Refresh generated project CSS (source changes may introduce new candidates).
      await applyStyleUpdate(path, styleHref);

      // Re-render the page with fresh modules
      if (window.__veryfrontRenderPage) {
        const renderPath = getRenderPath();
        await window.__veryfrontRenderPage(renderPath);
        notifyStudio();
      } else {
        notifyStudioAndReload('missing-renderer');
      }

      // Clear timestamp after render for normal SPA caching
      if (window.__veryfrontSetHMRRefreshTimestamp) {
        window.__veryfrontSetHMRRefreshTimestamp(null);
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

function generateHMRClient(opts: HMRScriptOptions): string {
  const { logPrefix } = opts;

  const debugPreamble = `
  const HMR_DEBUG = (() => {
    try { return window.localStorage.getItem('VERYFRONT_DEBUG_HMR') === '1'; } catch (_) { return false; }
  })();
  const dlog = (...args) => { if (HMR_DEBUG) console.log(...args); };`;

  return `
// Veryfront HMR Client (${logPrefix})
(function() {${debugPreamble}

  ${studioTargetOriginHelperSource()}

  // Notify Studio that the app is ready (clears loading indicator)
  if (window.parent !== window) {
    try {
      window.parent.postMessage({
        action: 'appUpdated',
        isInitialLoad: true,
        url: window.location.href
      }, vfStudioTargetOrigin());
    } catch (_) { /* cross-origin iframe - expected */ }
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = protocol + '//' + window.location.host + '/_ws';

  let ws = null;
  let reconnectAttempts = 0;
  let reconnectTimerId = null;
  let isUnloading = false;
  let lastReloadAt = 0;

  const RECONNECT_BASE_DELAY_MS = 500;
  const RECONNECT_MAX_DELAY_MS = 5_000;
  const RELOAD_THROTTLE_MS = 2_000;
  const PING_INTERVAL_MS = 30_000;
  const PONG_TIMEOUT_MS = 90_000;
  const reloadPage = typeof window.__veryfrontHMRReload === 'function'
    ? window.__veryfrontHMRReload
    : () => window.location.reload();

  let pingIntervalId = null;
  let lastPongAt = Date.now();

  function getReconnectDelay() {
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(1.5, reconnectAttempts), RECONNECT_MAX_DELAY_MS);
    const jitter = delay * 0.2 * Math.random();
    return Math.round(delay + jitter);
  }

  function notifyStudio() {
    if (window.parent === window) return;
    try {
      window.parent.postMessage(
        { action: 'appUpdated', url: window.location.href },
        vfStudioTargetOrigin(),
      );
    } catch (_) { /* expected: cross-origin iframe */ }
  }

  function notifyStudioAndReload(reason) {
    const now = Date.now();
    if (now - lastReloadAt < RELOAD_THROTTLE_MS) {
      dlog('${logPrefix} Reload throttled:', reason || 'unknown');
      return;
    }
    lastReloadAt = now;

    if (reason) dlog('${logPrefix} Reloading page:', reason);
    notifyStudio();
    reloadPage();
  }

  function scheduleReconnect() {
    if (isUnloading || reconnectTimerId !== null) return;

    reconnectAttempts++;
    const delay = getReconnectDelay();
    dlog('${logPrefix} Reconnecting in ' + Math.round(delay / 1000) + 's...');

    reconnectTimerId = setTimeout(() => {
      reconnectTimerId = null;
      connect();
    }, delay);
  }

  function startPing() {
    if (pingIntervalId !== null) clearInterval(pingIntervalId);
    lastPongAt = Date.now();
    pingIntervalId = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastPongAt > PONG_TIMEOUT_MS) {
        dlog('${logPrefix} Pong timeout, reconnecting...');
        try { ws.close(); } catch (_) { /* expected: socket already closed */ }
        return;
      }
      try { ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() })); }
      catch (e) { dlog('${logPrefix} Ping failed:', e && e.message ? e.message : e); }
    }, PING_INTERVAL_MS);
  }

  function stopPing() {
    if (pingIntervalId !== null) {
      clearInterval(pingIntervalId);
      pingIntervalId = null;
    }
  }

  function connect() {
    ws = new WebSocket(wsUrl);
    window.__veryfrontHMRWebSocket = ws;

    ws.onopen = () => {
      reconnectAttempts = 0;
      if (reconnectTimerId !== null) {
        clearTimeout(reconnectTimerId);
        reconnectTimerId = null;
      }
      startPing();
      dlog('${logPrefix} Connected to ' + wsUrl);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case 'connected':
            dlog('${logPrefix} Server acknowledged connection');
            break;
          case 'pong':
            lastPongAt = Date.now();
            break;
          case 'ping':
            lastPongAt = Date.now();
            try { ws.send(JSON.stringify({ type: 'pong' })); } catch (_) { /* expected: socket closed */ }
            break;
          case 'update':
            handleUpdate(data);
            break;
          case 'reload':
            notifyStudioAndReload('server-reload');
            break;
          default:
            dlog('${logPrefix} Unknown message type:', data.type);
        }
      } catch (e) {
        console.error('${logPrefix} Failed to parse message:', e);
      }
    };

    ws.onerror = () => {
      dlog('${logPrefix} WebSocket error');
    };

    ws.onclose = () => {
      stopPing();
      if (isUnloading) return;
      scheduleReconnect();
    };
  }

  // Debounce updates to prevent flashing from rapid-fire changes
  let pendingPaths = [];
  let pendingStyleHref = null;
  let updateDebounceTimer = null;
  const UPDATE_DEBOUNCE_MS = 150;

  async function handleUpdate(update) {
    if (!update.path) {
      dlog('${logPrefix} Update message missing path');
      return;
    }

    // CSS changes: hot-swap stylesheet without full page reload
    if (update.path.endsWith('.css')) {
      const didRefresh = await applyStyleUpdate(update.path, update.styleHref);
      if (!didRefresh) {
        notifyStudioAndReload('css-update-no-stylesheet');
        return;
      }
      notifyStudio();
      return;
    }

    // Debounce JS updates — batch rapid updates into single re-render
    pendingPaths.push(update.path);
    if (typeof update.styleHref === 'string') {
      pendingStyleHref = update.styleHref;
    }

    if (updateDebounceTimer) clearTimeout(updateDebounceTimer);

    updateDebounceTimer = setTimeout(async () => {
      const paths = pendingPaths;
      const styleHref = pendingStyleHref;
      pendingPaths = [];
      pendingStyleHref = null;
      updateDebounceTimer = null;

      if (paths.length > 1) {
        dlog('${logPrefix} Processing ' + paths.length + ' batched updates');
      }

      // Single re-render handles all paths (server propagates timestamps to all imports)
      if (paths.length > 0) await updateJS(paths[0], styleHref);
    }, UPDATE_DEBOUNCE_MS);
  }
${getUpdateJSFunction(logPrefix)}

  connect();

  window.addEventListener('beforeunload', () => {
    isUnloading = true;
    stopPing();
    if (reconnectTimerId !== null) {
      clearTimeout(reconnectTimerId);
      reconnectTimerId = null;
    }
    try { ws && ws.close(); } catch (_) { /* expected: socket already closed */ }
  }, { once: true });

  window.__veryfrontHMR = { getSocket: () => ws };
})();
  `.trim();
}

/**
 * HMR script for local development.
 * Routine lifecycle messages are available when VERYFRONT_DEBUG_HMR=1.
 */
export function getHMRScript(_port: number): string {
  return generateHMRClient({ logPrefix: "[HMR]" });
}

/**
 * HMR script for preview mode.
 * Routine lifecycle messages are available when VERYFRONT_DEBUG_HMR=1.
 */
export function getPreviewHMRScript(): string {
  return generateHMRClient({ logPrefix: "[Preview HMR]" });
}
