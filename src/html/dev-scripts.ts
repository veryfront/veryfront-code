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

function getNonceAttr(nonce?: string): string {
  return nonce ? ` nonce="${nonce}"` : "";
}

export function getDevScripts(_hmrPort?: number, nonce?: string): string {
  const nonceAttr = getNonceAttr(nonce);

  return `
  <script type="module" src="/_veryfront/rsc/client.js"${nonceAttr}></script>
  <script type="module" src="/_veryfront/hmr.js"${nonceAttr}></script>`;
}

export function getProdScripts(slug: string, nonce?: string): string {
  const nonceAttr = getNonceAttr(nonce);
  const encodedSlug = encodeURIComponent(slug);

  return `
  <script type="module" src="/_veryfront/rsc/client.js"${nonceAttr}></script>
  <script type="module" src="/_veryfront/hydrate.js?slug=${encodedSlug}"${nonceAttr}></script>`;
}

export interface StudioScriptOptions {
  projectId: string;
  pageId: string;
  pagePath?: string;
  nonce?: string;
  /** Hash of source code for sync detection with Navigator tree */
  sourceHash?: string;
  /** WebSocket URL for direct Yjs connection from the bridge */
  wsUrl?: string;
  /** Yjs document GUID for the bridge to join the same room */
  yjsGuid?: string;
}

export function getStudioScripts(options: StudioScriptOptions): string {
  const nonceAttr = getNonceAttr(options.nonce);

  const bridgeConfig: Record<string, unknown> = {
    projectId: options.projectId,
    pageId: options.pageId,
    pagePath: options.pagePath ?? options.pageId,
  };
  if (options.wsUrl) bridgeConfig.wsUrl = options.wsUrl;
  if (options.yjsGuid) bridgeConfig.yjsGuid = options.yjsGuid;

  const sourceHashScript = options.sourceHash
    ? `<script${nonceAttr}>window.__VERYFRONT_SOURCE_HASH__=${
      JSON.stringify(options.sourceHash).replace(/</g, "\\u003c")
    };</script>\n  `
    : "";

  // Escape </script> sequences to prevent XSS breakout from inline JSON
  const safeJson = JSON.stringify(bridgeConfig).replace(/</g, "\\u003c");
  const configScript = `<script${nonceAttr}>window.__VF_BRIDGE_CONFIG__=${safeJson};</script>`;

  return `
  ${sourceHashScript}${configScript}
  <script type="module" src="/_veryfront/studio-bridge.js"${nonceAttr}></script>`;
}
