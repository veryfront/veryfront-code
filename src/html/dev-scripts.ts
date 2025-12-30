import { DEFAULT_DASHBOARD_PORT } from "@veryfront/utils/constants/server.ts";

export function getDevStyles(nonce?: string): string {
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  return `
  <style${nonceAttr}>
    .dev-indicator {
      position: fixed;
      bottom: 1rem;
      right: 1rem;
      background: #3b82f6;
      color: white;
      padding: 0.5rem 1rem;
      border-radius: 0.5rem;
      font-size: 0.875rem;
      z-index: 9999;
    }

    #veryfront-error-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 999999;
      background: rgba(0,0,0,0.85);
      color: white;
      font-family: monospace;
      overflow: auto;
      padding: 2rem;
    }
  </style>`;
}

export function getDevScripts(port: number = DEFAULT_DASHBOARD_PORT, nonce?: string): string {
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  const hmrPort = port + 1; // HMR server runs on port + 1
  // Use external script src for hydration to work with CSP
  // The HMR websocket is handled in the external hmr.js script
  return `
  <script type="module" src="/_veryfront/rsc/client.js"${nonceAttr}></script>
  <script type="module" src="/_veryfront/hmr.js?port=${hmrPort}"${nonceAttr}></script>`;
}

export function getProdScripts(slug: string, nonce?: string): string {
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  // Use external script src for hydration to avoid CSP issues with inline scripts
  return `
  <script type="module" src="/_veryfront/rsc/client.js"${nonceAttr}></script>
  <script type="module" src="/_veryfront/hydrate.js?slug=${
    encodeURIComponent(slug)
  }"${nonceAttr}></script>`;
}
