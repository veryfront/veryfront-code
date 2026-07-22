import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type ReactElement,
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
import { getCachedComponent, loadComponent, preloadComponent } from "./component-loader.ts";
import {
  LAYOUT_NOT_FOUND,
  PAGE_NOT_FOUND,
  RENDER_ERROR,
} from "#veryfront/errors/error-registry.ts";

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
  renderVersion: number;
}

interface ClientAppProps {
  initialData: PageDataResponse;
}

interface ClientRouterBridge {
  navigate?: (url: string, push?: boolean) => Promise<void>;
  registerNavigationHandler?: (
    handler: (data: PageDataResponse) => Promise<void>,
  ) => void | (() => void);
}

const clientGlobal = globalThis as typeof globalThis & {
  __VERYFRONT_SPA_NAVIGATE__?: (data: PageDataResponse) => Promise<void>;
  veryFrontRouter?: ClientRouterBridge;
};

type SpaNavigationHandler = (data: PageDataResponse) => Promise<void>;
interface GlobalNavigationRegistration {
  handler: SpaNavigationHandler;
}

interface GlobalNavigationRegistry {
  registrations: GlobalNavigationRegistration[];
  fallbackHandler?: SpaNavigationHandler;
}

const GLOBAL_NAVIGATION_REGISTRY_KEY = Symbol.for(
  "veryfront.spa-navigation.registrations.v1",
);

function getGlobalNavigationRegistry(): GlobalNavigationRegistry {
  const holder = globalThis as Record<symbol, unknown>;
  const existing = holder[GLOBAL_NAVIGATION_REGISTRY_KEY];
  if (
    typeof existing === "object" &&
    existing !== null &&
    Array.isArray((existing as GlobalNavigationRegistry).registrations)
  ) {
    return existing as GlobalNavigationRegistry;
  }

  const registry: GlobalNavigationRegistry = { registrations: [] };
  holder[GLOBAL_NAVIGATION_REGISTRY_KEY] = registry;
  return registry;
}

function registerGlobalNavigationHandler(handler: SpaNavigationHandler): () => void {
  const registry = getGlobalNavigationRegistry();
  const { registrations } = registry;
  if (registrations.length === 0) {
    registry.fallbackHandler = clientGlobal.__VERYFRONT_SPA_NAVIGATE__;
  }
  const registration = { handler };
  registrations.push(registration);
  clientGlobal.__VERYFRONT_SPA_NAVIGATE__ = handler;

  let active = true;
  return () => {
    if (!active) return;
    active = false;

    const registrationIndex = registrations.indexOf(registration);
    if (registrationIndex !== -1) registrations.splice(registrationIndex, 1);

    if (clientGlobal.__VERYFRONT_SPA_NAVIGATE__ !== handler) {
      if (registrations.length === 0) registry.fallbackHandler = undefined;
      return;
    }
    const previous = registrations.at(-1)?.handler;
    if (typeof previous === "function") clientGlobal.__VERYFRONT_SPA_NAVIGATE__ = previous;
    else if (typeof registry.fallbackHandler === "function") {
      clientGlobal.__VERYFRONT_SPA_NAVIGATE__ = registry.fallbackHandler;
    } else delete clientGlobal.__VERYFRONT_SPA_NAVIGATE__;

    if (registrations.length === 0) registry.fallbackHandler = undefined;
  };
}

function PageLoading(): ReactElement {
  return (
    <div className="veryfront-page-loading" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading page...</span>
    </div>
  );
}

