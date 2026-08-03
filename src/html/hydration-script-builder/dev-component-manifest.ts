import type { VeryfrontConfig } from "#veryfront/config";
import { jsonForInlineScript } from "#veryfront/security/client/html-sanitizer.ts";
import { buildNonceAttribute } from "../html-escape.ts";

export function generateDevComponentManifestScript(
  config: VeryfrontConfig,
  nonce?: string,
): string {
  const nonceAttr = buildNonceAttribute(nonce);
  const components = config.dev?.components ?? [];

  return `
  <script${nonceAttr}>
    window.__veryfrontComponents = ${jsonForInlineScript(components)};
  </script>`;
}
