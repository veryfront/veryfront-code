export function getDevStyles(nonce) {
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
export function getDevScripts(_hmrPort, nonce) {
    const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
    return `
  <script type="module" src="/_veryfront/rsc/client.js"${nonceAttr}></script>
  <script type="module" src="/_veryfront/hmr.js"${nonceAttr}></script>`;
}
export function getProdScripts(slug, nonce) {
    const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
    const encodedSlug = encodeURIComponent(slug);
    return `
  <script type="module" src="/_veryfront/rsc/client.js"${nonceAttr}></script>
  <script type="module" src="/_veryfront/hydrate.js?slug=${encodedSlug}"${nonceAttr}></script>`;
}
export function getStudioScripts(options) {
    const nonceAttr = options.nonce ? ` nonce="${options.nonce}"` : "";
    const params = new URLSearchParams({
        projectId: options.projectId,
        pageId: options.pageId,
        ...(options.pagePath ? { pagePath: options.pagePath } : {}),
    }).toString();
    const sourceHashScript = options.sourceHash
        ? `<script${nonceAttr}>window.__VERYFRONT_SOURCE_HASH__="${options.sourceHash}";</script>\n  `
        : "";
    return `
  ${sourceHashScript}<script type="module" src="/_veryfront/studio-bridge.js?${params}"${nonceAttr}></script>`;
}
