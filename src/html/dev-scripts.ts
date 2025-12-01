import { HMR_CLIENT_RELOAD_DELAY_MS } from "@veryfront/utils/constants/hmr.ts";
import { DEFAULT_DASHBOARD_PORT } from "@veryfront/utils/constants/server.ts";

export function getDevStyles(): string {
  return `
  <style>
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

export function getDevScripts(port: number = DEFAULT_DASHBOARD_PORT): string {
  const reloadDelay = HMR_CLIENT_RELOAD_DELAY_MS;
  return `
  <script>
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
  </script>
  <script type="module" src="/_veryfront/client.js"></script>`;
}

export function getProdScripts(slug: string): string {
  return `
  <script type="module">
    import { hydrate } from '/_veryfront/client.js';
    hydrate('${slug}', {
      ssr: true
    });
  </script>`;
}
