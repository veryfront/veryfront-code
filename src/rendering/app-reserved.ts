import * as BundledReact from "react";
import { rendererLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

type ReservedComponent = BundledReact.ComponentType<unknown>;

export const RESERVED_COMPONENTS = {
  loading: "loading.tsx",
  error: "error.tsx",
  notFound: "not-found.tsx",
};

export function collectAncestorDirs(segmentDir: string, appRootDir: string): string[] {
  const normalize = (p: string) => p.replace(/\\+/g, "/").replace(/\/\.+\//g, "/");
  const getDirname = (p: string) => normalize(p).replace(/\/?[^/]+\/?$/, "");
  const dirs: string[] = [];
  let current = normalize(segmentDir);
  const root = normalize(appRootDir);
  while (current.startsWith(root)) {
    dirs.push(current);
    const parent = getDirname(current) || "/";
    if (parent === current || parent.length < root.length) break;
    current = parent;
  }
  return dirs;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

interface ErrorBoundaryProps {
  children?: BundledReact.ReactNode;
}

export function createErrorBoundary(
  ErrorComponent: ReservedComponent,
  ReactLib: typeof BundledReact = BundledReact,
) {
  return class ErrorBoundary
    extends BundledReact.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
      super(props);
      this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error) {
      return { hasError: true, error };
    }

    override componentDidCatch(error: Error, errorInfo: BundledReact.ErrorInfo) {
      logger.error("Error boundary caught error:", error, errorInfo);
    }

    override render() {
      if (this.state.hasError && ErrorComponent) {
        const Reserved = ErrorComponent as BundledReact.ComponentType<Record<string, unknown>>;
        return ReactLib.createElement(Reserved, {
          error: this.state.error,
          reset: () => this.setState({ hasError: false }),
        });
      }
      return this.props.children;
    }
  };
}

export async function tryLoadReservedInDirs(
  dirs: string[],
  which: keyof typeof RESERVED_COMPONENTS,
  projectDir: string,
  _mode: "development" | "production",
  adapter: RuntimeAdapter,
  projectId?: string,
): Promise<ReservedComponent | null> {
  const join = (a: string, b: string) => `${a.replace(/\/$/, "")}/${b.replace(/^\//, "")}`;
  const candidateName = RESERVED_COMPONENTS[which];
  for (const dir of dirs) {
    for (const ext of [".tsx", ".jsx"]) {
      const file = join(dir, candidateName.replace(/\.tsx$/, ext));
      try {
        const src = await adapter.fs.readFile(file);
        // Use new ESM component loader
        const { loadComponentFromSource } = await import(
          "@veryfront/modules/react-loader/component-loader.ts"
        );
        const Cmp = await loadComponentFromSource(
          src,
          file,
          projectDir,
          adapter,
          { projectId: projectId ?? projectDir, dev: true },
        );
        if (typeof Cmp === "function") return Cmp as ReservedComponent;
      } catch {
        // Component not found in this path, continue to next
      }
    }
  }
  return null;
}
