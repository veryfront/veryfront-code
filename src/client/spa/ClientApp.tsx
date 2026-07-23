import {
  type ComponentType,
  type ReactElement,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { RouterProvider, type RouterValue } from "veryfront/router";
import { PageContextProvider, type PageContextValue } from "veryfront/context";
import { type LayoutInfo, LayoutShell } from "./LayoutShell.tsx";
import {
  type ComponentLoadOptions,
  getCachedComponent,
  loadComponent,
  preloadComponent,
} from "./component-loader.ts";
import { snapshotPageData } from "./page-data.ts";
import { RenderErrorBoundary } from "./RenderErrorBoundary.tsx";

/** Heading metadata extracted from page content. */
export interface PageHeading {
  /** Stable heading anchor ID. */
  id: string;
  /** Visible heading text. */
  text: string;
  /** Heading level from 1 to 6. */
  level: number;
}

/** Page payload consumed by the SPA client after initial render or navigation. */
export interface PageDataResponse {
  /** Canonical route slug. */
  slug: string;
  /** Source path used to resolve the page component. */
  pagePath: string;
  /** Source format of the page component. */
  pageType: "mdx" | "md" | "tsx" | "jsx" | "ts" | "js";
  /** Ordered outer-to-inner layout descriptors. */
  layouts: LayoutInfo[];
  /** Provider module paths associated with the page. */
  providers: string[];
  /** Page frontmatter exposed through page context. */
  frontmatter: Record<string, unknown>;
  /** Props passed to the page component. */
  props: Record<string, unknown>;
  /** Route parameters for the matched page. */
  params: Record<string, string | string[]>;
  /** Props keyed by layout source path. */
  layoutProps: Record<string, Record<string, unknown>>;
  /** Heading metadata extracted from page content. */
  headings?: PageHeading[];
  /** Route-scoped CSS generated for this page. */
  css?: string;
  /** CSS action used when the route has no inline CSS payload. */
  cssAction?: "clear";
  /** Indicates that route CSS generation failed on the server. */
  cssError?: string;
  /** Optional application wrapper rendered outside the layout chain. */
  appPath?: string;
  /** Whether the destination requires a full document navigation. */
  requiresFullDocumentNavigation?: boolean;
  /** Production release identifier used by module URL fallbacks. */
  releaseId?: string;
  /** Release asset URLs keyed by logical source path. */
  releaseAssetModules?: Record<string, string>;
}

type PageComponentProps = { params?: Record<string, string>; [key: string]: unknown };
type PageComponentType = ComponentType<PageComponentProps>;
type AppComponentType = ComponentType<{ children: ReactNode }>;

interface ClientAppState {
  currentPath: string;
  pageComponent: PageComponentType | null;
  appComponent: AppComponentType | null;
  layouts: LayoutInfo[];
  layoutProps: Record<string, Record<string, unknown>>;
  pageProps: Record<string, unknown>;
  params: Record<string, string | string[]>;
  frontmatter: Record<string, unknown>;
  headings: PageHeading[];
  releaseAssetModules: Record<string, string> | null;
  releaseId: string | null;
  isNavigating: boolean;
  error: Error | null;
}

interface ReleaseContext {
  releaseAssetModules: Record<string, string> | null;
  releaseId: string | null;
}

/** Props accepted by {@link ClientApp}. */
export interface ClientAppProps {
  /** Initial server-provided page payload. */
  initialData: PageDataResponse;
}

interface ClientRouterBridge {
  navigate?: (
    url: string,
    options?: boolean | { history?: "push" | "replace" | "none" },
  ) => Promise<void>;
  registerNavigationHandler?: (handler: (data: PageDataResponse) => Promise<void>) => void;
  unregisterNavigationHandler?: (handler: (data: PageDataResponse) => Promise<void>) => void;
}

const clientGlobal = globalThis as typeof globalThis & {
  __VERYFRONT_SPA_NAVIGATE__?: (data: PageDataResponse) => Promise<void>;
  __veryfrontSetReleaseAssetModules?: (value: Record<string, string> | null) => void;
  __veryfrontSetReleaseId?: (value: string | null) => void;
  veryFrontRouter?: ClientRouterBridge;
};
const MAX_ROUTE_CSS_BYTES = 2 * 1_024 * 1_024;

function PageLoading(): ReactElement {
  return (
    <div className="veryfront-page-loading" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading page...</span>
    </div>
  );
}

function PageError({ onRetry }: { onRetry: () => void }): ReactElement {
  return (
    <div className="veryfront-page-error">
      <h1>Something went wrong</h1>
      <p>The page could not be loaded. Try again.</p>
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

function normalizeParams(params: Record<string, string | string[]>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v.join("/") : v]),
  );
}

