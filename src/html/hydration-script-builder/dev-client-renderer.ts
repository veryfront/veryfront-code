import { getLoaderScript, getRendererScript, getRouterScript } from "./templates/index.ts";

export function generateDevClientRendererScript(nonce?: string): string {
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  return `
  <script type="module"${nonceAttr}>
    import * as React from 'react';
    import { createRoot } from 'react-dom/client';

    ${getRouterScript()}

    ${getLoaderScript()}

    ${getRendererScript()}
  </script>`;
}
