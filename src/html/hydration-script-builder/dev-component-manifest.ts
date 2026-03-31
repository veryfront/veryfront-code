import type { VeryfrontConfig } from "#veryfront/config";
import { escapeHtml } from "../html-escape.ts";

export function generateDevComponentManifestScript(
  config: VeryfrontConfig,
  nonce?: string,
): string {
  const nonceAttr = nonce ? ` nonce="${escapeHtml(nonce)}"` : "";
  const components = config.dev?.components ?? [];

  return `
  <script${nonceAttr}>
    window.__veryfrontComponents = ${JSON.stringify(components)};
  </script>`;
}
