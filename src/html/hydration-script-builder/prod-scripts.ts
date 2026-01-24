import { getLoaderScript, getRendererScript, getRouterScript } from "./templates/index.ts";

export function getProdScripts(
  _slug: string,
  _params?: Record<string, string | string[]>,
  _props?: Record<string, unknown>,
  nonce?: string,
): string {
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";

  return `
  <script type="module"${nonceAttr}>
    import * as React from 'react';
    import { RouterProvider, useRouter as useRouterFromModule } from 'veryfront/router';
    import { PageContextProvider } from 'veryfront/context';

    ${getRouterScript()}

    ${getLoaderScript()}

    ${getRendererScript()}
  </script>`;
}
