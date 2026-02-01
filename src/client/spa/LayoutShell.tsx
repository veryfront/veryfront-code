import { type ComponentType, type ReactNode, Suspense, useEffect, useState } from "react";
import { getCachedComponent, loadComponent } from "./component-loader.ts";

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

type LayoutComponentType = ComponentType<{ children: ReactNode; [key: string]: unknown }>;

function LayoutWrapper({ layout, layoutProps, children }: LayoutWrapperProps): JSX.Element {
  const [LayoutComponent, setLayoutComponent] = useState<LayoutComponentType | null>(() => {
    return (getCachedComponent(layout.path) as LayoutComponentType | null) ?? null;
  });

  useEffect(() => {
    if (LayoutComponent) return;

    let mounted = true;

    async function load(): Promise<void> {
      const Component = await loadComponent(layout.path);
      if (!mounted || !Component) return;
      setLayoutComponent(() => Component as LayoutComponentType);
    }

    void load();

    return () => {
      mounted = false;
    };
  }, [LayoutComponent, layout.path]);

  if (!LayoutComponent) return <LayoutLoading />;

  return <LayoutComponent {...(layoutProps ?? {})}>{children}</LayoutComponent>;
}

export function LayoutShell(
  { layouts, layoutProps = {}, children }: LayoutShellProps,
): JSX.Element {
  if (layouts.length === 0) return <>{children}</>;

  let tree: ReactNode = children;

  for (let i = layouts.length - 1; i >= 0; i--) {
    const layout = layouts[i];
    const props = layoutProps[layout.path] ?? {};

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
