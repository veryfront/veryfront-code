/**
 * App Route HTML Rendering for Build
 */

import { serverLogger as logger } from "#veryfront/utils";
import { join } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getProjectReact, renderToStringAdapter } from "#veryfront/react";
import { loadComponentFromSource } from "#veryfront/modules/react-loader/index.ts";
import { COMPILATION_ERROR } from "#veryfront/errors/index.ts";
import { generateHydrationData, getProdScripts } from "#veryfront/html";
import { buildImportMapJson } from "#veryfront/html/utils.ts";
import { getPreviewStylesheetLink } from "#veryfront/html/dev-scripts.ts";
import {
  shouldUnwrapAppRouterDocumentLayout,
  unwrapAppRouterDocumentLayout,
} from "#veryfront/rendering/layouts/utils/component-loader.ts";

type ReactComponentLike = import("react").ComponentType<{ children?: import("react").ReactNode }>;
type ReactLayoutFunction = (
  props: { children?: import("react").ReactNode },
) => import("react").ReactNode;

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
    moduleServerUrl: "",
    contentSourceId,
  });
}

function routePathToSlug(routePath: string): string {
  return routePath === "/" ? "" : routePath.replace(/^\/+/, "");
}

function hasUseClientDirective(source: string): boolean {
  return /^\s*['"]use client['"];?\s*$/m.test(source);
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

function routePathToSlug(routePath: string): string {
  return routePath === "/" ? "" : routePath.replace(/^\/+/, "");
}

function hasUseClientDirective(source: string): boolean {
  return /^\s*['"]use client['"];?\s*$/m.test(source);
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
  stylesheetHref?: string;
  includePreviewStylesheet?: boolean;
}): Promise<string> {
  const {
    adapter,
    projectDir,
    routePath,
    pageFile,
    contentSourceId,
    stylesheetHref,
    includePreviewStylesheet,
  } = args;

  const appRoot = join(projectDir, "app");
  const layoutCandidates = getLayoutsForRoute(appRoot, routePath);

  const layouts: string[] = [];
  for (const layoutPath of layoutCandidates) {
    if (await fileExists(adapter, layoutPath)) layouts.push(layoutPath);
  }

  // Get React from the project's node_modules to ensure element symbols match
  const React = await getProjectReact();

  const pageSource = await adapter.fs.readFile(pageFile);
  const Page = await loadComponentFromSource(pageSource, pageFile, projectDir, adapter, {
    projectId: projectDir,
    dev: false,
    moduleServerUrl: "",
    contentSourceId,
  });
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

      const LayoutToApply = shouldUnwrapAppRouterDocumentLayout(layoutPath, projectDir)
        ? unwrapAppRouterDocumentLayout(React, Layout as ReactLayoutFunction)
        : Layout as ReactComponentLike;

      element = React.createElement(LayoutToApply, { children: element });
    } catch (error) {
      logger.debug(
        "[BuildAppRouteRenderer] Layout loading failed, continuing without layout",
        error,
      );
    }
  }

  const htmlInner = await renderToStringAdapter(element);
  const title = "Veryfront App";
  const slug = routePathToSlug(routePath);
  const importMapJson = await buildImportMapJson({ projectDir });
  const hydrationData = hasUseClientDirective(pageSource)
    ? generateHydrationData(
      slug,
      {},
      {},
      {
        mode: "production",
        environment: "production",
        projectDir,
        pagePath: pageFile,
        pageType: "tsx",
        isLocalProject: false,
        forceProductionScripts: true,
        nestedLayouts: layouts.map((layoutPath) => ({ kind: "tsx", path: layoutPath })),
      },
      { pretty: false },
    )
    : null;
  const hydrationDataScript = hydrationData
    ? `
  <script id="veryfront-hydration-data" type="application/json">${hydrationData}</script>`
    : "";
  const shouldIncludePreviewStylesheet = includePreviewStylesheet ?? !stylesheetHref;
  const stylesheetLink = stylesheetHref
    ? `<link rel="stylesheet" href="${stylesheetHref}">`
    : shouldIncludePreviewStylesheet
    ? getPreviewStylesheetLink()
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>

  <!-- Import map for React dependencies -->
  <script type="importmap">
  ${importMapJson}
  </script>

  ${stylesheetLink}
</head>
<body>
  <div id="root">${htmlInner}</div>
${hydrationDataScript}
${hydrationData ? getProdScripts(slug) : ""}
</body>
</html>`;
}
