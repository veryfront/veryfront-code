import type { ComponentProps } from "#veryfront/types";
import type { VeryfrontConfig } from "#veryfront/config";
import { buildNonceAttribute } from "../html-escape.ts";
import { generateDevErrorLoggerScript } from "./dev-error-logger.ts";
import { generateDevComponentManifestScript } from "./dev-component-manifest.ts";
import { generateDevClientRendererScript } from "./dev-client-renderer.ts";
import { generateDevFlagScript } from "./dev-flag.ts";

function generateHMRScript(
  config: VeryfrontConfig,
  nonce?: string,
  skipDevHMR?: boolean,
): string {
  // Skip dev HMR script when preview-hmr.js will be used instead
  if (skipDevHMR || !config.dev?.hmr) return "";

  const nonceAttr = buildNonceAttribute(nonce);
  return `<script type="module" src="/_veryfront/hmr.js"${nonceAttr}></script>`;
}

interface DevScriptsOptions {
  /** Skip hmr.js when preview-hmr.js will be used (proxy mode) */
  skipDevHMR?: boolean;
  /** Skip error logger when endpoint is not available (preview mode) */
  skipErrorLogger?: boolean;
  /**
   * Skip the client development flag. Preview serves the dev script set for
   * HMR, but its output is user-facing, so it must not switch on
   * development-only client behaviour such as configuration warnings.
   */
  skipDevFlag?: boolean;
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

  // First, so client code that branches on the development signal sees it
  // before any other dev script runs.
  if (!options?.skipDevFlag) scripts.push(generateDevFlagScript(nonce));

  // Error logger only works in local dev (endpoint returns 404 in preview/prod)
  if (!options?.skipErrorLogger) scripts.push(generateDevErrorLoggerScript(nonce));

  scripts.push(
    generateDevComponentManifestScript(config, nonce),
    generateDevClientRendererScript(nonce),
    generateHMRScript(config, nonce, options?.skipDevHMR),
  );

  return scripts.join("\n");
}
