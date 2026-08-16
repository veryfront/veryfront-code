/**
 * The initial hydration render: read the server-written hydration data, load
 * the page, its layouts, the app wrapper and the error boundary, then hydrate
 * (or, for RSC client pages, render) into the document.
 *
 * SPA navigation after this point is the router's job.
 */

import type {
  ClientRouter,
  HydrationRuntimeEnv,
  ModuleNamespace,
  PageDataPayload,
  ReactLike,
  ReactRoot,
} from "./env.ts";
import type { RuntimeLogging } from "./shared.ts";
import { normalizeRouteParams } from "./shared.ts";
import type { ComponentLoader } from "./component-loader.ts";
import type { SnapshotModuleImporter } from "./snapshot-modules.ts";
import { appendDependencyPinningVersion, buildPinnedRscModuleUrl } from "./module-urls.ts";
import { findServerHydrationDataElement } from "./hydration-data.ts";

/**
 * True when a dynamic import failed because the module could not be fetched
 * (404 / network), as opposed to being fetched and then failing to link or
 * evaluate. Browsers word this as a TypeError naming the dynamic import itself;
 * link failures are SyntaxErrors and evaluation failures are whatever the
 * module threw. The wording is matched against the dynamic import phrases only,
 * so app code throwing "Failed to load user profile" at module scope is not
 * mistaken for a missing module.
 */
export function isModuleNotFoundError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof SyntaxError) return false;
  const message = String((error as Error).message || error);
  // Safari reports a failed dynamic import as a bare "Load failed", with no
  // wording that names modules at all. Matched exactly, with no trailing
  // punctuation allowed, rather than as a
  // substring: the phrase is short enough that a loose match would swallow an
  // application error like "Image load failed" and retry a module that had in
  // fact evaluated. The other engines name the module in the message.
  if (/^load failed$/i.test(message.trim())) return true;
  return /(?:dynamically imported module|Importing a module script failed|Failed to load module script)/i
    .test(message);
}

/**
 * Picks the error that describes the failure best. An error that proves a
 * module was reached (link or evaluation) always beats one that only proves a
 * URL could not be fetched, because a 404 on a path that was never expected to
 * exist explains nothing. Otherwise the earlier error wins: it names the module
 * the router actually intended to load.
 */
export function preferReachedModuleError(earlier: unknown, later: unknown): unknown {
  if (!earlier) return later;
  if (!later) return earlier;
  if (isModuleNotFoundError(earlier) && !isModuleNotFoundError(later)) return later;
  return earlier;
}

/**
 * True when `error` proves `<route>.js` loaded as a module and then threw while
 * *evaluating* — a runtime error from the module's own code.
 *
 * A `SyntaxError` means the module never linked (a missing export, or an HTML
 * shell a proxy returned for a miss) and a fetch failure (see
 * {@link isModuleNotFoundError}) means it was never served — both are cases the
 * `<route>/index.js` retry exists to recover. Anything else is code that ran
 * inside a module that *did* load, which proves `<route>.js` is the real served
 * file: retrying a sibling `<route>/index.js` can only 404.
 */
function isReachedModuleEvaluationError(error: unknown): boolean {
  // A rejection that is not an `Error` can only have come from module code that
  // ran and threw it: the loader's own failures reject with `TypeError` or
  // `SyntaxError`. Treating a thrown string or `null` as "not reached" sent the
  // loader after `<route>/index.js`, which can only 404 and bury the throw.
  if (!(error instanceof Error)) return true;
  if (error instanceof SyntaxError) return false;
  return !isModuleNotFoundError(error);
}

/**
 * Loads a Pages Router page, retrying at `<route>/index.js` because both
 * pages/about.tsx and pages/about/index.tsx are valid sources for the same
 * route. The retry stays unconditional for missing-module and proxy-shell
 * rejections — gating it on the wording of those turned any unrecognized
 * wording into a blank page. It is skipped only when the first attempt reached
 * a module and threw at evaluation: `<route>.js` then exists, so probing
 * `<route>/index.js` can only 404 and bury the real error under a misleading
 * "module not found" (issue #3667, as surfaced by the #3661 adapter crash).
 * Error selection, not the retry, is what must stay precise.
 */
