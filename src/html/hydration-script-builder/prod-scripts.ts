import { getLoaderScript, getRendererScript, getRouterScript } from "./templates/index.ts";
import { buildNonceAttribute } from "../html-escape.ts";

export const PROD_HYDRATION_MODULE_PATH = "/_veryfront/hydration-runtime.js";

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

export function getProdScripts(
  _slug: string,
  _params?: Record<string, string | string[]>,
  _props?: Record<string, unknown>,
  nonce?: string,
): string {
  const nonceAttr = buildNonceAttribute(nonce);
  return `\n  <script type="module" src="${PROD_HYDRATION_MODULE_PATH}"${nonceAttr}></script>`;
}
