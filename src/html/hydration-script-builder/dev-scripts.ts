import type { ComponentProps } from "@veryfront/types";
import type { VeryfrontConfig } from "@veryfront/config";
import { generateDevErrorLoggerScript } from "./dev-error-logger.ts";
import { generateDevIndicatorScript } from "./dev-indicator.ts";
import { generateDevComponentManifestScript } from "./dev-component-manifest.ts";
import { generateDevClientRendererScript } from "./dev-client-renderer.ts";

export function getDevScripts(
  _slug: string,
  config: VeryfrontConfig,
  _params?: Record<string, string | string[]>,
  _props?: ComponentProps,
  nonce?: string,
): string {
  return [
    generateDevErrorLoggerScript(nonce),
    generateDevIndicatorScript(nonce),
    generateDevComponentManifestScript(config, nonce),
    generateDevClientRendererScript(nonce),
  ].join("\n");
}