export async function loadPageModuleWithIndexFallback(
  basePath: string,
  pageSlug: string,
  pageModuleError: unknown,
  importModule: (moduleUrl: string) => Promise<ModuleNamespace>,
): Promise<ModuleNamespace> {
  try {
    return await importModule(basePath + ".js");
  } catch (error) {
    const routeError = preferReachedModuleError(pageModuleError, error);

    // An index slug already resolves to <route>/index.js, so the retry would
    // ask for <route>/index/index.js.
    if (pageSlug === "index" || pageSlug.endsWith("/index")) throw routeError;

    // <route>.js loaded and threw at evaluation — it is the served file, so the
    // retry is guaranteed useless. Surface the real error, not a sibling 404.
    if (isReachedModuleEvaluationError(error)) throw routeError;

    try {
      return await importModule(basePath + "/index.js");
    } catch (indexError) {
      throw preferReachedModuleError(routeError, indexError);
    }
  }
}

/** True when a project path lives under the App Router root (default `app`). */
export function isAppRouterPath(
  path: string | undefined,
  appRouterRoot: string,
): boolean {
  const normalizedPath = typeof path === "string" ? path.replace(/^\/+/, "") : "";
  return normalizedPath === appRouterRoot ||
    normalizedPath.startsWith(appRouterRoot + "/");
}

/** True for the App Router's root layout, the one that renders the document. */
export function isRootAppLayoutPath(
  path: string | undefined,
  appRouterRoot: string,
): boolean {
  const normalizedPath = typeof path === "string" ? path.replace(/^\/+/, "") : "";
  const pathWithoutExtension = normalizedPath.replace(/\.(?:tsx|jsx|ts|js)$/, "");
  return pathWithoutExtension === appRouterRoot + "/layout";
}

/**
 * A root app/layout.tsx renders <html><body>. Hydrating that inside #root would
 * nest a second document, so the body's children are lifted out.
 */
function unwrapAppRouterDocumentLayout(LayoutComponent: unknown, React: ReactLike) {
  return function AppRouterDocumentLayout(props: Record<string, unknown>) {
    const element = (LayoutComponent as (p: Record<string, unknown>) => unknown)(props);
    const asElement = element as { type?: unknown; props?: { children?: unknown } };
    if (!React.isValidElement(element) || asElement.type !== "html") {
      return element;
    }

    const body = React.Children.toArray(asElement.props?.children).find((child) =>
      React.isValidElement(child) && (child as { type?: unknown }).type === "body"
    ) as { props?: { children?: unknown } } | undefined;
    return body?.props?.children ?? props.children;
  };
}

export interface HydrationRendererDeps {
  env: HydrationRuntimeEnv;
  logging: RuntimeLogging;
  componentLoader: ComponentLoader;
  snapshotModules: SnapshotModuleImporter;
  moduleServerUrl: string;
  router: ClientRouter;
}

export interface HydrationRenderer {
  renderPage(pathname: string): Promise<void>;
  /** Publishes renderPage for HMR, renders, then seeds history for back-nav. */
  start(): void;
}

