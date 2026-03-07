import { type ComponentType, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { type Router, RouterProvider } from "veryfront/router";
import { type PageContext, PageContextProvider } from "veryfront/context";
import { type LayoutInfo, LayoutShell } from "./LayoutShell.tsx";
import { getCachedComponent, loadComponent, preloadComponent } from "./component-loader.ts";
import { PAGE_NOT_FOUND } from "#veryfront/errors";

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
  PageComponent: PageComponentType | null;
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

export function ClientApp({ initialData }: ClientAppProps): JSX.Element {
  const [state, setState] = useState<ClientAppState>(() => {
    const cachedComponent = getCachedComponent(initialData.pagePath);

    return {
      currentPath: initialData.slug || "/",
      PageComponent: cachedComponent,
      layouts: initialData.layouts || [],
      layoutProps: initialData.layoutProps || {},
      pageProps: initialData.props || {},
      params: initialData.params || {},
      frontmatter: initialData.frontmatter || {},
      isNavigating: false,
      error: null,
    };
  });

  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    if (state.PageComponent || !initialData.pagePath) return;

    (async () => {
      const Component = await loadComponent(initialData.pagePath);
      if (!Component) return;
      setState((prev) => ({ ...prev, PageComponent: Component }));
    })();
  }, [initialData.pagePath, state.PageComponent]);

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

      setState({
        currentPath: data.slug || "/",
        PageComponent,
        layouts: data.layouts || [],
        layoutProps: data.layoutProps || {},
        pageProps: data.props || {},
        params: data.params || {},
        frontmatter: data.frontmatter || {},
        isNavigating: false,
        error: null,
      });
    } catch (error) {
      console.error("[Veryfront SPA] Navigation failed:", error);
      setState((prev) => ({
        ...prev,
        isNavigating: false,
        error: error instanceof Error ? error : new Error(String(error)),
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
  const query = useMemo(() => getQuery(), [state.currentPath]);

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
    if (!state.PageComponent) return <PageLoading />;

    const { PageComponent, pageProps, params } = state;

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
