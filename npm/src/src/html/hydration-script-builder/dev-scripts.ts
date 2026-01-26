import type { ComponentProps } from "../../types/index.js";
import type { VeryfrontConfig } from "../../config/index.js";
import { generateDevErrorLoggerScript } from "./dev-error-logger.js";
import { generateDevComponentManifestScript } from "./dev-component-manifest.js";
import { generateDevClientRendererScript } from "./dev-client-renderer.js";

function generateHMRScript(
  config: VeryfrontConfig,
  nonce?: string,
  skipDevHMR?: boolean,
): string {
  // Skip dev HMR script when preview-hmr.js will be used instead
  if (skipDevHMR || !config.dev?.hmr) return "";

  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  return `<script type="module" src="/_veryfront/hmr.js"${nonceAttr}></script>`;
}

export interface DevScriptsOptions {
  /** Skip hmr.js when preview-hmr.js will be used (proxy mode) */
  skipDevHMR?: boolean;
  /** Skip error logger when endpoint is not available (preview mode) */
  skipErrorLogger?: boolean;
}

export function getDevScripts(
  _slug: string,
  config: VeryfrontConfig,
  _params?: Record<string, string | string[]>,
  _props?: ComponentProps,
  nonce?: string,
  options?: DevScriptsOptions,
): string {
  const scripts: string[] = [];

  // Error logger only works in local dev (endpoint returns 404 in preview/prod)
  if (!options?.skipErrorLogger) {
    scripts.push(generateDevErrorLoggerScript(nonce));
  }

  scripts.push(generateDevComponentManifestScript(config, nonce));
  scripts.push(generateDevClientRendererScript(nonce));
  scripts.push(generateHMRScript(config, nonce, options?.skipDevHMR));

  return scripts.join("\n");
}