function PageError({ error, onRetry }: { error: Error; onRetry: () => void }): ReactElement {
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

interface ClientRenderBoundaryProps {
  children: ReactElement;
  onRetry: () => void;
}

interface ClientRenderBoundaryState {
  error: Error | null;
}

class ClientRenderBoundary extends Component<
  ClientRenderBoundaryProps,
  ClientRenderBoundaryState
> {
  override state: ClientRenderBoundaryState = { error: null };

  static getDerivedStateFromError(): ClientRenderBoundaryState {
    return {
      error: RENDER_ERROR.create({ detail: "The page could not be rendered" }),
    };
  }

  override componentDidCatch(error: unknown, _errorInfo: ErrorInfo): void {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    console.error(`[Veryfront SPA] Render failed (${errorName})`);
  }

  override render(): ReactElement {
    if (this.state.error) {
      return <PageError error={this.state.error} onRetry={this.props.onRetry} />;
    }
    return this.props.children;
  }
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

async function navigateViaRouter(url: string, push?: boolean): Promise<void> {
  await clientGlobal.veryFrontRouter?.navigate?.(url, push);
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
    renderVersion: 0,
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function ClientApp({ initialData }: ClientAppProps): ReactElement {
  const [state, setState] = useState<ClientAppState>(() =>
    createClientAppState(
      initialData,
      getCachedComponent(initialData.pagePath),
    )
  );

  const [isMounted, setIsMounted] = useState(false);
  const navigationSequence = useRef(0);

  useEffect(() => {
    if (state.pageComponent) return;
    if (!initialData.pagePath) {
      setState((prev) => ({
        ...prev,
        error: PAGE_NOT_FOUND.create({ detail: "Page component path is missing" }),
      }));
      return;
    }
    const initialLoadNavigationId = navigationSequence.current;
    let cancelled = false;

    void (async () => {
      const Component = await loadComponent(initialData.pagePath);
      if (cancelled || initialLoadNavigationId !== navigationSequence.current) return;
      if (!Component) {
        setState((prev) => ({
          ...prev,
          error: PAGE_NOT_FOUND.create({
            detail: `Failed to load page component: ${initialData.pagePath}`,
          }),
        }));
        return;
      }
      setState((prev) => ({ ...prev, pageComponent: Component, error: null }));
    })();

    return () => {
      cancelled = true;
    };
  }, [initialData.pagePath, state.pageComponent]);

  useEffect(() => {
    for (const layout of initialData.layouts || []) void preloadComponent(layout.path);
  }, [initialData.layouts]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const handleNavigate = useCallback(async (data: PageDataResponse): Promise<void> => {
    const navigationId = ++navigationSequence.current;
    setState((prev) => ({ ...prev, isNavigating: true, error: null }));

    try {
      const [PageComponent, ...LayoutComponents] = await Promise.all([
        loadComponent(data.pagePath),
        ...(data.layouts || []).map((layout) => loadComponent(layout.path)),
      ]);
      if (navigationId !== navigationSequence.current) return;

      if (!PageComponent) {
        throw PAGE_NOT_FOUND.create({ detail: `Failed to load page component: ${data.pagePath}` });
      }

      const failedLayoutIndex = LayoutComponents.findIndex((Component) => Component === null);
      if (failedLayoutIndex !== -1) {
        const failedLayout = data.layouts[failedLayoutIndex];
        throw LAYOUT_NOT_FOUND.create({
          detail: `Failed to load layout component: ${failedLayout?.path ?? "unknown"}`,
        });
      }

      document.title = String(data.frontmatter?.title ?? "Veryfront App");

      setState((previous) => ({
        ...createClientAppState(data, PageComponent),
        renderVersion: previous.renderVersion + 1,
      }));
    } catch (error) {
      if (navigationId !== navigationSequence.current) return;
      console.error("[Veryfront SPA] Navigation failed:", error);
      setState((prev) => ({
        ...prev,
        isNavigating: false,
        error: toError(error),
      }));
    }
  }, []);

  useEffect(() => {
    const unregisterGlobal = registerGlobalNavigationHandler(handleNavigate);
    const unregisterRouter = clientGlobal.veryFrontRouter?.registerNavigationHandler?.(
      handleNavigate,
    );

    return () => {
      navigationSequence.current++;
      unregisterGlobal();
      unregisterRouter?.();
    };
  }, [handleNavigate]);

  const normalizedParams = useMemo(() => normalizeParams(state.params), [state.params]);

  const query = useMemo(() => getQuery(), [state.currentPath]);

  // Seed snapshot for `RouterProvider` — one `RouterValue` carrying everything
  // the route match knows. On the client the provider derives the live
  // `pathname`/`query` from the navigation store; `params`/`domain`/`isPreview`
  // are seeded from here.
  const routerValue: RouterValue = {
    domain: getDomain(),
    path: state.currentPath,
    pathname: state.currentPath,
    params: normalizedParams,
    query,
    isPreview: false,
    isMounted,
    navigate: async (path) => {
      await navigateViaRouter(path);
    },
    push: async (path) => {
      await navigateViaRouter(path);
    },
    replace: async (path) => {
      await navigateViaRouter(path, false);
    },
    reload: async () => {
      globalThis.location.reload();
    },
  };

  // Page context seed — page-authored fields; `PageContextProvider` derives the
  // live `path`/`query`/`params` from the router above.
  const pageContext: PageContextValue = {
    slug: state.currentPath || "/",
    path: state.currentPath,
    params: normalizedParams,
    query,
    frontmatter: state.frontmatter,
    headings: [],
    mdxHeadings: [],
  };

  const handleRetry = useCallback((): void => {
    globalThis.location.reload();
  }, []);

  function renderPageContent(): ReactElement {
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
      <PageContextProvider pageContext={pageContext}>
        <div
          className={`veryfront-app ${state.isNavigating ? "veryfront-navigating" : ""}`}
          data-navigating={state.isNavigating}
        >
          <ClientRenderBoundary
            key={`${state.currentPath}:${state.renderVersion}`}
            onRetry={handleRetry}
          >
            <LayoutShell layouts={state.layouts} layoutProps={state.layoutProps}>
              {renderPageContent()}
            </LayoutShell>
          </ClientRenderBoundary>
        </div>
      </PageContextProvider>
    </RouterProvider>
  );
}
