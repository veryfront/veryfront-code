/**
 * App Route HTML Rendering for Build
 */

import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
} from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getProjectReact, renderToStringAdapter } from "#veryfront/react";
import { loadComponentFromSource } from "#veryfront/modules/react-loader/index.ts";
import { COMPILATION_ERROR, VeryfrontError } from "#veryfront/errors";
import { generateHydrationData, getProdScripts } from "#veryfront/html";
import { buildImportMapJson } from "#veryfront/html/utils.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { getPreviewStylesheetLink } from "#veryfront/html/dev-scripts.ts";
import {
  shouldUnwrapAppRouterDocumentLayout,
  unwrapAppRouterDocumentLayout,
} from "#veryfront/rendering/layouts/utils/component-loader.ts";
import { resolveProjectReactVersion } from "#veryfront/transforms/esm/package-registry.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { determineClientModuleStrategy } from "#veryfront/rendering/rsc/client-module-strategy.ts";
import {
  CLIENT_PAGE_ISLAND_ID,
  hasUseClientDirective,
  planClientPageIsland,
} from "#veryfront/rendering/rsc/page-island.ts";
import { LAYOUT_EXTENSIONS } from "#veryfront/rendering/layouts/types.ts";

type ReactComponentLike = import("react").ComponentType<{ children?: import("react").ReactNode }>;
type ReactLayoutFunction = (
  props: { children?: import("react").ReactNode },
) => import("react").ReactNode;
const APP_ROUTE_LAYOUT_EXTENSIONS = LAYOUT_EXTENSIONS.filter((extension) =>
  extension !== "md" && extension !== "mdx"
);

