import { type ComponentType, Suspense, useCallback, useEffect, useState } from "react";
import { type Router, RouterProvider } from "../Router.tsx";
import { type PageContext, PageContextProvider } from "../usePageContext.tsx";
import { type LayoutInfo, LayoutShell } from "./LayoutShell.tsx";
import { getCachedComponent, loadComponent, preloadComponent } from "./component-loader.ts";

export interface PageDataResponse {
  slug: string;
  pagePath: string;
  pageType: "mdx" | "tsx" | "jsx" | "ts" | "js";
  layouts: LayoutInfo[];
  providers: string[];
  frontmatter: Record<string, unknown>;
  props: Record<string, unknown>;
  params: Record<string, string | string[]>;
  layoutProps: Record<string, Record<string, unknown>>;
}

interface ClientAppState {
  currentPath: string;
  PageComponent:
    | ComponentType<{ params?: Record<string, string | string[]>; [key: string]: unknown }>
    | null;
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

export function ClientApp({ initialData }: ClientAppProps): JSX.Element {
  const [state, setState] = useState<ClientAppState>(() => {
    // Try to get the initial page component from cache (set during SSR hydration)
    const cachedComponent = getCachedComponent(initialData.pagePath);

    return {
      currentPath: initialData.slug || "/",
      PageComponent: cachedComponent as
        | ComponentType<{
          params?: Record<string, string | string[]>;
          [key: string]: unknown;
        }>
        | null,
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

  // Load initial page component if not cached
  useEffect(() => {
    if (!state.PageComponent && initialData.pagePath) {
      loadComponent(initialData.pagePath).then((Component) => {
        if (Component) {
          setState((prev) => ({
            ...prev,
            PageComponent: Component as ComponentType<{
              params?: Record<string, string | string[]>;
              [key: string]: unknown;
            }>,
          }));
        }
      });
    }
  }, [initialData.pagePath, state.PageComponent]);

  // Preload layout components
  useEffect(() => {
    for (const layout of initialData.layouts || []) {
      preloadComponent(layout.path);
    }
  }, [initialData.layouts]);

  // Mark as mounted for SSR hydration
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Navigation handler - called by the router
  const handleNavigate = useCallback(async (data: PageDataResponse) => {
    setState((prev) => ({
      ...prev,
      isNavigating: true,
      error: null,
    }));

    try {
      // Preload layouts in parallel with page component
      const layoutPreloads = (data.layouts || []).map((l) => preloadComponent(l.path));
      const [PageComponent] = await Promise.all([
        loadComponent(data.pagePath),
        ...layoutPreloads,
      ]);

      if (!PageComponent) {
        throw new Error(`Failed to load page component: ${data.pagePath}`);
      }

      // Update document title if provided
      if (data.frontmatter?.title) {
        document.title = String(data.frontmatter.title);
      }

      setState({
        currentPath: data.slug || "/",
        PageComponent: PageComponent as ComponentType<{
          params?: Record<string, string | string[]>;
          [key: string]: unknown;
        }>,
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

  // Register navigation handler globally and with router
  useEffect(() => {
    // Global handler for direct access
    globalThis.__VERYFRONT_SPA_NAVIGATE__ = handleNavigate;

    // Register with router if available
    if (globalThis.veryFrontRouter?.registerNavigationHandler) {
      globalThis.veryFrontRouter.registerNavigationHandler(handleNavigate);
    }

    return () => {
      delete globalThis.__VERYFRONT_SPA_NAVIGATE__;
    };
  }, [handleNavigate]);

  // Create router value
  const routerValue: Router = {
    domain: typeof globalThis !== "undefined" && globalThis.location
      ? globalThis.location.hostname
      : "",
    path: state.currentPath,
    pathname: state.currentPath,
    params: Object.fromEntries(
      Object.entries(state.params).map(([k, v]) => [k, Array.isArray(v) ? v.join("/") : v]),
    ),
    query: typeof globalThis !== "undefined" && globalThis.location
      ? Object.fromEntries(new URLSearchParams(globalThis.location.search))
      : {},
    isPreview: false,
    isMounted,
    navigate: async (path, _options) => {
      const url = typeof path === "string" ? path : path.pathname;
      if (globalThis.veryFrontRouter && "navigate" in globalThis.veryFrontRouter) {
        await (globalThis.veryFrontRouter as { navigate: (url: string) => Promise<void> }).navigate(
          url,
        );
      }
    },
    push: async (path, _options) => {
      const url = typeof path === "string" ? path : path.pathname;
      if (globalThis.veryFrontRouter && "navigate" in globalThis.veryFrontRouter) {
        await (globalThis.veryFrontRouter as { navigate: (url: string) => Promise<void> }).navigate(
          url,
        );
      }
    },
    replace: async (path, _options) => {
      const url = typeof path === "string" ? path : path.pathname;
      if (globalThis.veryFrontRouter && "navigate" in globalThis.veryFrontRouter) {
        await (globalThis.veryFrontRouter as {
          navigate: (url: string, push?: boolean) => Promise<void>;
        }).navigate(url, false);
      }
    },
    reload: () => {
      globalThis.location.reload();
    },
  };

  // Create page context value
  const pageContextValue: PageContext = {
    slug: state.currentPath,
    path: state.currentPath,
    params: Object.fromEntries(
      Object.entries(state.params).map(([k, v]) => [k, Array.isArray(v) ? v.join("/") : v]),
    ),
    query: typeof globalThis !== "undefined" && globalThis.location
      ? Object.fromEntries(new URLSearchParams(globalThis.location.search))
      : {},
    frontmatter: state.frontmatter,
  };

  // Handle retry after error
  const handleRetry = useCallback(() => {
    globalThis.location.reload();
  }, []);

  // Render loading state during navigation
  const renderPageContent = () => {
    if (state.error) {
      return <PageError error={state.error} onRetry={handleRetry} />;
    }

    if (!state.PageComponent) {
      return <PageLoading />;
    }

    const { PageComponent, pageProps, params } = state;

    return (
      <Suspense fallback={<PageLoading />}>
        <PageComponent {...pageProps} params={params} />
      </Suspense>
    );
  };

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

export default ClientApp;
