import type { ImportMapConfig } from "./types.ts";
import { getReactImportMap } from "#veryfront/transforms/esm/package-registry.ts";

/**
 * Get the veryfront framework import map for SSR.
 *
 * Uses module server URLs (/_vf_modules/_veryfront/...) instead of file:// URLs.
 * This ensures framework code goes through the same SSR transform pipeline as user code,
 * with React imports rewritten to the same esm.sh URLs - preventing dual React instances.
 *
 * The module server (module-server.ts) resolves _veryfront/ paths to the framework source
 * and applies the same transforms including applySSRImportRewrites().
 */
function getVeryfrontSsrImportMap(): Record<string, string> {
  // Use module server URLs so framework code goes through SSR transform.
  // This ensures React imports in framework components (like Head.tsx) get
  // rewritten to the same esm.sh URLs as user code - single React instance.
  const base = "/_vf_modules/_veryfront";

  const head = `${base}/react/components/Head.js?ssr=true`;
  const router = `${base}/react/router/index.js?ssr=true`;
  const context = `${base}/react/context/index.js?ssr=true`;
  const fonts = `${base}/react/fonts/index.js?ssr=true`;

  return {
    "veryfront/head": head,
    "veryfront/router": router,
    "veryfront/context": context,
    "veryfront/fonts": fonts,
    "veryfront/react/head": head,
    "veryfront/react/router": router,
    "veryfront/react/context": context,
    "veryfront/react/fonts": fonts,
  };
}

/**
 * Get the default import map for SSR transforms.
 * Uses esm.sh URLs consistently (NO npm: specifiers per plan requirements).
 */
export function getDefaultImportMap(): ImportMapConfig {
  const reactMap = getReactImportMap();
  const veryfrontMap = getVeryfrontSsrImportMap();

  return {
    imports: { ...veryfrontMap, ...reactMap },
  };
}
