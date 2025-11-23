/**
 * HTML Template Generator
 * Generates HTML templates for error display
 */

import { type ErrorInfo, formatErrorType } from "./error-formatter.ts";

/**
 * Generates runtime script for browser error overlay
 */
export function generateRuntimeScript(): string {
  return `
    // Veryfront Error Overlay Runtime
    window.showErrorOverlay = function(errorInfo) {
      // Remove any existing overlay
      const existing = document.getElementById('veryfront-error-overlay');
      if (existing) {
        existing.remove();
      }

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
              \${errorInfo.type.charAt(0).toUpperCase() + errorInfo.type.slice(1)} Error
            </h1>

            <div style="
              background: #1a1a1a;
              border: 1px solid #333;
              border-radius: 4px;
              padding: 20px;
              margin: 20px 0;
            ">
              <div style="color: #ff6b6b; font-weight: bold; margin-bottom: 10px;">
                \${errorInfo.error.name}
              </div>
              <div style="color: #ccc; margin-bottom: 20px;">
                \${errorInfo.error.message}
              </div>

              \${errorInfo.file ? \`
                <div style="color: #666; margin-bottom: 10px;">
                  File: \${errorInfo.file}\${errorInfo.line ? \`:\${errorInfo.line}\` : ''}\${errorInfo.column ? \`:\${errorInfo.column}\` : ''}
                </div>
              \` : ''}

              \${errorInfo.suggestion ? \`
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
                    \${errorInfo.suggestion}
                  </div>
                </div>
              \` : ''}

              \${errorInfo.error.stack ? \`
                <details style="margin-top: 20px;">
                  <summary style="cursor: pointer; color: #666;">Stack Trace</summary>
                  <pre style="
                    color: #999;
                    margin-top: 10px;
                    overflow-x: auto;
                    font-size: 12px;
                  ">\${errorInfo.error.stack}</pre>
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
  const errorType = formatErrorType(errorInfo.type);

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
      <div class="error-name">${errorInfo.error.name}</div>
      <div class="error-message">${errorInfo.error.message}</div>

      ${
    errorInfo.file
      ? `
      <div class="error-file">
        File: ${errorInfo.file}${errorInfo.line ? `:${errorInfo.line}` : ""}${
        errorInfo.column ? `:${errorInfo.column}` : ""
      }
      </div>
    `
      : ""
  }

      ${
    suggestion
      ? `
      <div class="suggestion">
        <div class="suggestion-title">Suggestion:</div>
        <div class="suggestion-text">${suggestion}</div>
      </div>
    `
      : ""
  }

      ${
    errorInfo.error.stack
      ? `
      <details class="stack-trace">
        <summary>Stack Trace</summary>
        <pre>${errorInfo.error.stack}</pre>
      </details>
    `
      : ""
  }
    </div>
  </div>
</body>
</html>`;
}
