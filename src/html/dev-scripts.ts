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

export function getDevScripts(_hmrPort?: number, nonce?: string): string {
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  // HMR script detects port at runtime (window.location.port + 1)
  return `
  <script type="module" src="/_veryfront/rsc/client.js"${nonceAttr}></script>
  <script type="module" src="/_veryfront/hmr.js"${nonceAttr}></script>`;
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

export interface StudioScriptOptions {
  projectId: string;
  pageId: string;
  pagePath?: string;
  nonce?: string;
  /** Hash of source code for sync detection with Navigator tree */
  sourceHash?: string;
}

export function getStudioScripts(options: StudioScriptOptions): string {
  const nonceAttr = options.nonce ? ` nonce="${options.nonce}"` : "";
  const paramObj: Record<string, string> = {
    projectId: options.projectId,
    pageId: options.pageId,
  };
  if (options.pagePath) {
    paramObj.pagePath = options.pagePath;
  }
  const params = new URLSearchParams(paramObj).toString();

  // Inject sourceHash as global for Navigator tree sync detection
  const sourceHashScript = options.sourceHash
    ? `<script${nonceAttr}>window.__VERYFRONT_SOURCE_HASH__="${options.sourceHash}";</script>\n  `
    : "";

  return `
  ${sourceHashScript}<script type="module" src="/_veryfront/studio-bridge.js?${params}"${nonceAttr}></script>`;
}
