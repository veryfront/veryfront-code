import { type ComponentType, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { type Router, RouterProvider } from "veryfront/router";
import { type PageContext, PageContextProvider } from "veryfront/context";
import { type LayoutInfo, LayoutShell } from "./LayoutShell.tsx";
import { getCachedComponent, loadComponent, preloadComponent } from "./component-loader.ts";
import { PAGE_NOT_FOUND } from "#veryfront/errors/error-registry.ts";

export interface PageDataResponse {
  slug: string;
  pagePath: string;
  pageType: "mdx" | "md" | "tsx" | "jsx" | "ts" | "js";
  layouts: LayoutInfo[];
  providers: string[];
  frontmatter: Record<string, unknown>;
  props: Record<string, unknown>;
  params: Record<string, string | string[]>;
  layoutProps: Record<string, Record<string, unknown>>;
}

type PageComponentProps = { params?: Record<string, string | string[]>; [key: string]: unknown };
type PageComponentType = ComponentType<PageComponentProps>;

interface ClientAppState {
  currentPath: string;
  pageComponent: PageComponentType | null;
  layouts: LayoutInfo[];
  layoutProps: Record<string, Record<string, unknown>>;
  pageProps: Record<string, unknown>;
  params: Record<string, string | string[]>;
  frontmatter: Record<string, unknown>;
  isNavigating: boolean;
  error: Error | null;
}

interface ClientAppProps {
  initialData: PageDataResponse;
}

declare global {
  interface Window {
    __VERYFRONT_SPA_NAVIGATE__?: (data: PageDataResponse) => Promise<void>;
    veryFrontRouter?: {
      registerNavigationHandler?: (handler: (data: PageDataResponse) => Promise<void>) => void;
    };
  }
}

function PageLoading(): JSX.Element {
  return (
    <div className="veryfront-page-loading" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading page...</span>
    </div>
  );
}

function PageError({ error, onRetry }: { error: Error; onRetry: () => void }): JSX.Element {
  return (
    <div className="veryfront-page-error">
      <h1>Something went wrong</h1>
      <p>{error.message}</p>
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

function getUrl(path: string | { pathname: string }): string {
  return typeof path === "string" ? path : path.pathname;
}

async function navigateViaRouter(url: string, push?: boolean): Promise<void> {
  const router = globalThis.veryFrontRouter;
  if (!router || !("navigate" in router)) return;

  await (router as { navigate: (url: string, push?: boolean) => Promise<void> }).navigate(
    url,
    push,
  );
}

function createClientAppState(
  data: PageDataResponse,
  pageComponent: PageComponentType | null,
): ClientAppState {
  return {
    currentPath: data.slug || "/",
    pageComponent,
    layouts: data.layouts ?? [],
    layoutProps: data.layoutProps ?? {},
    pageProps: data.props ?? {},
    params: data.params ?? {},
    frontmatter: data.frontmatter ?? {},
    isNavigating: false,
    error: null,
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function ClientApp({ initialData }: ClientAppProps): JSX.Element {
  const [state, setState] = useState<ClientAppState>(() =>
    createClientAppState(
      initialData,
      getCachedComponent(initialData.pagePath),
    )
  );

  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    if (state.pageComponent || !initialData.pagePath) return;

    (async () => {
      const Component = await loadComponent(initialData.pagePath);
      if (!Component) return;
      setState((prev) => ({ ...prev, pageComponent: Component }));
    })();
  }, [initialData.pagePath, state.pageComponent]);

  useEffect(() => {
    for (const layout of initialData.layouts || []) preloadComponent(layout.path);
  }, [initialData.layouts]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const handleNavigate = useCallback(async (data: PageDataResponse): Promise<void> => {
    setState((prev) => ({ ...prev, isNavigating: true, error: null }));

    try {
      const layoutPreloads = (data.layouts || []).map((l) => preloadComponent(l.path));
      const [PageComponent] = await Promise.all([loadComponent(data.pagePath), ...layoutPreloads]);

      if (!PageComponent) {
        throw PAGE_NOT_FOUND.create({ detail: `Failed to load page component: ${data.pagePath}` });
      }

      if (data.frontmatter?.title) document.title = String(data.frontmatter.title);

      setState(createClientAppState(data, PageComponent));
    } catch (error) {
      console.error("[Veryfront SPA] Navigation failed:", error);
      setState((prev) => ({
        ...prev,
        isNavigating: false,
        error: toError(error),
      }));
    }
  }, []);

  useEffect(() => {
    globalThis.__VERYFRONT_SPA_NAVIGATE__ = handleNavigate;
    globalThis.veryFrontRouter?.registerNavigationHandler?.(handleNavigate);

    return () => {
      delete globalThis.__VERYFRONT_SPA_NAVIGATE__;
    };
  }, [handleNavigate]);

  const normalizedParams = useMemo(() => normalizeParams(state.params), [state.params]);

  // Keep `query` in lock-step with the live URL. A query-only navigation
  // (`/?thread=a` → `/?thread=b`) keeps the same path, and the router changes the
  // URL via `history.pushState`, which fires no event — so without this the query
  // would stay stale until the *next* navigation (the "two clicks to switch" bug,
  // which could also momentarily point the page at the wrong thread). We hold the
  // search string in state and refresh it by patching pushState/replaceState (plus
  // popstate for back/forward), so `query` updates the instant the URL does.
  const [search, setSearch] = useState(() =>
    typeof globalThis.location === "undefined" ? "" : globalThis.location.search
  );
  useEffect(() => {
    if (typeof globalThis.location === "undefined") return;
    const sync = () => setSearch(globalThis.location.search);
    const { history } = globalThis;
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;
    history.pushState = function (
      this: History,
      ...args: Parameters<History["pushState"]>
    ): void {
      originalPush.apply(this, args);
      sync();
    };
    history.replaceState = function (
      this: History,
      ...args: Parameters<History["replaceState"]>
    ): void {
      originalReplace.apply(this, args);
      sync();
    };
    globalThis.addEventListener("popstate", sync);
    sync();
    return () => {
      history.pushState = originalPush;
      history.replaceState = originalReplace;
      globalThis.removeEventListener("popstate", sync);
    };
  }, []);
  const query = useMemo(() => getQuery(), [state.currentPath, search]);

  const routerValue: Router = {
    domain: getDomain(),
    path: state.currentPath,
    pathname: state.currentPath,
    params: normalizedParams,
    query,
    isPreview: false,
    isMounted,
    navigate: async (path, _options) => {
      await navigateViaRouter(getUrl(path));
    },
    push: async (path, _options) => {
      await navigateViaRouter(getUrl(path));
    },
    replace: async (path, _options) => {
      await navigateViaRouter(getUrl(path), false);
    },
    reload: () => {
      globalThis.location.reload();
    },
  };

  const pageContextValue: PageContext = {
    slug: state.currentPath,
    path: state.currentPath,
    params: normalizedParams,
    query,
    frontmatter: state.frontmatter,
  };

  const handleRetry = useCallback((): void => {
    globalThis.location.reload();
  }, []);

  function renderPageContent(): JSX.Element {
    if (state.error) return <PageError error={state.error} onRetry={handleRetry} />;
    if (!state.pageComponent) return <PageLoading />;

    const { pageComponent: PageComponent, pageProps, params } = state;

    return (
      <Suspense fallback={<PageLoading />}>
        <PageComponent {...pageProps} params={params} />
      </Suspense>
    );
  }

  return (
    <RouterProvider router={routerValue}>
      <PageContextProvider pageContext={pageContextValue}>
        <div
          className={`veryfront-app ${state.isNavigating ? "veryfront-navigating" : ""}`}
          data-navigating={state.isNavigating}
        >
          <LayoutShell layouts={state.layouts} layoutProps={state.layoutProps}>
            {renderPageContent()}
          </LayoutShell>
        </div>
      </PageContextProvider>
    </RouterProvider>
  );
}
