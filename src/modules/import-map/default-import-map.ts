import type { ImportMapConfig } from "./types.ts";
import { getReactImportMap } from "#veryfront/transforms/esm/package-registry.ts";

/**
 * SSR import map for veryfront/* modules.
 *
 * IMPORTANT: When adding a new export to deno.json that contains React
 * hooks or components, add it here too. Without an entry, the module
 * won't go through the SSR transform pipeline, causing dual-React
 * errors or "Module not found" 500s in production.
 */
function getVeryfrontSsrImportMap(): Record<string, string> {
  const base = "/_vf_modules/_veryfront";
  const ssr = "?ssr=true";
  const coreReact = `${base}/react/runtime/core.js${ssr}`;

  const head = coreReact;
  const router = coreReact;
  const context = coreReact;
  const fonts = `${base}/react/fonts/index.js${ssr}`;

  const markdown = `${base}/markdown/index.js${ssr}`;
  const chat = `${base}/chat/index.js${ssr}`;
  const mdx = `${base}/mdx/index.js${ssr}`;

  // React-bound workflow hooks are an explicit integration entry point. The
  // dependency-free workflow core is intentionally not browser-mapped.
  const workflowReact = `${base}/react/workflow/index.js${ssr}`;

  // veryfront/react is a barrel that re-exports all browser-side modules.
  const react = `${base}/react/public.js${ssr}`;

  return {
    "veryfront/react": react,
    "veryfront/head": head,
    "veryfront/router": router,
    "veryfront/context": context,
    "veryfront/fonts": fonts,
    "veryfront/markdown": markdown,
    "veryfront/chat": chat,
    "veryfront/mdx": mdx,
    "veryfront/workflow/react": workflowReact,
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
