export function generateProdHydrationScript(slug, _params, props, nonce) {
    const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
    const pageProps = JSON.stringify(props ?? {});
    return `
  <script type="module"${nonceAttr}>
    import * as React from 'react';
    import * as ReactDOM from 'react-dom/client';
    import { App } from '@/components/app';
    import { Layout } from '@/components/layout';
    import { Page } from '@/pages/${slug}';

    const root = document.getElementById('root');
    if (!root) return;

    const tree = React.createElement(App, {},
      React.createElement(Layout, {},
        React.createElement(Page, ${pageProps})
      )
    );

    // identifierPrefix must match SSR to prevent useId() mismatch
    // Suppress recoverable hydration errors - common with animation libraries
    ReactDOM.hydrateRoot(root, tree, {
      identifierPrefix: 'vf',
      onRecoverableError: () => {} // Silently ignore hydration mismatches
    });
  </script>`;
}
