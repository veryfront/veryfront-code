import { getLoaderScript, getRendererScript, getRouterScript } from "./templates/index.ts";
import { buildNonceAttribute } from "../html-escape.ts";
import { simpleHash as hash64 } from "#veryfront/utils/memoize.ts";

export const PROD_HYDRATION_MODULE_PATH = "/_veryfront/hydration-runtime.js";
export const PROD_HYDRATION_MODULE_VERSIONED_PATH_PATTERN =
  /^\/_veryfront\/hydration-runtime\.[0-9a-z]{13}\.js$/;

let cachedProdHydrationModulePath: string | null = null;

export function generateProdHydrationModule(): string {
  return [
    `import * as React from 'react';`,
    `import { createRoot } from 'react-dom/client';`,
    `import { RouterProvider, useRouter as useRouterFromModule } from 'veryfront/router';`,
    `import { PageContextProvider } from 'veryfront/context';`,
    getRouterScript().trim(),
    getLoaderScript().trim(),
    getRendererScript().trim(),
  ].join("\n\n");
}

export function getProdHydrationModulePath(): string {
  if (cachedProdHydrationModulePath) return cachedProdHydrationModulePath;

  const hash = hash64(generateProdHydrationModule()).padStart(13, "0");
  cachedProdHydrationModulePath = `/_veryfront/hydration-runtime.${hash}.js`;
  return cachedProdHydrationModulePath;
}

export function isVersionedProdHydrationModulePath(pathname: string): boolean {
  return PROD_HYDRATION_MODULE_VERSIONED_PATH_PATTERN.test(pathname);
}

export function getProdScripts(
  _slug: string,
  _params?: Record<string, string | string[]>,
  _props?: Record<string, unknown>,
  nonce?: string,
): string {
  const nonceAttr = buildNonceAttribute(nonce);
  return `\n  <script type="module" src="${getProdHydrationModulePath()}"${nonceAttr}></script>`;
}
