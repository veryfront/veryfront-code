export function generateDevComponentManifestScript(config, nonce) {
    const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
    const components = config.dev?.components ?? [];
    return `
  <script${nonceAttr}>
    window.__veryfrontComponents = ${JSON.stringify(components)};
  </script>`;
}
