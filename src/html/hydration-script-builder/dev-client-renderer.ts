import { getLoaderScript, getRendererScript, getRouterScript } from "./templates/index.ts";

export function generateDevClientRendererScript(nonce?: string): string {
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  return `
  <script type="module"${nonceAttr}>
    import * as React from 'react';
    import { createRoot } from 'react-dom/client';
    // Import RouterProvider from veryfront/router to match SSR (same module instance)
    import { RouterProvider, useRouter as useRouterFromModule } from 'veryfront/react/router';
    // Import PageContextProvider to provide page frontmatter via usePageContext()
    import { PageContextProvider } from 'veryfront/react/context';
    // Note: QueryClient/QueryClientProvider removed - user's app.tsx should provide if needed

    ${getRouterScript()}

    ${getLoaderScript()}

    ${getRendererScript()}
  </script>`;
}
