import type { ComponentProps } from "#veryfront/types";
import type { VeryfrontConfig } from "#veryfront/config";
import { buildNonceAttribute } from "../html-escape.ts";
import { generateDevErrorLoggerScript } from "./dev-error-logger.ts";
import { generateDevComponentManifestScript } from "./dev-component-manifest.ts";
import { generateDevClientRendererScript } from "./dev-client-renderer.ts";
import { snapshotPlainDataRecord } from "../json-snapshot.ts";

function generateHMRScript(
  hmrEnabled: boolean,
  nonce?: string,
  skipDevHMR?: boolean,
): string {
  // Skip dev HMR script when preview-hmr.js will be used instead
  if (skipDevHMR || !hmrEnabled) return "";

  const nonceAttr = buildNonceAttribute(nonce);
  return `<script type="module" src="/_veryfront/hmr.js"${nonceAttr}></script>`;
}

interface DevScriptsOptions {
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
  const configSnapshot = snapshotPlainDataRecord(
    config,
    "Development configuration",
  ) as unknown as VeryfrontConfig;
  const devSnapshot = configSnapshot.dev === undefined ? {} : snapshotPlainDataRecord(
    configSnapshot.dev,
    "Development server configuration",
  );
  const hmr = devSnapshot.hmr;
  if (hmr !== undefined && typeof hmr !== "boolean") {
    throw new TypeError("Development server hmr must be a boolean");
  }
  configSnapshot.dev = devSnapshot as VeryfrontConfig["dev"];

  const optionSnapshot = options === undefined
    ? {}
    : snapshotPlainDataRecord(options, "Development script options");
  const skipDevHMR = optionSnapshot.skipDevHMR;
  const skipErrorLogger = optionSnapshot.skipErrorLogger;
  if (skipDevHMR !== undefined && typeof skipDevHMR !== "boolean") {
    throw new TypeError("Development script option skipDevHMR must be a boolean");
  }
  if (skipErrorLogger !== undefined && typeof skipErrorLogger !== "boolean") {
    throw new TypeError("Development script option skipErrorLogger must be a boolean");
  }

  const scripts: string[] = [];

  // Error logger only works in local dev (endpoint returns 404 in preview/prod)
  if (!skipErrorLogger) scripts.push(generateDevErrorLoggerScript(nonce));

  scripts.push(
    generateDevComponentManifestScript(configSnapshot, nonce),
    generateDevClientRendererScript(nonce),
    generateHMRScript(hmr === true, nonce, skipDevHMR === true),
  );

  return scripts.join("\n");
}
