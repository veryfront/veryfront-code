import {
  type ComponentType,
  type ReactElement,
  type ReactNode,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  type ComponentLoadOptions,
  getCachedComponent,
  loadComponent,
} from "./component-loader.ts";
import { snapshotLayoutInputs } from "./page-data.ts";
import { pathToModuleUrl } from "./path-utils.ts";
import { RenderErrorBoundary } from "./RenderErrorBoundary.tsx";

const INHERIT_COMPONENT_LOAD_OPTIONS: ComponentLoadOptions = Object.freeze({});

/** Descriptor for a page layout module. */
export interface LayoutInfo {
  /** Layout source format. */
  kind: "mdx" | "tsx";
  /** Source path used to resolve the layout component. */
  path: string;
}

/** Props accepted by {@link LayoutShell}. */
export interface LayoutShellProps {
  /** Ordered outer-to-inner layout descriptors. */
  layouts: LayoutInfo[];
  /** Props keyed by layout source path. */
  layoutProps?: Record<string, Record<string, unknown>>;
  /** Release asset map used to resolve layout modules for this render. */
  releaseAssetModules?: Record<string, string> | null;
  /** Release id used to version fallback layout module URLs for this render. */
  releaseId?: string | null;
  /** Rendered page content. */
  children: ReactNode;
}

interface LayoutWrapperProps {
  layout: LayoutInfo;
  layoutProps?: Record<string, unknown>;
  loadOptions: ComponentLoadOptions;
  children: ReactNode;
}

function LayoutLoading(): ReactElement {
  return (
    <div className="veryfront-layout-loading" style={{ minHeight: "100vh" }}>
      <span className="sr-only">Loading layout...</span>
    </div>
  );
}

function LayoutError(): ReactElement {
  return (
    <div className="veryfront-layout-error">
      <h1>Something went wrong</h1>
      <p>The page layout could not be loaded. Try again.</p>
      <button type="button" onClick={() => globalThis.location.reload()}>
        Try again
      </button>
    </div>
  );
}

type LayoutComponentType = ComponentType<{ children: ReactNode; [key: string]: unknown }>;

function LayoutWrapper(
  { layout, layoutProps, loadOptions, children }: LayoutWrapperProps,
): ReactElement {
  const [LayoutComponent, setLayoutComponent] = useState<LayoutComponentType | null>(() => {
    return getCachedComponent(layout.path, loadOptions) as LayoutComponentType | null;
  });
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoadFailed(false);

    const cached = getCachedComponent(layout.path, loadOptions) as LayoutComponentType | null;
    if (cached) {
      setLayoutComponent(() => cached);
      return () => {
        mounted = false;
      };
    }
    setLayoutComponent(null);

    async function load(): Promise<void> {
      const Component = await loadComponent(layout.path, loadOptions);
      if (!mounted) return;
      if (!Component) {
        setLoadFailed(true);
        return;
      }
      setLayoutComponent(() => Component as LayoutComponentType);
    }

    void load();

    return () => {
      mounted = false;
    };
  }, [layout.path, loadOptions]);

  if (loadFailed) return <LayoutError />;
  if (!LayoutComponent) return <LayoutLoading />;

  return (
    <RenderErrorBoundary fallback={<LayoutError />} resetKey={layoutProps}>
      <LayoutComponent {...(layoutProps ?? {})}>{children}</LayoutComponent>
    </RenderErrorBoundary>
  );
}

/** Compose the page with its outer-to-inner layout chain. */
export function LayoutShell(
  { layouts, layoutProps, releaseAssetModules, releaseId, children }: LayoutShellProps,
): ReactElement {
  const snapshot = useMemo(
    () =>
      snapshotLayoutInputs(
        layouts,
        layoutProps ?? {},
        releaseAssetModules ?? null,
        releaseId ?? null,
      ),
    [layoutProps, layouts, releaseAssetModules, releaseId],
  );
  const loadOptions = useMemo<ComponentLoadOptions>(
    () => {
      if (releaseAssetModules === undefined && releaseId === undefined) {
        return INHERIT_COMPONENT_LOAD_OPTIONS;
      }
      return Object.freeze({
        ...(releaseAssetModules === undefined
          ? {}
          : { releaseAssetModules: snapshot.releaseAssetModules }),
        ...(releaseId === undefined ? {} : { releaseId: snapshot.releaseId }),
      });
    },
    [releaseAssetModules, releaseId, snapshot.releaseAssetModules, snapshot.releaseId],
  );
  if (snapshot.layouts.length === 0) return <>{children}</>;

  let tree: ReactNode = children;

  for (let i = snapshot.layouts.length - 1; i >= 0; i--) {
    const layout = snapshot.layouts[i]!;
    const props = snapshot.layoutProps[layout.path] ?? {};
    const moduleUrl = pathToModuleUrl(
      layout.path,
      undefined,
      loadOptions.releaseAssetModules,
      loadOptions.releaseId,
    );

    tree = (
      <Suspense key={`${i}:${layout.path}:${moduleUrl}`} fallback={<LayoutLoading />}>
        <LayoutWrapper layout={layout} layoutProps={props} loadOptions={loadOptions}>
          {tree}
        </LayoutWrapper>
      </Suspense>
    );
  }

  return <>{tree}</>;
}
