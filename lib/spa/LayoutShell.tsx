import React, { Suspense, useState, useEffect, type ComponentType, type ReactNode } from "react";
import { loadComponent, getCachedComponent } from "./component-loader.ts";

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

function LayoutLoading(): JSX.Element {
  return (
    <div className="veryfront-layout-loading" style={{ minHeight: "100vh" }}>
      <span className="sr-only">Loading layout...</span>
    </div>
  );
}

function LayoutWrapper({ layout, layoutProps, children }: LayoutWrapperProps): JSX.Element {
  const [LayoutComponent, setLayoutComponent] = useState<ComponentType<{
    children: ReactNode;
    [key: string]: unknown;
  }> | null>(() => {
    // Try to get from cache synchronously first (for SSR hydration match)
    const cached = getCachedComponent(layout.path);
    return cached as ComponentType<{ children: ReactNode; [key: string]: unknown }> | null;
  });

  useEffect(() => {
    if (LayoutComponent) return;

    let mounted = true;
    loadComponent(layout.path).then((Component) => {
      if (mounted && Component) {
        setLayoutComponent(() => Component as ComponentType<{ children: ReactNode; [key: string]: unknown }>);
      }
    });

    return () => {
      mounted = false;
    };
  }, [layout.path, LayoutComponent]);

  if (!LayoutComponent) {
    return <LayoutLoading />;
  }

  return (
    <LayoutComponent {...(layoutProps || {})}>{children}</LayoutComponent>
  );
}

export function LayoutShell({ layouts, layoutProps = {}, children }: LayoutShellProps): JSX.Element {
  if (layouts.length === 0) {
    return <>{children}</>;
  }

  // Build layout tree from outermost to innermost
  // layouts[0] is outermost, layouts[layouts.length - 1] is innermost
  let tree: ReactNode = children;

  for (let i = layouts.length - 1; i >= 0; i--) {
    const layout = layouts[i];
    const props = layoutProps[layout.path] || {};

    // Use the layout path as key for React to preserve the component instance
    tree = (
      <Suspense key={layout.path} fallback={<LayoutLoading />}>
        <LayoutWrapper layout={layout} layoutProps={props}>
          {tree}
        </LayoutWrapper>
      </Suspense>
    );
  }

  return <>{tree}</>;
}

export default LayoutShell;
