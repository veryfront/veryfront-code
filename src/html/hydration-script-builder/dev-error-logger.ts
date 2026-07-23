import { buildNonceAttribute } from "../html-escape.ts";

export function generateDevErrorLoggerScript(nonce?: string): string {
  return `
  <!-- Client-side error logger -->
  <script${buildNonceAttribute(nonce)}>
    (function() {
      if (window.__veryfrontDevErrorLoggerInstalled === true) return;
      window.__veryfrontDevErrorLoggerInstalled = true;

      const MAX_LOG_POSTS = 100;
      const MAX_LOG_ARGS = 10;
      const MAX_LOG_TEXT_LENGTH = 512;
      const MAX_LOG_BODY_LENGTH = 16 * 1024;
      let remainingLogPosts = MAX_LOG_POSTS;

      const sanitizeLogText = (value) => {
        let text;
        if (value instanceof Error) {
          text = value.name + (value.message ? ': ' + value.message : '');
        } else if (typeof value === 'string') {
          text = value;
        } else if (value == null || ['number', 'boolean', 'bigint'].includes(typeof value)) {
          text = String(value);
        } else {
          text = Object.prototype.toString.call(value);
        }

        return text
          .replace(/(?:file:\\/\\/)?\\/(?:Users|home|var\\/folders)\\/[^\\s)\\]}'"]+/gi, '<REDACTED_PATH>')
          .replace(/[A-Za-z]:\\\\[^\\s)\\]}'"]+/g, '<REDACTED_PATH>')
          .replace(/([?&][^=\\s]+)=([^&\\s]+)/g, '$1=<REDACTED>')
          .replace(/\\b(Bearer)\\s+[^\\s]+/gi, '$1 <REDACTED>')
          .replace(/\\b(token|secret|password|api[_-]?key)\\s*[:=]\\s*[^\\s,;]+/gi, '$1=<REDACTED>')
          .slice(0, MAX_LOG_TEXT_LENGTH);
      };

      const sanitizeDetails = (details) => {
        const sanitized = {};
        for (const [key, value] of Object.entries(details || {}).slice(0, 16)) {
          if (Array.isArray(value)) {
            sanitized[key] = value.slice(0, MAX_LOG_ARGS).map(sanitizeLogText);
          } else if (typeof value === 'number' && Number.isFinite(value)) {
            sanitized[key] = value;
          } else if (typeof value === 'boolean' || value === null) {
            sanitized[key] = value;
          } else {
            sanitized[key] = sanitizeLogText(value);
          }
        }
        return sanitized;
      };

      const logToServer = (level, message, details) => {
        if (remainingLogPosts <= 0) return;
        remainingLogPosts--;

        try {
          const payload = {
            level: level === 'warn' ? 'warn' : level === 'info' ? 'info' : 'error',
            message: sanitizeLogText(message),
            details: sanitizeDetails(details),
            timestamp: new Date().toISOString()
          };
          let body = JSON.stringify(payload);
          if (body.length > MAX_LOG_BODY_LENGTH) {
            body = JSON.stringify({
              level: payload.level,
              message: payload.message,
              details: { truncated: true },
              timestamp: payload.timestamp
            });
          }

          fetch('/_veryfront/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body
          }).catch(() => {
            console.debug?.('[Veryfront] dev log POST failed');
          });
        } catch (_) { /* expected: fire-and-forget log, serialization errors ignored */ }
      };

      window.addEventListener('error', (event) => {
        logToServer('error', 'Uncaught error', {
          message: event.message,
          lineno: event.lineno,
          colno: event.colno,
          errorName: event.error instanceof Error ? event.error.name : 'UnknownError'
        });
      });

      window.addEventListener('unhandledrejection', (event) => {
        logToServer('error', 'Unhandled promise rejection', {
          reason: event.reason
        });
      });

      const origError = console.error;
      console.error = function(...args) {
        logToServer('error', 'Console error', { args: args.slice(0, MAX_LOG_ARGS) });
        origError.apply(console, args);
      };

      const origWarn = console.warn;
      console.warn = function(...args) {
        logToServer('warn', 'Console warning', { args: args.slice(0, MAX_LOG_ARGS) });
        origWarn.apply(console, args);
      };

      logToServer('info', 'Page loaded', {
        path: window.location.pathname
      });
    })();
  </script>`;
}
