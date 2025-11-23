export function generateDevIndicatorScript(nonce?: string): string {
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  return `
  <script${nonceAttr}>
    const indicator = document.createElement('div');
    indicator.className = 'dev-indicator';
    indicator.textContent = 'Development Mode';
    document.body.appendChild(indicator);
  </script>`;
}