function getQuery(): Record<string, string> {
  if (!globalThis.location) return {};
  return Object.fromEntries(new URLSearchParams(globalThis.location.search));
}

function getDomain(): string {
  return globalThis.location?.hostname ?? "";
}

async function navigateViaRouter(
  url: string,
  history: "push" | "replace" = "push",
): Promise<void> {
  const router = clientGlobal.veryFrontRouter;
  const navigate = router?.navigate;
  if (navigate) {
    await navigate.call(router, url, { history });
    return;
  }
  if (history === "replace") globalThis.location.replace(url);
  else globalThis.location.assign(url);
}

function createClientAppState(
  data: PageDataResponse,
  pageComponent: PageComponentType | null,
  appComponent: AppComponentType | null,
): ClientAppState {
  return {
    currentPath: data.slug || "/",
    pageComponent,
    appComponent,
    layouts: data.layouts ?? [],
    layoutProps: data.layoutProps ?? {},
    pageProps: data.props ?? {},
    params: data.params ?? {},
    frontmatter: data.frontmatter ?? {},
    headings: data.headings ?? [],
    releaseAssetModules: data.releaseAssetModules ?? null,
    releaseId: data.releaseId ?? null,
    isNavigating: false,
    error: null,
  };
}

function toError(_error: unknown): Error {
  return new Error("Navigation failed");
}

function getSafeErrorName(error: unknown): string {
  try {
    if (error instanceof TypeError) return "TypeError";
    if (error instanceof SyntaxError) return "SyntaxError";
    return error instanceof Error ? "Error" : "UnknownError";
  } catch {
    return "UnknownError";
  }
}

function applyRouteCss(data: PageDataResponse): void {
  if (typeof document === "undefined") return;
  const existing = document.getElementById("veryfront-spa-css");
  if (existing && existing.tagName !== "STYLE" && (data.css !== undefined || data.cssAction)) {
    throw new TypeError("Route CSS element has an invalid type");
  }

  if (data.css !== undefined) {
    if (new TextEncoder().encode(data.css).byteLength > MAX_ROUTE_CSS_BYTES) {
      throw new TypeError("Route CSS exceeds the client size limit");
    }
    const style = existing?.tagName === "STYLE"
      ? existing as HTMLStyleElement
      : document.createElement("style");
    if (!style.id) style.id = "veryfront-spa-css";
    if (!style.isConnected) {
      const nonceSource = document.querySelector<HTMLElement>(
        "script[nonce], style[nonce], link[nonce]",
      );
      const nonce = nonceSource?.nonce || nonceSource?.getAttribute("nonce") || "";
      if (nonce) style.setAttribute("nonce", nonce);
      document.head.appendChild(style);
    }
    style.textContent = data.css;
    return;
  }

  if (data.cssAction === "clear") existing?.remove();
  if (data.cssError) {
    if (existing?.tagName === "STYLE") existing.remove();
    console.warn("[Veryfront SPA] Route CSS is unavailable");
  }
}

function getReleaseContext(data: PageDataResponse): ReleaseContext {
  return {
    releaseAssetModules: data.releaseAssetModules ?? null,
    releaseId: data.releaseId ?? null,
  };
}

function applyReleaseContext(context: ReleaseContext): void {
  const setReleaseAssetModules = clientGlobal.__veryfrontSetReleaseAssetModules;
  const setReleaseId = clientGlobal.__veryfrontSetReleaseId;
  setReleaseAssetModules?.call(clientGlobal, context.releaseAssetModules);
  setReleaseId?.call(clientGlobal, context.releaseId);
}

function applyDocumentMetadata(data: PageDataResponse): void {
  if (typeof document === "undefined") return;
  if (typeof data.frontmatter.title === "string") {
    document.title = data.frontmatter.title;
  }
  if (typeof data.frontmatter.description === "string") {
    document.querySelector('meta[name="description"]')?.setAttribute(
      "content",
      data.frontmatter.description,
    );
  }
}

