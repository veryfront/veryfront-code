/**
 * Development Endpoints Handler
 * Handles HMR runtime, error overlay, and other dev-specific endpoints
 */

import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { HTTP_OK, PRIORITY_HIGH_DEV } from "@veryfront/core/constants/index.ts";

export class DevEndpointsHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "DevEndpointsHandler",
    priority: PRIORITY_HIGH_DEV as HandlerPriority, // HIGH priority in dev mode
    patterns: [
      { pattern: "/_veryfront/hmr-runtime.js", exact: true },
      { pattern: "/_veryfront/error-overlay.js", exact: true },
      { pattern: "/_veryfront/dev-loader.js", exact: true },
      { pattern: "/_veryfront/hmr.js", exact: true },
      { pattern: "/_veryfront/hydrate.js", exact: true },
      { pattern: "/_veryfront/preview-hmr.js", exact: true },
    ],
    // Enable in dev mode OR preview mode (for live updates)
    enabled: (ctx) => ctx.mode === "development" || ctx.proxyEnvironment === "preview",
  };

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) {
      return Promise.resolve(this.continue());
    }

    const url = new URL(req.url);
    const pathname = url.pathname;
    const script = this.getScriptForPath(pathname, url);

    if (!script) {
      return Promise.resolve(this.continue());
    }

    const response = this.createResponseBuilder(ctx)
      .withCache("no-cache")
      .javascript(script, HTTP_OK);
    return Promise.resolve(this.respond(response));
  }

  /**
   * Get the script content for a given pathname.
   * Returns null if pathname is not a known dev endpoint.
   */
  private getScriptForPath(pathname: string, url: URL): string | null {
    switch (pathname) {
      case "/_veryfront/hmr.js": {
        const port = url.searchParams.get("port") || "3000";
        return this.getHMRScript(parseInt(port, 10));
      }
      case "/_veryfront/hydrate.js": {
        const slug = url.searchParams.get("slug") || "";
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
    // HMR port is detected at runtime: dev server port + 1
    // This ensures correct port regardless of project config differences
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

// HMR WebSocket server runs on dev server port + 1
// Detect at runtime to handle projects with different config.dev.port values
const devPort = parseInt(window.location.port, 10) || 3001;
const hmrPort = devPort + 1;
const host = window.location.hostname || 'localhost';
const ws = new WebSocket('ws://' + host + ':' + hmrPort + '/');
let wasConnected = false;
let reconnectTimeoutId = null;

ws.onopen = () => {
  wasConnected = true;
  if (reconnectTimeoutId !== null) {
    clearTimeout(reconnectTimeoutId);
    reconnectTimeoutId = null;
  }
  console.log('[HMR] Connected to port ' + hmrPort);
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

function handleUpdate(update) {
  if (!update.path) {
    console.warn('[HMR] Update message missing path');
    return;
  }
  if (update.path.endsWith('.css')) {
    updateCSS(update.path);
    return;
  }
  updateJS(update.path);
}

function updateCSS(path) {
  console.log('[HMR] Updating CSS:', path);
  document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
    try {
      const url = new URL(link.href);
      if (url.pathname === path || url.pathname.includes(path)) {
        const newUrl = new URL(link.href);
        newUrl.searchParams.set('t', Date.now().toString());
        link.href = newUrl.toString();
        console.log('[HMR] CSS updated:', path);
      }
    } catch (error) {
      console.error('[HMR] Failed to update CSS link:', error);
    }
  });
  notifyStudio();
}

function updateJS(path) {
  console.log('[HMR] Updating JS module:', path);
  try {
    const cacheBusted = path + (path.includes('?') ? '&' : '?') + 't=' + Date.now();
    const script = document.createElement('script');
    script.type = 'module';
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      // Clear component cache to ensure fresh components are loaded
      if (window.__veryfrontClearComponentCache) {
        window.__veryfrontClearComponentCache();
        console.log('[HMR] Component cache cleared');
      }
      // Re-render the page with fresh components
      if (window.__veryfrontRenderPage) {
        console.log('[HMR] Re-rendering page');
        window.__veryfrontRenderPage(window.location.pathname);
        notifyStudio();
      } else {
        // Fall back to full reload if re-render function not available
        console.log('[HMR] No __veryfrontRenderPage, falling back to reload');
        notifyStudioAndReload();
      }
    };
    script.onerror = () => {
      console.log('[HMR] Module load failed, falling back to reload');
      notifyStudioAndReload();
    };
    script.src = cacheBusted;
    document.head.appendChild(script);
  } catch (error) {
    console.error('[HMR] Failed to update JS module:', error);
    notifyStudioAndReload();
  }
}

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
  const devPort = parseInt(window.location.port, 10) || 3001;
  const hmrPort = devPort + 1;
  const host = window.location.hostname || 'localhost';
  const ws = new WebSocket('ws://' + host + ':' + hmrPort + '/');
  let wasConnected = false;

  ws.onopen = () => {
    wasConnected = true;
    console.log('[HMR Runtime] Connected to port ' + hmrPort);
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

  /**
   * Preview HMR script for cloud preview mode.
   * Implements true HMR with module cache clearing and re-rendering,
   * matching the local dev server behavior. Falls back to full reload
   * when HMR functions aren't available.
   */
  private getPreviewHMRScript(): string {
    return `
// Veryfront Preview HMR Client
// Connects to /_ws WebSocket and handles true HMR updates

(function() {
  // Notify Studio that the app is ready (clears loading indicator)
  if (window.parent !== window) {
    try {
      window.parent.postMessage({
        action: 'appUpdated',
        isInitialLoad: true,
        url: window.location.href
      }, '*');
    } catch (e) { /* postMessage may fail in cross-origin iframes */ }
  }

  // Determine WebSocket URL (same host, use wss for https)
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = protocol + '//' + window.location.host + '/_ws';

  let ws = null;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 10;
  const reconnectDelay = 2000;

  function connect() {
    if (reconnectAttempts >= maxReconnectAttempts) {
      console.log('[Preview HMR] Max reconnection attempts reached');
      return;
    }

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[Preview HMR] Connected to', wsUrl);
      reconnectAttempts = 0;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case 'update':
            handleUpdate(data);
            break;
          case 'reload':
            console.log('[Preview HMR] Full reload requested');
            notifyStudioAndReload();
            break;
          case 'connected':
            console.log('[Preview HMR] Server acknowledged connection');
            break;
          default:
            console.log('[Preview HMR] Unknown message type:', data.type);
        }
      } catch (e) {
        console.error('[Preview HMR] Failed to parse message', e);
      }
    };

    ws.onerror = (error) => {
      console.error('[Preview HMR] WebSocket error', error);
    };

    ws.onclose = () => {
      console.log('[Preview HMR] Connection closed, reconnecting...');
      reconnectAttempts++;
      setTimeout(connect, reconnectDelay);
    };
  }

  function handleUpdate(update) {
    if (!update.path) {
      console.warn('[Preview HMR] Update message missing path');
      return;
    }

    console.log('[Preview HMR] Update received for:', update.path);

    // Handle CSS updates without full reload
    if (update.path.endsWith('.css')) {
      updateCSS(update.path);
      notifyStudio();
      return;
    }

    // Handle JS/TSX/MDX updates
    updateJS(update.path);
  }

  function updateCSS(path) {
    console.log('[Preview HMR] Updating CSS:', path);
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
      try {
        const url = new URL(link.href);
        if (url.pathname === path || url.pathname.includes(path)) {
          const newUrl = new URL(link.href);
          newUrl.searchParams.set('t', Date.now().toString());
          link.href = newUrl.toString();
          console.log('[Preview HMR] CSS updated:', path);
        }
      } catch (error) {
        console.error('[Preview HMR] Failed to update CSS link:', error);
      }
    }
  }

  function updateJS(path) {
    console.log('[Preview HMR] Updating JS module:', path);
    try {
      // Load the changed module with cache busting to get fresh code
      const cacheBusted = path + (path.includes('?') ? '&' : '?') + 't=' + Date.now();
      const script = document.createElement('script');
      script.type = 'module';
      script.crossOrigin = 'anonymous';

      script.onload = () => {
        console.log('[Preview HMR] Module loaded, applying update');
        // Clear component cache to ensure fresh components are loaded
        if (window.__veryfrontClearComponentCache) {
          window.__veryfrontClearComponentCache();
          console.log('[Preview HMR] Component cache cleared');
        }

        // Re-render the page with fresh components
        if (window.__veryfrontRenderPage) {
          console.log('[Preview HMR] Re-rendering page');
          window.__veryfrontRenderPage(window.location.pathname);
          notifyStudio();
        } else {
          // Fall back to full reload if re-render function not available
          console.log('[Preview HMR] No __veryfrontRenderPage, falling back to reload');
          notifyStudioAndReload();
        }
      };

      script.onerror = () => {
        console.log('[Preview HMR] Module load failed, falling back to reload');
        notifyStudioAndReload();
      };

      script.src = cacheBusted;
      document.head.appendChild(script);
    } catch (error) {
      console.error('[Preview HMR] Failed to update JS module:', error);
      notifyStudioAndReload();
    }
  }

  function notifyStudio() {
    if (window.parent !== window) {
      try {
        window.parent.postMessage({
          action: 'appUpdated',
          isInitialLoad: false,
          url: window.location.href
        }, '*');
      } catch (e) { /* ignore */ }
    }
  }

  function notifyStudioAndReload() {
    notifyStudio();
    // Small delay to let Studio know, then reload
    setTimeout(() => window.location.reload(), 100);
  }

  // Start connection
  connect();

  // Expose for debugging
  window.__veryfrontPreviewHMR = { getSocket: () => ws };
})();
    `.trim();
  }
}
