export function generateDevIndicatorScript(nonce?: string): string {
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  return `
  <script${nonceAttr}>
    (function() {
      if (sessionStorage.getItem('vf-dev-indicator-hidden')) return;

      const indicator = document.createElement('div');
      indicator.className = 'dev-indicator';

      const text = document.createElement('span');
      text.textContent = 'Development Mode';
      indicator.appendChild(text);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'dev-indicator-close';
      closeBtn.setAttribute('aria-label', 'Hide development mode indicator');
      closeBtn.innerHTML = '&times;';
      closeBtn.onclick = function() {
        indicator.remove();
        sessionStorage.setItem('vf-dev-indicator-hidden', '1');
      };
      indicator.appendChild(closeBtn);

      document.body.appendChild(indicator);
    })();
  </script>`;
}
