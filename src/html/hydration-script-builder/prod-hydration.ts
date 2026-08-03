import type { ComponentProps } from "#veryfront/types";
import { jsonForInlineScript } from "#veryfront/security/client/html-sanitizer.ts";
import { buildNonceAttribute } from "../html-escape.ts";

export function generateProdHydrationScript(
  slug: string,
  _params?: Record<string, string | string[]>,
  props?: ComponentProps,
  nonce?: string,
): string {
  const nonceAttr = buildNonceAttribute(nonce);
  const pageProps = jsonForInlineScript(props ?? {});
  const pageSpecifier = jsonForInlineScript(`@/pages/${slug}`);

  return `
  <script type="module"${nonceAttr}>
    import * as React from 'react';
    import * as ReactDOM from 'react-dom/client';
    import { App } from '@/components/app';
    import { Layout } from '@/components/layout';
    import { Page } from ${pageSpecifier};

    const root = document.getElementById('root');
    if (!root) return;

    const tree = React.createElement(
      App,
      {},
      React.createElement(
        Layout,
        {},
        React.createElement(Page, ${pageProps})
      )
    );

    // identifierPrefix must match SSR to prevent useId() mismatch
    // Suppress recoverable hydration errors - common with animation libraries
    ReactDOM.hydrateRoot(root, tree, {
      identifierPrefix: 'vf',
      onRecoverableError: () => {}, // Silently ignore hydration mismatches
    });
  </script>`;
}
