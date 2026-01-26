import { getLoaderScript, getRendererScript, getRouterScript } from "./templates/index.js";
export function getProdScripts(_slug, _params, _props, nonce) {
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