/** Render the SPA application from server-provided page data. */
export function ClientApp({ initialData }: ClientAppProps): ReactElement {
  const initialSnapshot = useMemo(() => {
    try {
      return {
        data: snapshotPageData(initialData),
        errorName: null,
      };
    } catch (error) {
      return {
        data: null,
        errorName: getSafeErrorName(error),
      };
    }
  }, [initialData]);
  useEffect(() => {
    if (initialSnapshot.errorName) {
      console.error("[Veryfront SPA] Initial page data is invalid", {
        errorName: initialSnapshot.errorName,
      });
    }
  }, [initialSnapshot.errorName]);
  const handleRetry = useCallback((): void => {
    globalThis.location?.reload();
  }, []);

  if (!initialSnapshot.data) return <PageError onRetry={handleRetry} />;
  return (
    <RenderErrorBoundary
      fallback={<PageError onRetry={handleRetry} />}
      resetKey={initialSnapshot.data}
    >
      <ClientAppRuntime initialPageData={initialSnapshot.data} />
    </RenderErrorBoundary>
  );
}

function ClientAppRuntime(
  { initialPageData }: { initialPageData: PageDataResponse },
): ReactElement {
  const initialLoadOptions = useMemo<ComponentLoadOptions>(
    () => ({
      releaseAssetModules: initialPageData.releaseAssetModules ?? null,
      releaseId: initialPageData.releaseId ?? null,
    }),
    [initialPageData.releaseAssetModules, initialPageData.releaseId],
  );
  const [state, setState] = useState<ClientAppState>(() =>
    createClientAppState(
      initialPageData,
      getCachedComponent(initialPageData.pagePath, initialLoadOptions),
      initialPageData.appPath
        ? getCachedComponent(initialPageData.appPath, initialLoadOptions) as AppComponentType | null
        : null,
    )
  );

  const navigationSequence = useRef(0);
  const activeReleaseContext = useRef<ReleaseContext>(getReleaseContext(initialPageData));

  useEffect(() => {
    const initialLoadNavigationId = navigationSequence.current;
    let cancelled = false;

    void (async () => {
      try {
        applyReleaseContext(activeReleaseContext.current);
        const cachedPage = getCachedComponent(initialPageData.pagePath, initialLoadOptions);
        const cachedApp = initialPageData.appPath
          ? getCachedComponent(initialPageData.appPath, initialLoadOptions)
          : null;
        const [PageComponent, AppComponent] = await Promise.all([
          cachedPage ?? loadComponent(initialPageData.pagePath, initialLoadOptions),
          initialPageData.appPath
            ? cachedApp ?? loadComponent(initialPageData.appPath, initialLoadOptions)
            : Promise.resolve(null),
        ]);
        if (cancelled || initialLoadNavigationId !== navigationSequence.current) return;
        if (!PageComponent || (initialPageData.appPath && !AppComponent)) {
          setState((prev) => ({
            ...prev,
            isNavigating: false,
            error: new Error("Page component is unavailable"),
          }));
          return;
        }
        setState((prev) => ({
          ...prev,
          pageComponent: PageComponent as PageComponentType,
          appComponent: AppComponent as AppComponentType | null,
          error: null,
        }));
      } catch (error) {
        if (cancelled || initialLoadNavigationId !== navigationSequence.current) return;
        setState((prev) => ({ ...prev, error: toError(error), isNavigating: false }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialLoadOptions, initialPageData]);

  useEffect(() => {
    for (const layout of initialPageData.layouts) {
      preloadComponent(layout.path, initialLoadOptions);
    }
  }, [initialLoadOptions, initialPageData.layouts]);

  const handleNavigate = useCallback(async (data: PageDataResponse): Promise<void> => {
    const navigationId = ++navigationSequence.current;
    const previousReleaseContext = activeReleaseContext.current;
    let releaseContextChanged = false;
    setState((prev) => ({ ...prev, isNavigating: true, error: null }));

    try {
      const pageData = snapshotPageData(data);
      if (pageData.requiresFullDocumentNavigation) {
        applyReleaseContext(previousReleaseContext);
        globalThis.location.assign(globalThis.location.href);
        return;
      }
      const nextReleaseContext = getReleaseContext(pageData);
      releaseContextChanged = true;
      applyReleaseContext(nextReleaseContext);
      const loadOptions: ComponentLoadOptions = {
        releaseAssetModules: pageData.releaseAssetModules ?? null,
        releaseId: pageData.releaseId ?? null,
      };
      const layoutLoads = pageData.layouts.map((layout) => loadComponent(layout.path, loadOptions));
      const [PageComponent, AppComponent, ...LayoutComponents] = await Promise.all([
        loadComponent(pageData.pagePath, loadOptions),
        pageData.appPath ? loadComponent(pageData.appPath, loadOptions) : Promise.resolve(null),
        ...layoutLoads,
      ]);
      if (navigationId !== navigationSequence.current) return;

      if (!PageComponent) {
        throw new Error("Page component is unavailable");
      }
      if (pageData.appPath && !AppComponent) {
        throw new Error("Application component is unavailable");
      }
      if (LayoutComponents.some((component) => !component)) {
        throw new Error("Page layout component is unavailable");
      }

      applyRouteCss(pageData);
      applyDocumentMetadata(pageData);

      activeReleaseContext.current = nextReleaseContext;
      setState(
        createClientAppState(
          pageData,
          PageComponent,
          AppComponent as AppComponentType | null,
        ),
      );
    } catch (error) {
      if (navigationId !== navigationSequence.current) return;
      if (releaseContextChanged) {
        try {
          applyReleaseContext(previousReleaseContext);
        } catch (restoreError) {
          console.error("[Veryfront SPA] Release context restoration failed", {
            errorName: getSafeErrorName(restoreError),
          });
        }
      }
      console.error("[Veryfront SPA] Navigation failed", {
        errorName: getSafeErrorName(error),
      });
      setState((prev) => ({
        ...prev,
        isNavigating: false,
        error: toError(error),
      }));
    }
  }, []);

  useEffect(() => {
    const registeredRouter = clientGlobal.veryFrontRouter;
    clientGlobal.__VERYFRONT_SPA_NAVIGATE__ = handleNavigate;
    registeredRouter?.registerNavigationHandler?.(handleNavigate);

    return () => {
      navigationSequence.current++;
      if (clientGlobal.__VERYFRONT_SPA_NAVIGATE__ === handleNavigate) {
        delete clientGlobal.__VERYFRONT_SPA_NAVIGATE__;
      }
      registeredRouter?.unregisterNavigationHandler?.(handleNavigate);
    };
  }, [handleNavigate]);

  const normalizedParams = useMemo(() => normalizeParams(state.params), [state.params]);
  const query = getQuery();

  // Seed the route-match fields that the live navigation store cannot derive.
  // RouterProvider owns the live URL subscription.
  const routerValue: RouterValue = {
    domain: getDomain(),
    path: state.currentPath,
    pathname: state.currentPath,
    params: normalizedParams,
    query,
    isPreview: false,
    isMounted: false,
    navigate: async (path) => {
      await navigateViaRouter(path);
    },
    push: async (path) => {
      await navigateViaRouter(path);
    },
    replace: async (path) => {
      await navigateViaRouter(path, "replace");
    },
    reload: async () => {
      globalThis.location.reload();
    },
  };

  // Page context seed. PageContextProvider derives the
  // live `path`/`query`/`params` from the router above.
  const pageContext: PageContextValue = {
    slug: state.currentPath || "/",
    path: state.currentPath,
    params: normalizedParams,
    query,
    frontmatter: state.frontmatter,
    headings: state.headings,
    mdxHeadings: state.headings,
  };

  const handleRetry = useCallback((): void => {
    globalThis.location?.reload();
  }, []);

  function renderPageContent(): ReactElement {
    if (state.error) return <PageError onRetry={handleRetry} />;
    if (!state.pageComponent) return <PageLoading />;

    const { pageComponent: PageComponent, pageProps } = state;

    return (
      <Suspense fallback={<PageLoading />}>
        <PageComponent {...pageProps} params={normalizedParams} />
      </Suspense>
    );
  }

  const pageWithLayouts = (
    <LayoutShell
      layouts={state.layouts}
      layoutProps={state.layoutProps}
      releaseAssetModules={state.releaseAssetModules}
      releaseId={state.releaseId}
    >
      {renderPageContent()}
    </LayoutShell>
  );
  const AppComponent = state.appComponent;
  const pageTree = AppComponent ? <AppComponent>{pageWithLayouts}</AppComponent> : pageWithLayouts;
  const guardedPageTree = (
    <RenderErrorBoundary
      fallback={<PageError onRetry={handleRetry} />}
      resetKey={state.pageProps}
    >
      {pageTree}
    </RenderErrorBoundary>
  );

  return (
    <RouterProvider router={routerValue}>
      <PageContextProvider pageContext={pageContext}>
        <div
          className={`veryfront-app ${state.isNavigating ? "veryfront-navigating" : ""}`}
          data-navigating={state.isNavigating}
        >
          {guardedPageTree}
        </div>
      </PageContextProvider>
    </RouterProvider>
  );
}
