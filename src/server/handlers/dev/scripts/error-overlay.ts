/****
 * Error Overlay Script Generator
 * Generates client-side JavaScript for the development error overlay UI
 */

/**
 * Error overlay that catches uncaught errors and unhandled promise rejections,
 * displaying them in a full-screen overlay with stack traces.
 */
export function getErrorOverlay(): string {
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
    closeButton.textContent = '\\u2715 Close';
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
