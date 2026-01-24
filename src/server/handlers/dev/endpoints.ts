/****
 * Development Endpoints Handler
 * Handles HMR runtime, error overlay, and other dev-specific endpoints
 */

import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { HTTP_OK, PRIORITY_HIGH_DEV } from "#veryfront/utils/constants/index.ts";

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

export class DevEndpointsHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "DevEndpointsHandler",
    priority: PRIORITY_HIGH_DEV as HandlerPriority,
    patterns: [
      { pattern: "/_veryfront/hmr-runtime.js", exact: true },
      { pattern: "/_veryfront/error-overlay.js", exact: true },
      { pattern: "/_veryfront/dev-loader.js", exact: true },
      { pattern: "/_veryfront/hmr.js", exact: true },
      { pattern: "/_veryfront/hydrate.js", exact: true },
      { pattern: "/_veryfront/preview-hmr.js", exact: true },
    ],
    enabled: (ctx) => ctx.requestContext?.isLocalDev || ctx.requestContext?.mode === "preview",
  };

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) {
      return Promise.resolve(this.continue());
    }

    const url = new URL(req.url);
    const script = this.getScriptForPath(url.pathname, url);

    if (!script) {
      return Promise.resolve(this.continue());
    }

    const response = this.createResponseBuilder(ctx).withCache("no-cache").javascript(
      script,
      HTTP_OK,
    );
    return Promise.resolve(this.respond(response));
  }

  private getScriptForPath(pathname: string, url: URL): string | null {
    switch (pathname) {
      case "/_veryfront/hmr.js": {
        const port = url.searchParams.get("port") ?? "3000";
        return this.getHMRScript(parseInt(port, 10));
      }
      case "/_veryfront/hydrate.js": {
        const slug = url.searchParams.get("slug") ?? "";
        return this.getHydrateScript(slug);
      }
      case "/_veryfront/hmr-runtime.js":
        return this.getHMRRuntime();
      case "/_veryfront/error-overlay.js":
        return this.getErrorOverlay();
      case "/_veryfront/dev-loader.js":
        return this.getDevLoader();
      case "/_veryfront/preview-hmr.js":
        return this.getPreviewHMRScript();
      default:
        return null;
    }
  }

  private getHMRScript(_port: number): string {
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

async function handleUpdate(update) {
  if (!update.path) {
    console.warn('[HMR] Update message missing path');
    return;
  }
  if (update.path.endsWith('.css')) {
    await updateCSS(update.path);
    return;
  }
  await updateJS(update.path);
}

async function updateCSS(path) {
  console.log('[HMR] Updating CSS:', path);

  // Try to update linked stylesheets
  document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
    try {
      const url = new URL(link.href);
      if (url.pathname === path || url.pathname.includes(path)) {
        const newUrl = new URL(link.href);
        newUrl.searchParams.set('t', Date.now().toString());
        link.href = newUrl.toString();
        console.log('[HMR] CSS link updated:', path);
      }
    } catch (error) {
      console.error('[HMR] Failed to update CSS link:', error);
    }
  });

  // Try to update inline Tailwind CSS style tag
  const tailwindStyle = document.getElementById('vf-tailwind-css');
  if (tailwindStyle && (path.includes('globals.css') || path.endsWith('.css'))) {
    try {
      // Fetch fresh compiled CSS from globals endpoint
      const response = await fetch('/_vf_styles/globals.css?t=' + Date.now());
      if (response.ok) {
        const newCSS = await response.text();
        tailwindStyle.textContent = newCSS;
        console.log('[HMR] Inline Tailwind CSS updated');
      }
    } catch (error) {
      console.error('[HMR] Failed to fetch fresh CSS:', error);
    }
  }

  notifyStudio();
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

  private getHydrateScript(slug: string): string {
    return `
// Veryfront Hydration Script
import { hydrate } from '/_veryfront/rsc/client.js';
hydrate('${slug}', {
  ssr: true
});
    `.trim();
  }

  private getHMRRuntime(): string {
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

  private getErrorOverlay(): string {
    return `
// Veryfront Error Overlay
(function() {
  let overlayElement = null;

  window.addEventListener('error', (event) => {
    showError({
      message: event.error?.message || event.message,
      stack: event.error?.stack || '',
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    showError({
      message: 'Unhandled Promise Rejection: ' + event.reason,
      stack: event.reason?.stack || ''
    });
  });

  function showError(error) {
    if (!overlayElement) {
      createOverlay();
    }

    const errorHtml = \`
      <div style="margin-bottom: 20px;">
        <div style="color: #ff5555; font-size: 18px; font-weight: bold; margin-bottom: 10px;">
          \${escapeHtml(error.message)}
        </div>
        \${error.filename ? \`<div style="color: #8b8b8b; margin-bottom: 5px;">\${escapeHtml(error.filename)}:\${error.lineno}:\${error.colno}</div>\` : ''}
        \${error.stack ? \`<pre style="color: #cccccc; font-size: 12px; overflow-x: auto;">\${escapeHtml(error.stack)}</pre>\` : ''}
      </div>
    \`;

    overlayElement.innerHTML = errorHtml + overlayElement.innerHTML;
    overlayElement.style.display = 'block';
  }

  function createOverlay() {
    overlayElement = document.createElement('div');
    overlayElement.style.cssText = \`
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.9);
      color: white;
      padding: 20px;
      font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
      font-size: 14px;
      overflow: auto;
      z-index: 999999;
      display: none;
    \`;

    const closeButton = document.createElement('button');
    closeButton.textContent = '✕ Close';
    closeButton.style.cssText = \`
      position: fixed;
      top: 20px;
      right: 20px;
      background: #ff5555;
      color: white;
      border: none;
      padding: 10px 20px;
      font-size: 14px;
      cursor: pointer;
      border-radius: 4px;
    \`;
    closeButton.onclick = () => {
      overlayElement.style.display = 'none';
      overlayElement.innerHTML = '';
    };

    overlayElement.appendChild(closeButton);
    document.body.appendChild(overlayElement);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
})();
    `.trim();
  }

  private getDevLoader(): string {
    return `
// Veryfront Dev Loader
console.log('[Veryfront] Development mode active');

// Load HMR if enabled
if (window.__HMR_ENABLED__) {
  const script = document.createElement('script');
  script.src = '/_veryfront/hmr-runtime.js';
  document.head.appendChild(script);
}

// Load error overlay
const errorScript = document.createElement('script');
errorScript.src = '/_veryfront/error-overlay.js';
document.head.appendChild(errorScript);
    `.trim();
  }

  private getPreviewHMRScript(): string {
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
  const maxReconnectAttempts = 20;
  const baseDelay = 1000; // Start with 1s
  const maxDelay = 30000; // Cap at 30s

  // Exponential backoff with jitter
  function getReconnectDelay() {
    const delay = Math.min(baseDelay * Math.pow(1.5, reconnectAttempts), maxDelay);
    const jitter = delay * 0.2 * Math.random(); // Add up to 20% jitter
    return Math.round(delay + jitter);
  }

  function connect() {
    if (reconnectAttempts >= maxReconnectAttempts) {
      console.warn('[Preview HMR] Max reconnection attempts (' + maxReconnectAttempts + ') reached. Live updates disabled.');
      console.warn('[Preview HMR] Refresh the page to re-enable live updates.');
      return;
    }

    if (reconnectAttempts > 0) {
      console.log('[Preview HMR] Reconnecting... (attempt ' + (reconnectAttempts + 1) + '/' + maxReconnectAttempts + ')');
    }

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[Preview HMR] Connected to', wsUrl);
      if (reconnectAttempts > 0) {
        console.log('[Preview HMR] Reconnected successfully after ' + reconnectAttempts + ' attempts');
      }
      reconnectAttempts = 0;
    };

    ws.onmessage = (event) => {
      console.log('[Preview HMR] Raw message received:', event.data);
      try {
        const data = JSON.parse(event.data);
        console.log('[Preview HMR] Parsed message:', JSON.stringify(data, null, 2));

        switch (data.type) {
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
      reconnectAttempts++;
      const delay = getReconnectDelay();
      console.log('[Preview HMR] Connection closed (code: ' + event.code + ', reason: ' + (event.reason || 'none') + ')');
      console.log('[Preview HMR] Reconnecting in ' + Math.round(delay / 1000) + 's...');
      setTimeout(connect, delay);
    };
  }

  async function handleUpdate(update) {
    console.log('[Preview HMR] handleUpdate called with:', JSON.stringify(update));
    if (!update.path) {
      console.warn('[Preview HMR] Update message missing path');
      return;
    }

    console.log('[Preview HMR] Processing update for:', update.path);
    console.log('[Preview HMR] Current global functions state:', {
      __veryfrontRenderPage: typeof window.__veryfrontRenderPage,
      __veryfrontSetHMRRefreshTimestamp: typeof window.__veryfrontSetHMRRefreshTimestamp,
      __veryfrontClearComponentCache: typeof window.__veryfrontClearComponentCache
    });

    // Handle CSS updates without full reload
    if (update.path.endsWith('.css')) {
      console.log('[Preview HMR] CSS update detected, calling updateCSS');
      updateCSS(update.path);
      notifyStudio();
      return;
    }

    // Use smart HMR: clear component cache and re-render without full reload
    // This is faster than full page reload and preserves client-side state
    console.log('[Preview HMR] JS update detected, calling updateJS');
    await updateJS(update.path);
  }

  async function updateCSS(path) {
    console.log('[Preview HMR] updateCSS called with path:', path);
    let updated = false;

    // Try to update linked stylesheets
    const links = document.querySelectorAll('link[rel="stylesheet"]');
    console.log('[Preview HMR] Found', links.length, 'stylesheet links');
    for (const link of links) {
      try {
        const url = new URL(link.href);
        console.log('[Preview HMR] Checking stylesheet:', url.pathname);
        if (url.pathname === path || url.pathname.includes(path)) {
          const newUrl = new URL(link.href);
          newUrl.searchParams.set('t', Date.now().toString());
          link.href = newUrl.toString();
          console.log('[Preview HMR] CSS link updated:', path, '→', newUrl.toString());
          updated = true;
        }
      } catch (error) {
        console.error('[Preview HMR] Failed to update CSS link:', error);
      }
    }

    // Try to update inline Tailwind CSS style tag
    const tailwindStyle = document.getElementById('vf-tailwind-css');
    console.log('[Preview HMR] Tailwind style element found:', !!tailwindStyle);
    if (tailwindStyle && (path.includes('globals.css') || path.endsWith('.css'))) {
      try {
        // Fetch fresh compiled CSS from globals endpoint
        const cssUrl = '/_vf_styles/globals.css?t=' + Date.now();
        console.log('[Preview HMR] Fetching fresh CSS from:', cssUrl);
        const response = await fetch(cssUrl);
        console.log('[Preview HMR] CSS fetch response:', response.status, response.statusText);
        if (response.ok) {
          const newCSS = await response.text();
          console.log('[Preview HMR] CSS fetched, length:', newCSS.length);
          tailwindStyle.textContent = newCSS;
          console.log('[Preview HMR] Inline Tailwind CSS updated');
          updated = true;
        }
      } catch (error) {
        console.error('[Preview HMR] Failed to fetch fresh CSS:', error);
      }
    }

    // Fallback: if nothing was updated, do full reload
    if (!updated) {
      console.log('[Preview HMR] No matching stylesheet for ' + path + ', reloading page');
      notifyStudioAndReload();
    } else {
      console.log('[Preview HMR] CSS update complete');
    }
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
}
