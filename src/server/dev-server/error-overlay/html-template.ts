import { type ErrorInfo, formatErrorType } from "./error-formatter.ts";
import { escapeHtml } from "#veryfront/html/html-escape.ts";

/** Base delay multiplied by attempt count for WebSocket reconnection */
const WS_RECONNECT_BASE_DELAY_MS = 1_000;

/** Maximum delay between WebSocket reconnection attempts */
const WS_RECONNECT_MAX_DELAY_MS = 5_000;

/** Maximum number of WebSocket reconnection attempts before giving up */
const WS_MAX_RECONNECT_ATTEMPTS = 10;

/** JSON.stringify that escapes `<` to prevent `</script>` breaking inline scripts */
function jsonForScript(value: unknown): string {
  const json = JSON.stringify(value);
  // JSON.stringify(undefined) returns undefined (not a string)
  return json === undefined ? "undefined" : json.replace(/</g, "\\u003c");
}

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
      const existing = document.getElementById('veryfront-error-overlay');
      if (existing) existing.remove();

      const errorType = escapeHtml(errorInfo.type || 'unknown');
      const errorName = escapeHtml((errorInfo.error && errorInfo.error.name) || 'Error');
      const errorMessage = escapeHtml((errorInfo.error && errorInfo.error.message) || 'Unknown error');
      const errorFile = errorInfo.file ? escapeHtml(String(errorInfo.file)) : '';
      const errorLine = errorInfo.line ? escapeHtml(String(errorInfo.line)) : '';
      const errorColumn = errorInfo.column ? escapeHtml(String(errorInfo.column)) : '';
      const errorSuggestion = errorInfo.suggestion ? escapeHtml(errorInfo.suggestion) : '';
      const errorStack = errorInfo.error && errorInfo.error.stack ? escapeHtml(errorInfo.error.stack) : '';

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
              background: #fff;
              border: none;
              color: #000;
              padding: 10px 20px;
              border-radius: 9999px;
              cursor: pointer;
              font-family: inherit;
            ">
              Dismiss
            </button>
            \${window.__VF_PROJECT_SLUG__ ? \`
            <button type="button" id="vf-fix-btn-runtime" style="
              background: transparent;
              border: 1px solid rgba(255, 255, 255, 0.2);
              color: rgba(255, 255, 255, 0.7);
              padding: 10px 20px;
              border-radius: 9999px;
              cursor: pointer;
              font-family: inherit;
              margin-left: 8px;
            ">
              Fix in Veryfront
            </button>
            \` : ''}
          </div>
        </div>
      \`;

      document.body.appendChild(overlay);

      // Notify Studio of runtime error
      if (window.parent !== window) {
        try {
          window.parent.postMessage({
            action: 'runtimeError',
            hasError: true,
            errors: [{
              type: 'error',
              message: (errorInfo.error && errorInfo.error.message) || 'Unknown error',
              stack: (errorInfo.error && errorInfo.error.stack) || undefined,
              file: errorInfo.file ? String(errorInfo.file) : undefined,
              line: errorInfo.line ? Number(errorInfo.line) : undefined,
              column: errorInfo.column ? Number(errorInfo.column) : undefined
            }]
          }, '*');
        } catch (e) { /* postMessage may fail */ }
      }

      if (window.__VF_PROJECT_SLUG__) {
        var fixBtn = document.getElementById('vf-fix-btn-runtime');
        if (fixBtn) {
          fixBtn.addEventListener('click', function() {
            var rawName = (errorInfo.error && errorInfo.error.name) || 'Error';
            var rawMessage = (errorInfo.error && errorInfo.error.message) || 'Unknown error';
            var rawFile = errorInfo.file ? String(errorInfo.file) : null;
            var rawLine = errorInfo.line ? String(errorInfo.line) : null;
            var rawColumn = errorInfo.column ? String(errorInfo.column) : null;
            var loc = rawFile ? rawFile + (rawLine ? ':' + rawLine : '') + (rawColumn ? ':' + rawColumn : '') : null;
            var prompt = 'Find and fix the following error' +
              (loc ? ' in ' + loc : '') +
              ':\\n\\n' + rawName + ': ' + rawMessage;
            if (window.parent !== window) {
              window.parent.postMessage({ action: 'chatMessage', prompt: prompt }, '*');
            } else {
              window.open('https://veryfront.com/projects/' + window.__VF_PROJECT_SLUG__ + '?prompt=' + encodeURIComponent(prompt));
            }
          });
        }
      }
    };

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

export function generateErrorHTML(
  errorInfo: ErrorInfo,
  suggestion?: string,
  projectSlug?: string,
): string {
  const errorType = escapeHtml(formatErrorType(errorInfo.type));
  const errorName = escapeHtml(errorInfo.error.name);
  const errorMessage = escapeHtml(errorInfo.error.message);
  const errorFile = errorInfo.file ? escapeHtml(errorInfo.file) : "";
  const errorLine = errorInfo.line ? escapeHtml(String(errorInfo.line)) : "";
  const errorColumn = errorInfo.column ? escapeHtml(String(errorInfo.column)) : "";
  const errorSuggestion = suggestion ? escapeHtml(suggestion) : "";
  const errorStack = errorInfo.error.stack ? escapeHtml(errorInfo.error.stack) : "";

  const fileSection = errorFile
    ? `
      <div class="error-file">
        File: ${errorFile}${errorLine ? `:${errorLine}` : ""}${errorColumn ? `:${errorColumn}` : ""}
      </div>
    `
    : "";

  const suggestionSection = errorSuggestion
    ? `
      <div class="suggestion">
        <div class="suggestion-title">Suggestion:</div>
        <div class="suggestion-text">${errorSuggestion}</div>
      </div>
    `
    : "";

  const stackSection = errorStack
    ? `
      <details class="stack-trace">
        <summary>Stack Trace</summary>
        <pre>${errorStack}</pre>
      </details>
    `
    : "";

  const fixButtonHtml = projectSlug
    ? `<button type="button" id="vf-fix-btn" class="btn btn-fix">Fix in Veryfront</button>`
    : "";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${errorType} Error - Veryfront</title>
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
    .btn {
      padding: 10px 20px;
      border-radius: 9999px;
      cursor: pointer;
      font-family: inherit;
      font-size: 14px;
      border: none;
    }
    .btn-dismiss {
      background: #fff;
      color: #000;
    }
    .btn-dismiss:hover {
      background: #e5e5e5;
    }
    .btn-fix {
      background: transparent;
      color: rgba(255, 255, 255, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.2);
      margin-left: 8px;
    }
    .btn-fix:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
      border-color: rgba(255, 255, 255, 0.4);
    }
  </style>
</head>
<body>
  <div class="error-container">
    <h1 class="error-header">${errorType} Error</h1>

    <div class="error-box">
      <div class="error-name">${errorName}</div>
      <div class="error-message">${errorMessage}</div>

      ${fileSection}
      ${suggestionSection}
      ${stackSection}
    </div>
    ${fixButtonHtml}
  </div>
  <script>${
    projectSlug
      ? `
    (function() {
      var slug = ${jsonForScript(projectSlug)};
      var errorName = ${jsonForScript(errorInfo.error.name)};
      var errorMessage = ${jsonForScript(errorInfo.error.message)};
      var errorFile = ${jsonForScript(errorInfo.file ?? null)};
      var errorLine = ${jsonForScript(errorInfo.line ?? null)};
      var errorColumn = ${jsonForScript(errorInfo.column ?? null)};
      var btn = document.getElementById('vf-fix-btn');
      if (btn) {
        btn.addEventListener('click', function() {
          var loc = errorFile ? errorFile + (errorLine ? ':' + errorLine : '') + (errorColumn ? ':' + errorColumn : '') : null;
          var prompt = 'Find and fix the following error' +
            (loc ? ' in ' + loc : '') +
            ':\\n\\n' + errorName + ': ' + errorMessage;
          if (window.parent !== window) {
            window.parent.postMessage({ action: 'chatMessage', prompt: prompt }, '*');
          } else {
            window.open('https://veryfront.com/projects/' + slug + '?prompt=' + encodeURIComponent(prompt));
          }
        });
      }
    })();`
      : ""
  }
    // Notify Studio (parent) that page has loaded with an error
    // This hides the loading spinner in Studio's preview iframe
    if (window.parent !== window) {
      try {
        window.parent.postMessage({
          action: 'appUpdated',
          isInitialLoad: true,
          hasError: true,
          url: window.location.href,
          errors: [{
            type: 'error',
            message: ${jsonForScript(errorInfo.error.message)},
            file: ${jsonForScript(errorInfo.file || undefined)},
            line: ${errorInfo.line ? String(errorInfo.line) : "undefined"},
            column: ${errorInfo.column ? String(errorInfo.column) : "undefined"}
          }]
        }, '*');
      } catch (e) { /* postMessage may fail in cross-origin iframes */ }
    }

    // HMR WebSocket for auto-refresh when error is fixed
    (function() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = protocol + '//' + window.location.host + '/_ws';
      let ws = null;
      let reconnectAttempts = 0;
      const maxReconnectAttempts = ${WS_MAX_RECONNECT_ATTEMPTS};

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
          } catch (e) { /* SILENT: malformed HMR message is non-fatal */ }
        };
        ws.onclose = () => {
          reconnectAttempts++;
          setTimeout(connect, Math.min(${WS_RECONNECT_BASE_DELAY_MS} * reconnectAttempts, ${WS_RECONNECT_MAX_DELAY_MS}));
        };
      }
      connect();
    })();
  </script>
</body>
</html>`;
}
