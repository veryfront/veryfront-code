import type { VeryfrontConfig } from "../../config/index.js";

export function generateDevComponentManifestScript(
  config: VeryfrontConfig,
  nonce?: string,
): string {
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  const components = config.dev?.components ?? [];

  return `
  <script${nonceAttr}>
    window.__veryfrontComponents = ${JSON.stringify(components)};
  </script>`;
}
