/**
 * App Route HTML Rendering for Build
 */

import { dirname, isAbsolute, join, normalize, relative } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getProjectReact, renderToStringAdapter } from "#veryfront/react";
import { runWithHeadCollector } from "#veryfront/react/head-collector.ts";
import {
  buildHeadElements,
  resolveCommittedHeadFromHTML,
} from "#veryfront/rendering/orchestrator/html-head.ts";
import { loadComponentFromSource } from "#veryfront/modules/react-loader/index.ts";
import { COMPILATION_ERROR } from "#veryfront/errors";
import { generateHydrationData, getProdScripts } from "#veryfront/html";
import { buildImportMapJson } from "#veryfront/html/utils.ts";
import { escapeHTML } from "#veryfront/html/html-escape.ts";
import {
  HEAD_SHELL_PROVENANCE_ATTRIBUTE,
  headMetaSingletonKeyFromRecord,
} from "#veryfront/html/managed-head-protocol.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { getPreviewStylesheetLink } from "#veryfront/html/dev-scripts.ts";
import {
  shouldUnwrapAppRouterDocumentLayout,
  unwrapAppRouterDocumentLayout,
} from "#veryfront/rendering/layouts/utils/component-loader.ts";
import {
  createDependencyPinningSource,
  type DependencyPinningSnapshot,
  resolveDependencyPinningSnapshot,
  resolveProjectReactVersion,
} from "#veryfront/transforms/esm/package-registry.ts";
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
  dependencySnapshot: DependencyPinningSnapshot,
  moduleServerOrigin?: string,
  reactVersion?: string,
  componentLoader: typeof loadComponentFromSource = loadComponentFromSource,
): Promise<unknown> {
  const src = await adapter.fs.readFile(filePath);
  return componentLoader(src, filePath, projectDir, adapter, {
    projectId: projectDir,
    dev: false,
    moduleServerUrl: "",
    moduleServerOrigin,
    contentSourceId,
    reactVersion,
    dependencyPinningCacheKey: dependencySnapshot.cacheKey,
    dependencyPinningDependencies: dependencySnapshot.dependencies,
  });
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
interface RenderAppRouteArgs {
  adapter: RuntimeAdapter;
  projectDir: string;
  routePath: string;
  pageFile: string;
  contentSourceId: string;
  /** Configured deployment origin used to identify same-origin module-map URLs. */
  moduleServerOrigin?: string;
  reactVersion?: string;
  config?: VeryfrontConfig;
  releaseAssetManifest?: ReleaseAssetManifest | null;
  stylesheetHref?: string;
  includePreviewStylesheet?: boolean;
  dependencyPinningCacheKey?: string;
  dependencyPinningDependencies?: Readonly<Record<string, string>>;
}

interface AppRouteRendererInternals {
  componentLoader: typeof loadComponentFromSource;
}

const DEFAULT_RENDERER_INTERNALS: AppRouteRendererInternals = {
  componentLoader: loadComponentFromSource,
};

async function renderAppRouteToHTMLWithInternals(
  args: RenderAppRouteArgs,
  internals: AppRouteRendererInternals,
): Promise<string> {
  const {
    adapter,
    projectDir,
    routePath,
    pageFile,
    contentSourceId,
    moduleServerOrigin,
    reactVersion: explicitReactVersion,
    config,
    releaseAssetManifest,
    stylesheetHref,
    includePreviewStylesheet,
    dependencyPinningCacheKey,
    dependencyPinningDependencies,
  } = args;

  const appRoot = join(projectDir, config?.directories?.app ?? "app");
  // Capture the key and package map once. Every transform and browser module
  // identity in this render must use this exact immutable pair, even if
  // package.json changes while page/layout modules are loading.
  const dependencySnapshot = await resolveDependencyPinningSnapshot(
    createDependencyPinningSource({
      projectDir,
      adapter,
      isLocalProject: true,
      contentSourceId,
      config,
    }),
    dependencyPinningCacheKey,
    dependencyPinningDependencies,
  );
  const snapshotReactVersion = await resolveProjectReactVersion({
    projectDir,
    config,
    dependencyPinningCacheKey: dependencySnapshot.cacheKey,
    dependencyPinningDependencies: dependencySnapshot.dependencies,
  });
  const reactVersion = dependencySnapshot.cacheKey.startsWith("on:")
    ? snapshotReactVersion
    : explicitReactVersion ?? snapshotReactVersion;
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
  const React = await getProjectReact(reactVersion, adapter);

  const pageSource = await adapter.fs.readFile(pageFile);
  const Page = await internals.componentLoader(pageSource, pageFile, projectDir, adapter, {
    projectId: projectDir,
    dev: false,
    moduleServerUrl: "",
    moduleServerOrigin,
    contentSourceId,
    reactVersion,
    dependencyPinningCacheKey: dependencySnapshot.cacheKey,
    dependencyPinningDependencies: dependencySnapshot.dependencies,
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
      dependencySnapshot,
      moduleServerOrigin,
      reactVersion,
      internals.componentLoader,
    );
    if (typeof Layout !== "function") {
      throw COMPILATION_ERROR.create({
        detail: "Invalid layout component",
        context: { layoutPath, type: typeof Layout },
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

  // Prerendered documents must carry the same identity the request-time SSR
  // shell gives them: a layout's `<Head>` owns the title and the head links,
  // and without a render context the Head instances never commit, leaving the
  // built page on the framework's placeholder title.
  const { result: htmlInner, head: requestHead } = await runWithHeadCollector(
    (renderContext) => renderToStringAdapter(element, { reactVersion, renderContext }, adapter),
  );
  const committedHead = resolveCommittedHeadFromHTML(htmlInner, requestHead);
  const title = committedHead?.title ?? "Veryfront App";
  const headElements = buildHeadElements(committedHead);
  const slug = routePathToSlug(routePath);
  const importMapJson = await buildImportMapJson({
    projectDir,
    config: {
      ...config,
      react: { ...config?.react, version: reactVersion },
    } as VeryfrontConfig,
    moduleServerOrigin,
    dependencyPinningCacheKey: dependencySnapshot.cacheKey,
    dependencyPinningDependencies: dependencySnapshot.dependencies,
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
        config,
        projectDir,
        pagePath: pageFile,
        pageType: "tsx",
        releaseAssetManifest,
        isLocalProject: false,
        forceProductionScripts: true,
        nestedLayouts: clientPageIsland?.clientLayouts ?? layoutDescriptors,
        isolatedClientPage: Boolean(clientPageIsland),
        dependencyPinningCacheKey: dependencySnapshot.cacheKey,
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

  // Mirror the request-time shell's head order exactly: the framework import
  // map precedes every collected module script, and the remaining collected
  // elements close the head so a layout's styles win the cascade over the
  // generated project stylesheet.
  const headScripts = headElements.scripts ? `\n  ${headElements.scripts}` : "";
  const headOther = headElements.other ? `\n  ${headElements.other}` : "";
  // The shell owns the viewport only until a layout declares its own; emitting
  // both would ship two competing viewport directives in one document.
  const viewportMeta =
    committedHead?.metas.some((meta) => headMetaSingletonKeyFromRecord(meta) === "meta:viewport")
      ? ""
      : `\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">${viewportMeta}
  <title ${HEAD_SHELL_PROVENANCE_ATTRIBUTE}="true">${escapeHTML(title)}</title>

  <!-- Import map for React dependencies -->
  <script type="importmap">
  ${importMapJson}
  </script>${headScripts}

  ${stylesheetLink}${headOther}
</head>
<body>
${hydrationDataScript}
  <div id="root">${htmlInner}</div>
${hydrationData ? getProdScripts(slug) : ""}
</body>
</html>`;
}

export function renderAppRouteToHTML(args: RenderAppRouteArgs): Promise<string> {
  return renderAppRouteToHTMLWithInternals(args, DEFAULT_RENDERER_INTERNALS);
}

/** Test-only seam for observing the request-scoped component load options. */
export function _renderAppRouteToHTMLForTest(
  args: RenderAppRouteArgs,
  internals: AppRouteRendererInternals,
): Promise<string> {
  return renderAppRouteToHTMLWithInternals(args, internals);
}
