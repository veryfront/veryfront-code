/**
 * App Route HTML Rendering for Build
 */

import { serverLogger as logger } from "#veryfront/utils";
import { join } from "#veryfront/platform/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getProjectReact, renderToStringAdapter } from "#veryfront/react";
import { loadComponentFromSource } from "#veryfront/modules/react-loader/index.ts";
import { CompilationError } from "#veryfront/errors/index.ts";
import { DEFAULT_REACT_VERSION, getReactUrls } from "#veryfront/transforms/esm/package-registry.ts";

type ReactComponentLike = import("react").ComponentType<{ children?: import("react").ReactNode }>;

async function fileExists(adapter: RuntimeAdapter, filePath: string): Promise<boolean> {
  try {
    const st = await adapter.fs.stat(filePath);
    return st.isFile;
  } catch {
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
  const layouts: string[] = [];

  const rootLayout = join(appRoot, "layout.tsx");
  if (await fileExists(adapter, rootLayout)) layouts.push(rootLayout);

  const segments = routePath === "/" ? [] : routePath.split("/").filter(Boolean);
  let current = appRoot;

  for (const seg of segments) {
    current = join(current, seg);
    const layoutFile = join(current, "layout.tsx");
    if (await fileExists(adapter, layoutFile)) layouts.push(layoutFile);
  }

  // Get React from the project's node_modules to ensure element symbols match
  const React = await getProjectReact();

  const Page = await loadComponent(adapter, pageFile, projectDir, contentSourceId);
  if (typeof Page !== "function") {
    throw new CompilationError("Invalid page component", { pageFile, type: typeof Page });
  }

  let element: import("react").ReactNode = React.createElement(Page as ReactComponentLike);

  for (let i = layouts.length - 1; i >= 0; i--) {
    const layoutPath = layouts[i];
    if (!layoutPath) continue;

    try {
      const Layout = await loadComponent(adapter, layoutPath, projectDir, contentSourceId);
      if (typeof Layout === "function") {
        element = React.createElement(Layout as ReactComponentLike, { children: element });
      }
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

  <!-- Basic styles -->
  <style>
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.5;
    }

    .loading-container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: #f9fafb;
    }

    .loading-spinner {
      width: 40px;
      height: 40px;
      border: 3px solid #e5e7eb;
      border-top-color: #3b82f6;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .prose {
      max-width: 65ch;
      margin: 0 auto;
      padding: 2rem;
    }

    .prose h1, .prose h2, .prose h3 {
      margin-top: 2em;
      margin-bottom: 1em;
    }

    .prose p {
      margin-bottom: 1.5em;
    }

    .prose code {
      background: #f3f4f6;
      padding: 0.2em 0.4em;
      border-radius: 3px;
      font-size: 0.875em;
    }

    .prose pre {
      background: #1f2937;
      color: #f9fafb;
      padding: 1em;
      border-radius: 8px;
      overflow-x: auto;
    }

    .prose pre code {
      background: transparent;
      padding: 0;
      color: inherit;
    }

    /* Tailwind-like utility classes */
    .vf-tailwind {
      width: 100%;
    }

    .container {
      width: 100%;
      margin-right: auto;
      margin-left: auto;
      padding-right: 1rem;
      padding-left: 1rem;
    }

    @media (min-width: 640px) {
      .container { max-width: 640px; }
    }

    @media (min-width: 768px) {
      .container { max-width: 768px; }
    }

    @media (min-width: 1024px) {
      .container { max-width: 1024px; }
    }

    @media (min-width: 1280px) {
      .container { max-width: 1280px; }
    }

    .mx-auto {
      margin-left: auto;
      margin-right: auto;
    }

    .px-4 { padding-left: 1rem; padding-right: 1rem; }
    .py-8 { padding-top: 2rem; padding-bottom: 2rem; }

    .max-w-4xl { max-width: 56rem; }
  </style>
</head>
<body>
  <div id="root" class="vf-tailwind">
    <div class="container mx-auto px-4 py-8 prose max-w-4xl">${htmlInner}</div>
  </div>

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
