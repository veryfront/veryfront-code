export function generateDevErrorLoggerScript(nonce?: string): string {
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";

  return `
  <!-- Client-side error logger -->
  <script${nonceAttr}>
    (function() {
      const logToServer = (level, message, details) => {
        try {
          fetch('/_veryfront/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              level,
              message,
              details,
              timestamp: new Date().toISOString()
            })
          }).catch(() => {});
        } catch {}
      };

      window.addEventListener('error', (event) => {
        logToServer('error', 'Uncaught error', {
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          error: event.error?.stack ?? null
        });
      });

      window.addEventListener('unhandledrejection', (event) => {
        logToServer('error', 'Unhandled promise rejection', {
          reason: event.reason,
          stack: event.reason?.stack
        });
      });

      const origError = console.error;
      console.error = function(...args) {
        logToServer('error', 'Console error', { args: args.map(String) });
        origError.apply(console, args);
      };

      const origWarn = console.warn;
      console.warn = function(...args) {
        logToServer('warn', 'Console warning', { args: args.map(String) });
        origWarn.apply(console, args);
      };

      logToServer('info', 'Page loaded', {
        url: window.location.href,
        userAgent: navigator.userAgent
      });
    })();
  </script>`;
}
