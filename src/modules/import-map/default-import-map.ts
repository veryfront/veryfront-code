import type { ImportMapConfig } from "./types.ts";
import { getReactImportMap } from "#veryfront/transforms/esm/package-registry.ts";

function getVeryfrontSsrImportMap(): Record<string, string> {
  const base = "/_vf_modules/_veryfront";
  const ssr = "?ssr=true";

  const head = `${base}/react/components/Head.js${ssr}`;
  const router = `${base}/react/router/index.js${ssr}`;
  const context = `${base}/react/context/index.js${ssr}`;
  const fonts = `${base}/react/fonts/index.js${ssr}`;

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

export function getDefaultImportMap(): ImportMapConfig {
  return {
    imports: { ...getVeryfrontSsrImportMap(), ...getReactImportMap() },
  };
}
