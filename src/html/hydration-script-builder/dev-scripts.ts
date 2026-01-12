import type { ComponentProps } from "@veryfront/types";
import type { VeryfrontConfig } from "@veryfront/config";
import { generateDevErrorLoggerScript } from "./dev-error-logger.ts";
import { generateDevComponentManifestScript } from "./dev-component-manifest.ts";
import { generateDevClientRendererScript } from "./dev-client-renderer.ts";

function generateHMRScript(config: VeryfrontConfig, nonce?: string): string {
  if (!config.dev?.hmr) {
    return "";
  }
  // HMR script detects port at runtime (window.location.port + 1)
  // The port param is kept for backward compatibility but is ignored
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  return `<script type="module" src="/_veryfront/hmr.js"${nonceAttr}></script>`;
}

export function getDevScripts(
  _slug: string,
  config: VeryfrontConfig,
  _params?: Record<string, string | string[]>,
  _props?: ComponentProps,
  nonce?: string,
): string {
  return [
    generateDevErrorLoggerScript(nonce),
    generateDevComponentManifestScript(config, nonce),
    generateDevClientRendererScript(nonce),
    generateHMRScript(config, nonce),
  ].join("\n");
}
