import {
  type ComponentType,
  type ReactElement,
  type ReactNode,
  Suspense,
  useEffect,
  useState,
} from "react";
import { getCachedComponent, loadComponent } from "./component-loader.ts";
import { LAYOUT_NOT_FOUND } from "#veryfront/errors/error-registry.ts";

export interface LayoutInfo {
  kind: "mdx" | "tsx";
  path: string;
}

interface LayoutShellProps {
  layouts: LayoutInfo[];
  layoutProps?: Record<string, Record<string, unknown>>;
  children: ReactNode;
}

interface LayoutWrapperProps {
  layout: LayoutInfo;
  layoutProps?: Record<string, unknown>;
  children: ReactNode;
}

function LayoutLoading(): ReactElement {
  return (
    <div className="veryfront-layout-loading" style={{ minHeight: "100vh" }}>
      <span className="sr-only">Loading layout...</span>
    </div>
  );
}

function LayoutError(
  { error, onRetry }: { error: Error; onRetry: () => void },
): ReactElement {
  return (
    <div className="veryfront-layout-error">
      <h1>Something went wrong</h1>
      <p>{error.message}</p>
      <button type="button" onClick={onRetry}>Try again</button>
    </div>
  );
}

type LayoutComponentType = ComponentType<{ children: ReactNode; [key: string]: unknown }>;

interface LayoutLoadState {
  path: string;
  Component: LayoutComponentType | null;
  error: Error | null;
}

function LayoutWrapper({ layout, layoutProps, children }: LayoutWrapperProps): ReactElement {
  const [attempt, setAttempt] = useState(0);
  const [loadState, setLoadState] = useState<LayoutLoadState>(() => ({
    path: layout.path,
    Component: getCachedComponent(layout.path) as LayoutComponentType | null,
    error: null,
  }));

  useEffect(() => {
    const cached = getCachedComponent(layout.path) as LayoutComponentType | null;
    if (cached) {
      setLoadState({ path: layout.path, Component: cached, error: null });
      return;
    }

    let mounted = true;
    setLoadState({ path: layout.path, Component: null, error: null });

    async function load(): Promise<void> {
      const Component = await loadComponent(layout.path);
      if (!mounted) return;
      if (!Component) {
        setLoadState({
          path: layout.path,
          Component: null,
          error: LAYOUT_NOT_FOUND.create({
            detail: `Failed to load layout component: ${layout.path}`,
          }),
        });
        return;
      }
      setLoadState({
        path: layout.path,
        Component: Component as LayoutComponentType,
        error: null,
      });
    }

    void load();

    return () => {
      mounted = false;
    };
  }, [attempt, layout.path]);

  if (loadState.path !== layout.path) return <LayoutLoading />;
  if (loadState.error) {
    return <LayoutError error={loadState.error} onRetry={() => setAttempt((value) => value + 1)} />;
  }
  if (!loadState.Component) return <LayoutLoading />;

  const LayoutComponent = loadState.Component;
  return <LayoutComponent {...(layoutProps ?? {})}>{children}</LayoutComponent>;
}

export function LayoutShell(
  { layouts, layoutProps = {}, children }: LayoutShellProps,
): ReactElement {
  if (layouts.length === 0) return <>{children}</>;

  let tree: ReactNode = children;

  for (let i = layouts.length - 1; i >= 0; i--) {
    const layout = layouts[i]!;
    const props = layoutProps[layout.path] ?? {};

    tree = (
      <Suspense key={`${layout.path}:${i}`} fallback={<LayoutLoading />}>
        <LayoutWrapper layout={layout} layoutProps={props}>
          {tree}
        </LayoutWrapper>
      </Suspense>
    );
  }

  return <>{tree}</>;
}
