/**
 * HTML Template Generator
 * Generates HTML templates for error display
 */

import { type ErrorInfo, formatErrorType } from "./error-formatter.ts";
import { escapeHtml } from "#veryfront/html/html-escape.ts";

/**
 * Generates runtime script for browser error overlay
 */
export function generateRuntimeScript(): string {
  return `
    // Veryfront Error Overlay Runtime

    // Escape HTML to prevent XSS (client-side)
    function escapeHtml(str) {
      if (typeof str !== 'string') return String(str);
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    window.showErrorOverlay = function(errorInfo) {
      // Remove any existing overlay
      const existing = document.getElementById('veryfront-error-overlay');
      if (existing) {
        existing.remove();
      }

      // Safely extract and escape error info
      const errorType = escapeHtml(errorInfo.type || 'unknown');
      const errorName = escapeHtml((errorInfo.error && errorInfo.error.name) || 'Error');
      const errorMessage = escapeHtml((errorInfo.error && errorInfo.error.message) || 'Unknown error');
      const errorFile = errorInfo.file ? escapeHtml(String(errorInfo.file)) : '';
      const errorLine = errorInfo.line ? escapeHtml(String(errorInfo.line)) : '';
      const errorColumn = errorInfo.column ? escapeHtml(String(errorInfo.column)) : '';
      const errorSuggestion = errorInfo.suggestion ? escapeHtml(errorInfo.suggestion) : '';
      const errorStack = errorInfo.error && errorInfo.error.stack
        ? escapeHtml(errorInfo.error.stack)
        : '';

      // Create error display
      const overlay = document.createElement('div');
      overlay.id = 'veryfront-error-overlay';
      overlay.innerHTML = \`
        <div style="
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.9);
          color: white;
          font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
          font-size: 14px;
          padding: 20px;
          overflow: auto;
          z-index: 999999;
        ">
          <div style="max-width: 800px; margin: 0 auto;">
            <h1 style="color: #ff6b6b; font-size: 24px; margin-bottom: 10px;">
              \${errorType.charAt(0).toUpperCase() + errorType.slice(1)} Error
            </h1>

            <div style="
              background: #1a1a1a;
              border: 1px solid #333;
              border-radius: 4px;
              padding: 20px;
              margin: 20px 0;
            ">
              <div style="color: #ff6b6b; font-weight: bold; margin-bottom: 10px;">
                \${errorName}
              </div>
              <div style="color: #ccc; margin-bottom: 20px;">
                \${errorMessage}
              </div>

              \${errorFile ? \`
                <div style="color: #666; margin-bottom: 10px;">
                  File: \${errorFile}\${errorLine ? \`:\${errorLine}\` : ''}\${errorColumn ? \`:\${errorColumn}\` : ''}
                </div>
              \` : ''}

              \${errorSuggestion ? \`
                <div style="
                  background: #2a2a2a;
                  border-left: 3px solid #4fc3f7;
                  padding: 10px;
                  margin-top: 20px;
                ">
                  <div style="color: #4fc3f7; font-weight: bold; margin-bottom: 5px;">
                    Suggestion:
                  </div>
                  <div style="color: #ccc;">
                    \${errorSuggestion}
                  </div>
                </div>
              \` : ''}

              \${errorStack ? \`
                <details style="margin-top: 20px;">
                  <summary style="cursor: pointer; color: #666;">Stack Trace</summary>
                  <pre style="
                    color: #999;
                    margin-top: 10px;
                    overflow-x: auto;
                    font-size: 12px;
                  ">\${errorStack}</pre>
                </details>
              \` : ''}
            </div>

            <button type="button" onclick="document.getElementById('veryfront-error-overlay').remove()" style="
              background: #333;
              border: 1px solid #555;
              color: #ccc;
              padding: 8px 16px;
              border-radius: 4px;
              cursor: pointer;
              font-family: inherit;
            ">
              Dismiss
            </button>
          </div>
        </div>
      \`;

      document.body.appendChild(overlay);
    };

    // Catch unhandled errors
    window.addEventListener('error', (event) => {
      window.showErrorOverlay({
        type: 'runtime',
        error: event.error || new Error(event.message),
        file: event.filename,
        line: event.lineno,
        column: event.colno,
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      window.showErrorOverlay({
        type: 'runtime',
        error: new Error(event.reason),
      });
    });
  `;
}

