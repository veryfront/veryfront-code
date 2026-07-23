import * as BundledReact from "react";
import { rendererLogger as logger } from "#veryfront/utils";
import { normalizePath } from "#veryfront/utils/path-utils.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { dirname, isAbsolute, normalize, relative } from "#veryfront/compat/path";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";

type ReservedComponent = BundledReact.ComponentType<{ error?: Error; reset?: () => void }>;

export const RESERVED_COMPONENTS = {
  loading: "loading.tsx",
  error: "error.tsx",
  notFound: "not-found.tsx",
};

export function collectAncestorDirs(segmentDir: string, appRootDir: string): string[] {
  const dirs: string[] = [];
  let current = normalize(normalizePath(segmentDir));
  const root = normalize(normalizePath(appRootDir));
  if (!isPathWithinRoot(current, root)) return dirs;

  while (isPathWithinRoot(current, root)) {
    dirs.push(current);

    const parent = dirname(current);
    if (parent === current || current === root) break;

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

type ReactLike = {
  createElement: typeof BundledReact.createElement;
};

export function createErrorBoundary(
  ErrorComponent: ReservedComponent,
  ReactLib: ReactLike = BundledReact,
): typeof BundledReact.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  return class ErrorBoundary
    extends BundledReact.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
      super(props);
      this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
      return { hasError: true, error };
    }

    override componentDidCatch(error: Error, errorInfo: BundledReact.ErrorInfo): void {
      logger.error("Error boundary caught an error", {
        errorName: error.name,
        hasComponentStack: Boolean(errorInfo.componentStack),
      });
    }

    override render(): BundledReact.ReactNode {
      if (!this.state.hasError || !ErrorComponent) return this.props.children;

      return ReactLib.createElement(ErrorComponent, {
        error: this.state.error,
        reset: () => this.setState({ hasError: false }),
      });
    }
  };
}

export async function tryLoadReservedInDirs(
  dirs: string[],
  which: keyof typeof RESERVED_COMPONENTS,
  projectDir: string,
  mode: "development" | "production",
  adapter: RuntimeAdapter,
  projectId?: string,
  contentSourceId?: string,
  reactVersion?: string,
): Promise<ReservedComponent | null> {
  const join = (a: string, b: string) => `${a.replace(/\/$/, "")}/${b.replace(/^\//, "")}`;
  const candidateName = RESERVED_COMPONENTS[which];
  const { loadComponentFromSource } = await import(
    "#veryfront/modules/react-loader/component-loader.ts"
  );

  for (const dir of dirs) {
    if (!isPathWithinRoot(dir, projectDir)) continue;
    for (const ext of [".tsx", ".jsx"]) {
      const file = join(dir, candidateName.replace(/\.tsx$/, ext));
      try {
        const src = await adapter.fs.readFile(file);
        const Cmp = await loadComponentFromSource(src, file, projectDir, adapter, {
          projectId: projectId ?? projectDir,
          dev: mode === "development",
          contentSourceId,
          reactVersion,
        });
        if (typeof Cmp === "function") return Cmp as ReservedComponent;
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
        /* expected: component not found in this path, continue to next */
      }
    }
  }

  return null;
}

function isPathWithinRoot(path: string, root: string): boolean {
  const relativePath = relative(normalize(root), normalize(path));
  return relativePath === "" ||
    (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith("../"));
}