export function createHydrationRenderer(deps: HydrationRendererDeps): HydrationRenderer {
  const { env, logging, componentLoader, snapshotModules, moduleServerUrl } = deps;
  const { window, document, React, RouterProvider, PageContextProvider } = env;
  const { DEBUG, log, logError } = logging;
  const { loadComponent, pathToModuleUrl } = componentLoader;
  const { importSnapshotBoundModule } = snapshotModules;

  async function renderPage(pathname: string): Promise<void> {
    const resolvedPathname = (() => {
      const input = typeof pathname === "string" ? pathname : window.location.pathname;
      try {
        return new URL(input, window.location.origin).pathname || "/";
      } catch (_) {
        /* expected: invalid URL input, fall back to string splitting */
        const [pathOnly] = String(input || "/").split(/[?#]/);
        return pathOnly || "/";
      }
    })();

    const dataScript = findServerHydrationDataElement(document);
    if (!dataScript) {
      logError("Hydration data not found");
      return;
    }

    let data: PageDataPayload = {};
    try {
      data = JSON.parse(dataScript.textContent || "{}");
    } catch (parseError) {
      logError("Failed to parse hydration data:", parseError);
      return;
    }

    log("Hydration data:", data);

    // Set studioEmbed flag for module loading (affects query params)
    if (data.studioEmbed && window.__veryfrontSetStudioEmbed) {
      window.__veryfrontSetStudioEmbed(true);
    }
    if (window.__veryfrontSetReleaseId) {
      window.__veryfrontSetReleaseId(data.releaseId || null);
    }
    if (data.releaseAssetModules && window.__veryfrontSetReleaseAssetModules) {
      window.__veryfrontSetReleaseAssetModules(data.releaseAssetModules);
    }

    try {
      let pageModule: ModuleNamespace | undefined;
      const pagePath = typeof data.pagePath === "string" ? data.pagePath : "";
      const normalizedPagePath = pagePath.replace(/^\/+/, "");
      const normalizedAppRouterRoot =
        typeof data.appRouterRoot === "string" && data.appRouterRoot.replace(/^\/+|\/+$/g, "")
          ? data.appRouterRoot.replace(/^\/+|\/+$/g, "")
          : "app";
      const hasReleaseAssetModules = data.releaseAssetModules &&
        Object.keys(data.releaseAssetModules).length > 0;

      const shouldRenderRscClientPage = data.clientModuleStrategy === "rsc-module" &&
        !hasReleaseAssetModules &&
        isAppRouterPath(normalizedPagePath, normalizedAppRouterRoot);
      const isolatedClientPage = data.isolatedClientPage === true;

      const loadHydrationComponent = async (
        path: string | undefined,
        preferRscModule: boolean,
      ): Promise<unknown> => {
        const normalizedPath = typeof path === "string" ? path.replace(/^\/+/, "") : "";
        if (preferRscModule && isAppRouterPath(normalizedPath, normalizedAppRouterRoot)) {
          const moduleUrl = buildPinnedRscModuleUrl(path as string, data);
          log("Loading App Router component from RSC module:", moduleUrl);
          const module = await importSnapshotBoundModule(moduleUrl);
          return module.default || module;
        }

        return loadComponent(path, data);
      };

      let pageModuleError: unknown = null;

      if (data.pagePath) {
        const moduleUrl = shouldRenderRscClientPage
          ? buildPinnedRscModuleUrl(data.pagePath, data)
          : pathToModuleUrl(data.pagePath, data.studioEmbed, data);
        log("Loading page from hydration data:", moduleUrl);

        try {
          pageModule = await importSnapshotBoundModule(moduleUrl);
        } catch (error) {
          pageModuleError = error;
          logError("Failed to load page from hydration data:", error);
        }
      }

      if (!pageModule) {
        const pageSlug = resolvedPathname === "/" ? "index" : resolvedPathname.slice(1);
        log("Falling back to Pages Router pattern:", pageSlug);

        const prefix = pageSlug.startsWith("@/") ? "" : "/pages";
        const basePath = moduleServerUrl + prefix + "/" + pageSlug;

        pageModule = await loadPageModuleWithIndexFallback(
          basePath,
          pageSlug,
          pageModuleError,
          (moduleUrl) => importSnapshotBoundModule(appendDependencyPinningVersion(moduleUrl, data)),
        );
      }

      if (!pageModule) {
        logError("Page module failed to load");
        return;
      }

      const PageComponent = pageModule.default || pageModule;
      if (!PageComponent) {
        logError("Page component not found");
        return;
      }

      // Normalize catch-all params (arrays -> joined strings) so the hydrated
      // props and page context match the server render.
      const normalizedParams = normalizeRouteParams(data.params);
      const pageProps = { ...(data.props || {}), params: normalizedParams };
      let tree = React.createElement(PageComponent, pageProps);

      const layouts = data.layouts;
      if (layouts?.length) {
        for (let i = layouts.length - 1; i >= 0; i--) {
          const layout = layouts[i];
          if (!layout) continue;
          const LayoutComponent = await loadHydrationComponent(
            layout.path,
            shouldRenderRscClientPage,
          );
          if (LayoutComponent) {
            const WrappedLayoutComponent =
              shouldRenderRscClientPage && isRootAppLayoutPath(layout.path, normalizedAppRouterRoot)
                ? unwrapAppRouterDocumentLayout(LayoutComponent, React)
                : LayoutComponent;
            const layoutProps = data.layoutProps?.[layout.path] || {};
            tree = React.createElement(
              WrappedLayoutComponent,
              { ...layoutProps, children: tree },
            );
          }
        }
      }

      if (data.appPath && !isolatedClientPage) {
        const AppComponent = await loadHydrationComponent(data.appPath, shouldRenderRscClientPage);
        if (AppComponent) {
          tree = React.createElement(AppComponent, { children: tree });
        }
      }

      // App-router error.tsx boundary. Wraps the page (inside the providers,
      // matching the server wrap) so a throw during render/hydration is caught
      // on the client and error.tsx renders — with a working reset().
      if (data.errorPath) {
        const ErrorComponent = await loadHydrationComponent(
          data.errorPath,
          shouldRenderRscClientPage,
        );
        if (ErrorComponent) {
          class AppRouterErrorBoundary extends React.Component {
            constructor(props: Record<string, unknown>) {
              super(props);
              this.state = { hasError: false, error: null };
            }
            static getDerivedStateFromError(error: unknown) {
              return { hasError: true, error: error };
            }
            render() {
              if (this.state.hasError) {
                return React.createElement(ErrorComponent, {
                  error: this.state.error,
                  reset: () => this.setState({ hasError: false, error: null }),
                });
              }
              return this.props.children;
            }
          }
          tree = React.createElement(AppRouterErrorBoundary, null, tree);
        }
      }

      const headings = data.headings || [];
      const pageContext = {
        slug: data.slug || "",
        path: data.pagePath || resolvedPathname,
        params: normalizedParams,
        query: Object.fromEntries(new URLSearchParams(window.location.search)),
        frontmatter: data.frontmatter || {},
        data: data.props || {},
        headings,
        mdxHeadings: headings, // Alias for backwards compatibility
      };

      tree = React.createElement(PageContextProvider, { pageContext, children: tree });
      tree = React.createElement(RouterProvider, { router: deps.router, children: tree });

      const container = isolatedClientPage
        ? document.getElementById("veryfront-page-island")
        : document.getElementById("root");
      if (!container) {
        if (isolatedClientPage) {
          throw new Error("Isolated client page root not found");
        }
        return;
      }

      if (container.__reactRoot) {
        container.__reactRoot.render(tree);
        log("Page re-rendered");
        return;
      }

      if (shouldRenderRscClientPage) {
        container.__reactRoot = env.createRoot(container);
        container.__reactRoot.render(tree);
        log("Client-side React app rendered successfully");
      } else {
        const { hydrateRoot } = await import("react-dom/client") as {
          hydrateRoot: (container: unknown, tree: unknown, options?: unknown) => ReactRoot;
        };
        const options = {
          identifierPrefix: "vf",
          onRecoverableError: (error: Error) => {
            if (data.dev && DEBUG) {
              log("Hydration mismatch (suppressed):", error.message);
            }
          },
        };

        container.__reactRoot = hydrateRoot(container, tree, options);
        log("Client-side React app hydrated successfully");
      }

      if (window.__veryfrontHydrationComplete) {
        window.__veryfrontHydrationComplete();
      }
    } catch (error) {
      logError("Client initialization error:", error);

      if (window.__veryfrontHydrationFailed) {
        window.__veryfrontHydrationFailed(error);
      }
    }
  }

  function start(): void {
    // Expose renderPage for HMR to trigger re-render after module updates
    window.__veryfrontRenderPage = renderPage;

    void renderPage(window.location.pathname);

    // Store initial page data in history state for instant back navigation
    const initialDataScript = findServerHydrationDataElement(document);
    if (initialDataScript) {
      try {
        const pageData = JSON.parse(initialDataScript.textContent || "{}");
        if (pageData.pagePath) {
          window.history.replaceState({ pageData, scrollY: 0 }, "", window.location.href);
          log("Stored initial page data in history state");
        }
      } catch (_) {
        /* expected: hydration data JSON parse errors are non-critical */
      }
    }

    // Note: popstate is handled by the router for SPA navigation. This module
    // only handles the initial page render.
  }

  return { renderPage, start };
}
