import { getLoaderScript, getRendererScript, getRouterScript } from "./templates/index.ts";

/**
 * Generate production hydration scripts using template-based approach.
 * This dynamically loads layouts from hydration data instead of hardcoding
 * @/components/layout import which may not exist in all projects.
 */
export function getProdScripts(
  _slug: string,
  _params?: Record<string, string | string[]>,
  _props?: Record<string, unknown>,
  nonce?: string,
): string {
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  // Use same template-based approach as dev mode to dynamically load layouts
  // from hydration data. This ensures layouts are loaded from the correct
  // paths (e.g., components/layouts/DefaultLayout.mdx) instead of hardcoded
  // @/components/layout which doesn't exist in all projects.
  return `
  <script type="module"${nonceAttr}>
    import * as React from 'react';
    // Import RouterProvider from veryfront/router to match SSR (same module instance)
    import { RouterProvider, useRouter as useRouterFromModule } from 'veryfront/router';
    // Import PageContextProvider to provide page frontmatter via usePageContext()
    import { PageContextProvider } from 'veryfront/context';

    ${getRouterScript()}

    ${getLoaderScript()}

    ${getRendererScript()}
  </script>`;
}