/**
 * Generates full HTML page for error display
 */
export function generateErrorHTML(errorInfo: ErrorInfo, suggestion?: string): string {
  const errorType = escapeHtml(formatErrorType(errorInfo.type));
  const errorName = escapeHtml(errorInfo.error.name);
  const errorMessage = escapeHtml(errorInfo.error.message);
  const errorFile = errorInfo.file ? escapeHtml(errorInfo.file) : "";
  const errorLine = errorInfo.line ? escapeHtml(String(errorInfo.line)) : "";
  const errorColumn = errorInfo.column ? escapeHtml(String(errorInfo.column)) : "";
  const errorSuggestion = suggestion ? escapeHtml(suggestion) : "";
  const errorStack = errorInfo.error.stack ? escapeHtml(errorInfo.error.stack) : "";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Build Error - Veryfront</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      background: #0a0a0a;
      color: #fff;
      font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
      font-size: 14px;
    }
    .error-container {
      max-width: 800px;
      margin: 0 auto;
    }
    .error-header {
      color: #ff6b6b;
      font-size: 24px;
      margin-bottom: 20px;
    }
    .error-box {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 4px;
      padding: 20px;
      margin: 20px 0;
    }
    .error-name {
      color: #ff6b6b;
      font-weight: bold;
      margin-bottom: 10px;
    }
    .error-message {
      color: #ccc;
      margin-bottom: 20px;
    }
    .error-file {
      color: #666;
      margin-bottom: 10px;
    }
    .suggestion {
      background: #2a2a2a;
      border-left: 3px solid #4fc3f7;
      padding: 10px;
      margin-top: 20px;
    }
    .suggestion-title {
      color: #4fc3f7;
      font-weight: bold;
      margin-bottom: 5px;
    }
    .suggestion-text {
      color: #ccc;
    }
    .stack-trace {
      margin-top: 20px;
    }
    .stack-trace summary {
      cursor: pointer;
      color: #666;
    }
    .stack-trace pre {
      color: #999;
      margin-top: 10px;
      overflow-x: auto;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="error-container">
    <h1 class="error-header">${errorType} Error</h1>

    <div class="error-box">
      <div class="error-name">${errorName}</div>
      <div class="error-message">${errorMessage}</div>

      ${
    errorFile
      ? `
      <div class="error-file">
        File: ${errorFile}${errorLine ? `:${errorLine}` : ""}${errorColumn ? `:${errorColumn}` : ""}
      </div>
    `
      : ""
  }

      ${
    errorSuggestion
      ? `
      <div class="suggestion">
        <div class="suggestion-title">Suggestion:</div>
        <div class="suggestion-text">${errorSuggestion}</div>
      </div>
    `
      : ""
  }

      ${
    errorStack
      ? `
      <details class="stack-trace">
        <summary>Stack Trace</summary>
        <pre>${errorStack}</pre>
      </details>
    `
      : ""
  }
    </div>
  </div>
  <script>
    // Notify Studio (parent) that page has loaded with an error
    // This hides the loading spinner in Studio's preview iframe
    if (window.parent !== window) {
      try {
        window.parent.postMessage({
          action: 'appUpdated',
          isInitialLoad: true,
          hasError: true,
          url: window.location.href
        }, '*');
      } catch (e) { /* postMessage may fail in cross-origin iframes */ }
    }

    // HMR WebSocket for auto-refresh when error is fixed
    (function() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = protocol + '//' + window.location.host + '/_ws';
      let ws = null;
      let reconnectAttempts = 0;
      const maxReconnectAttempts = 10;

      function connect() {
        if (reconnectAttempts >= maxReconnectAttempts) return;
        ws = new WebSocket(wsUrl);
        ws.onopen = () => { reconnectAttempts = 0; };
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'reload' || data.type === 'update') {
              window.location.reload();
            }
          } catch (e) {}
        };
        ws.onclose = () => {
          reconnectAttempts++;
          setTimeout(connect, Math.min(1000 * reconnectAttempts, 5000));
        };
      }
      connect();
    })();
  </script>
</body>
</html>`;
}