async function fileExists(adapter: RuntimeAdapter, filePath: string): Promise<boolean> {
  try {
    const st = await adapter.fs.stat(filePath);
    return st.isFile;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

async function loadComponent(
  adapter: RuntimeAdapter,
  filePath: string,
  projectDir: string,
  contentSourceId: string,
  reactVersion?: string,
): Promise<unknown> {
  const src = await adapter.fs.readFile(filePath);
  try {
    return await loadComponentFromSource(src, filePath, projectDir, adapter, {
      projectId: projectDir,
      dev: false,
      moduleServerUrl: "",
      contentSourceId,
      reactVersion,
    });
  } catch (error) {
    if (error instanceof VeryfrontError && error.slug === "component-error") {
      throw COMPILATION_ERROR.create({
        detail: "Invalid layout component",
        cause: error,
        context: { file: basename(filePath) },
      });
    }
    throw error;
  }
}

function routePathToSlug(routePath: string): string {
  return routePath === "/" ? "" : routePath.replace(/^\/+/, "");
}

function getLayoutDirectoriesForPage(appRoot: string, pageFile: string): string[] {
  const normalizedAppRoot = normalize(appRoot);
  const pageDirectory = normalize(dirname(pageFile));
  const relativePageDirectory = relative(normalizedAppRoot, pageDirectory).replaceAll("\\", "/");

  if (
    relativePageDirectory === ".." ||
    relativePageDirectory.startsWith("../") ||
    isAbsolute(relativePageDirectory)
  ) {
    return [normalizedAppRoot];
  }

  const directories: string[] = [];
  let current = pageDirectory;
  while (true) {
    directories.push(current);
    if (current === normalizedAppRoot) break;

    const parent = dirname(current);
    if (parent === current) return [normalizedAppRoot];
    current = parent;
  }

  return directories.reverse();
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
  config?: VeryfrontConfig;
  releaseAssetManifest?: ReleaseAssetManifest | null;
  stylesheetHref?: string;
  includePreviewStylesheet?: boolean;
}): Promise<string> {
  const {
    adapter,
    projectDir,
    routePath,
    pageFile,
    contentSourceId,
    reactVersion: explicitReactVersion,
    config,
    releaseAssetManifest,
    stylesheetHref,
    includePreviewStylesheet,
  } = args;

  const appRoot = join(projectDir, config?.directories?.app ?? "app");
  const reactVersion = explicitReactVersion ??
    await resolveProjectReactVersion({ projectDir, config });
  const layouts: string[] = [];
  for (const directory of getLayoutDirectoriesForPage(appRoot, pageFile)) {
    for (const extension of APP_ROUTE_LAYOUT_EXTENSIONS) {
      const layoutPath = join(directory, `layout.${extension}`);
      if (!(await fileExists(adapter, layoutPath))) continue;
      layouts.push(layoutPath);
      break;
    }
  }

  // Use the resolved project version so component and renderer modules share one React instance.
  const React = await getProjectReact(reactVersion);

  const pageSource = await adapter.fs.readFile(pageFile);
  const Page = await loadComponentFromSource(pageSource, pageFile, projectDir, adapter, {
    projectId: projectDir,
    dev: false,
    moduleServerUrl: "",
    contentSourceId,
    reactVersion,
  });
  if (typeof Page !== "function") {
    throw COMPILATION_ERROR.create({
      detail: "Invalid page component",
      context: { pageFile, type: typeof Page },
    });
  }

  const hydrationStrategy = determineClientModuleStrategy({
    isLocalProject: false,
    environment: "production",
  });
  const layoutDescriptors = layouts.map((path) => ({ kind: "tsx" as const, path }));
  const clientPageIsland = await planClientPageIsland({
    pageSource,
    pagePath: pageFile,
    projectDir,
    appDir: config?.directories?.app ?? "app",
    layouts: layoutDescriptors,
    fs: adapter.fs,
    strategy: hydrationStrategy,
  });

  let element: import("react").ReactNode = React.createElement(Page as ReactComponentLike);
  const loadedLayouts: Array<ReactComponentLike | undefined> = new Array(layouts.length);

  for (let i = layouts.length - 1; i >= 0; i--) {
    const layoutPath = layouts[i];
    if (!layoutPath) continue;

    const Layout = await loadComponent(
      adapter,
      layoutPath,
      projectDir,
      contentSourceId,
      reactVersion,
    );
    if (typeof Layout !== "function") {
      throw COMPILATION_ERROR.create({
        detail: "Invalid layout component",
        context: { file: basename(layoutPath), type: typeof Layout },
      });
    }

    const LayoutToApply = shouldUnwrapAppRouterDocumentLayout(
        layoutPath,
        projectDir,
        config?.directories?.app,
      )
      ? unwrapAppRouterDocumentLayout(React, Layout as ReactLayoutFunction)
      : Layout as ReactComponentLike;

    loadedLayouts[i] = LayoutToApply;
  }

  const clientLayoutStart = clientPageIsland?.serverLayouts.length ?? 0;
  const firstLayoutToApply = clientPageIsland ? clientLayoutStart : 0;
  for (let i = loadedLayouts.length - 1; i >= firstLayoutToApply; i--) {
    const Layout = loadedLayouts[i];
    if (Layout) element = React.createElement(Layout, { children: element });
  }

  if (clientPageIsland) {
    element = React.createElement("div", { id: CLIENT_PAGE_ISLAND_ID }, element);
    for (let i = clientLayoutStart - 1; i >= 0; i--) {
      const Layout = loadedLayouts[i];
      if (Layout) element = React.createElement(Layout, { children: element });
    }
  }

  const htmlInner = await renderToStringAdapter(element, { reactVersion });
  const title = "Veryfront App";
  const slug = routePathToSlug(routePath);
  const effectiveConfig = {
    ...config,
    react: { ...config?.react, version: reactVersion },
  } as VeryfrontConfig;
  const importMapJson = await buildImportMapJson({
    projectDir,
    config: effectiveConfig,
    releaseAssetManifest,
  });
  const hydrationData = clientPageIsland || hasUseClientDirective(pageSource)
    ? generateHydrationData(
      slug,
      {},
      {},
      {
        mode: "production",
        environment: "production",
        config: effectiveConfig,
        projectDir,
        pagePath: pageFile,
        pageType: "tsx",
        releaseAssetManifest,
        isLocalProject: false,
        forceProductionScripts: true,
        nestedLayouts: clientPageIsland?.clientLayouts ?? layoutDescriptors,
        isolatedClientPage: Boolean(clientPageIsland),
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
