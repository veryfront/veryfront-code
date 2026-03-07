/**
 * App Route HTML Rendering for Build
 */

import { serverLogger as logger } from "#veryfront/utils";
import { join } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getProjectReact, renderToStringAdapter } from "#veryfront/react";
import { loadComponentFromSource } from "#veryfront/modules/react-loader/index.ts";
import { COMPILATION_ERROR } from "#veryfront/errors/index.ts";
import { DEFAULT_REACT_VERSION, getReactUrls } from "#veryfront/transforms/esm/package-registry.ts";

type ReactComponentLike = import("react").ComponentType<{ children?: import("react").ReactNode }>;

async function fileExists(adapter: RuntimeAdapter, filePath: string): Promise<boolean> {
  try {
    const st = await adapter.fs.stat(filePath);
    return st.isFile;
  } catch (_) {
    /* expected: file may not exist */
    return false;
  }
}

async function loadComponent(
  adapter: RuntimeAdapter,
  filePath: string,
  projectDir: string,
  contentSourceId: string,
): Promise<unknown> {
  const src = await adapter.fs.readFile(filePath);
  return loadComponentFromSource(src, filePath, projectDir, adapter, {
    projectId: projectDir,
    dev: false,
    moduleServerUrl: "", // Empty string forces CDN URLs, no module server available
    contentSourceId,
  });
}

function getLayoutsForRoute(appRoot: string, routePath: string): string[] {
  const segments = routePath === "/" ? [] : routePath.split("/").filter(Boolean);
  const layouts: string[] = [];

  let current = appRoot;
  layouts.push(join(current, "layout.tsx"));

  for (const seg of segments) {
    current = join(current, seg);
    layouts.push(join(current, "layout.tsx"));
  }

  return layouts;
}

/**
 * Render an App Router route to HTML
 */
export async function renderAppRouteToHTML(args: {
  adapter: RuntimeAdapter;
  projectDir: string;
  routePath: string;
  pageFile: string;
  contentSourceId: string;
  reactVersion?: string;
}): Promise<string> {
  const { adapter, projectDir, routePath, pageFile, contentSourceId, reactVersion } = args;

  const appRoot = join(projectDir, "app");
  const layoutCandidates = getLayoutsForRoute(appRoot, routePath);

  const layouts: string[] = [];
  for (const layoutPath of layoutCandidates) {
    if (await fileExists(adapter, layoutPath)) layouts.push(layoutPath);
  }

  // Get React from the project's node_modules to ensure element symbols match
  const React = await getProjectReact();

  const Page = await loadComponent(adapter, pageFile, projectDir, contentSourceId);
  if (typeof Page !== "function") {
    throw COMPILATION_ERROR.create({
      detail: "Invalid page component",
      context: { pageFile, type: typeof Page },
    });
  }

  let element: import("react").ReactNode = React.createElement(Page as ReactComponentLike);

  for (let i = layouts.length - 1; i >= 0; i--) {
    const layoutPath = layouts[i];
    if (!layoutPath) continue;

    try {
      const Layout = await loadComponent(adapter, layoutPath, projectDir, contentSourceId);
      if (typeof Layout !== "function") continue;

      element = React.createElement(Layout as ReactComponentLike, { children: element });
    } catch (error) {
      logger.debug(
        "[BuildAppRouteRenderer] Layout loading failed, continuing without layout",
        error,
      );
    }
  }

  const htmlInner = await renderToStringAdapter(element);
  const title = "Veryfront App";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>

  <!-- Import map for React dependencies -->
  <script type="importmap">
  ${JSON.stringify({ imports: getReactUrls(reactVersion ?? DEFAULT_REACT_VERSION) }, null, 4)}
  </script>

</head>
<body>
  <div id="root">${htmlInner}</div>

  <!-- Veryfront Runtime -->
  <script type="module">
    // Basic app initialization for App Router pages
    async function initializeApp() {
      try {
        // Import the app module if it exists
        const appModule = await import('/_veryfront/app.js').catch(() => null);
        if (appModule) {
          console.log('App module loaded');
        }
      } catch (error) {
        console.error('Failed to initialize app:', error);
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initializeApp);
    } else {
      initializeApp();
    }
  </script>
</body>
</html>`;
}
