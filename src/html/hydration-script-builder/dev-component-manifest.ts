import type { VeryfrontConfig } from "@veryfront/config";

export function generateDevComponentManifestScript(
  config: VeryfrontConfig,
  nonce?: string,
): string {
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  return `
  <script${nonceAttr}>
    window.__veryfrontComponents = ${JSON.stringify(config?.dev?.components || [])};
  </script>`;
}
