import { getLoaderScript, getRendererScript, getRouterScript } from "./templates/index.ts";
import { buildNonceAttribute } from "../html-escape.ts";

export function generateDevClientRendererScript(nonce?: string): string {
  const nonceAttr = buildNonceAttribute(nonce);

  return `
  <script type="module"${nonceAttr}>
    import * as React from 'react';
    import { createRoot } from 'react-dom/client';
    import { RouterProvider, useRouter as useRouterFromModule, getNavigationStore } from 'veryfront/router';
    import { PageContextProvider } from 'veryfront/context';

    ${getRouterScript()}
    ${getLoaderScript()}
    ${getRendererScript()}
  </script>`;
}
