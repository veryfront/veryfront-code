/**
 * Development Endpoints Handler
 * Handles HMR runtime, error overlay, and other dev-specific endpoints
 */

import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { HTTP_OK, PRIORITY_HIGH_DEV } from "@veryfront/core/constants/index.ts";
import { HMR_CLIENT_RELOAD_DELAY_MS } from "@veryfront/utils/constants/hmr.ts";

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
    ],
    enabled: (ctx) => ctx.mode === "development", // Only in dev mode
  };

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (!this.shouldHandle(req, ctx)) {
      return Promise.resolve(this.continue());
    }

    const builder = this.createResponseBuilder(ctx);

    // HMR script (external module to avoid CSP issues)
    if (pathname === "/_veryfront/hmr.js") {
      const port = url.searchParams.get("port") || "3000";
      const script = this.getHMRScript(parseInt(port, 10));
      const response = builder
        .withCache("no-cache")
        .javascript(script, HTTP_OK);
      return Promise.resolve(this.respond(response));
    }

    // Hydrate script (external module to avoid CSP issues)
    if (pathname === "/_veryfront/hydrate.js") {
      const slug = url.searchParams.get("slug") || "";
      const script = this.getHydrateScript(slug);
      const response = builder
        .withCache("no-cache")
        .javascript(script, HTTP_OK);
      return Promise.resolve(this.respond(response));
    }

    // HMR runtime
    if (pathname === "/_veryfront/hmr-runtime.js") {
      const script = this.getHMRRuntime();
      const response = builder
        .withCache("no-cache")
        .javascript(script, HTTP_OK);
      return Promise.resolve(this.respond(response));
    }

    // Error overlay
    if (pathname === "/_veryfront/error-overlay.js") {
      const script = this.getErrorOverlay();
      const response = builder
        .withCache("no-cache")
        .javascript(script, HTTP_OK);
      return Promise.resolve(this.respond(response));
    }

    // Dev loader
    if (pathname === "/_veryfront/dev-loader.js") {
      const script = this.getDevLoader();
      const response = builder
        .withCache("no-cache")
        .javascript(script, HTTP_OK);
      return Promise.resolve(this.respond(response));
    }

    return Promise.resolve(this.continue());
  }

  private getHMRScript(port: number): string {
    const reloadDelay = HMR_CLIENT_RELOAD_DELAY_MS;
    return `
// Veryfront HMR WebSocket Client
const indicator = document.createElement('div');
indicator.className = 'dev-indicator';
indicator.textContent = 'Development Mode';
document.body.appendChild(indicator);

const ws = new WebSocket('ws://localhost:${port}/_ws');
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'reload') {
    location.reload();
  }
};
ws.onclose = () => {
  setTimeout(() => location.reload(), ${reloadDelay});
};

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
(function() {
  const ws = new WebSocket('ws://localhost:' + (window.__HMR_PORT__ || 3001));

  ws.onopen = () => {
    console.log('[HMR] Connected');
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleHMRMessage(data);
    } catch (e) {
      console.error('[HMR] Failed to parse message', e);
    }
  };

  ws.onerror = (error) => {
    console.error('[HMR] WebSocket error', error);
  };

  ws.onclose = () => {
    console.log('[HMR] Connection closed. Attempting reconnect...');
    setTimeout(() => location.reload(), 2000);
  };

  function handleHMRMessage(data) {
    switch (data.type) {
      case 'reload':
        console.log('[HMR] Reloading page');
        location.reload();
        break;
      case 'css-update':
        updateCSS(data.path);
        break;
      case 'connected':
        console.log('[HMR] Server acknowledged connection');
        break;
      default:
        console.log('[HMR] Unknown message type:', data.type);
    }
  }

  function updateCSS(path) {
    const links = document.querySelectorAll('link[rel="stylesheet"]');
    links.forEach(link => {
      const href = link.getAttribute('href');
      if (href && href.includes(path)) {
        const newHref = href.split('?')[0] + '?t=' + Date.now();
        link.setAttribute('href', newHref);
        console.log('[HMR] Updated CSS:', path);
      }
    });
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
}
