import * as BundledReact from "react";
import { rendererLogger as logger, throwIfAborted } from "#veryfront/utils";
import { normalizePath } from "#veryfront/utils/path-utils.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { DependencyPinningSourceInput } from "#veryfront/transforms/esm/package-registry.ts";

type ReservedComponent = BundledReact.ComponentType<{ error?: Error; reset?: () => void }>;

export const RESERVED_COMPONENTS = {
  loading: "loading.tsx",
  error: "error.tsx",
  notFound: "not-found.tsx",
};

export function collectAncestorDirs(segmentDir: string, appRootDir: string): string[] {
  const getDirname = (p: string) => normalizePath(p).replace(/\/?[^/]+\/?$/, "");

  const dirs: string[] = [];
  let current = normalizePath(segmentDir);
  const root = normalizePath(appRootDir);

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
      logger.error("Error boundary caught error:", error, errorInfo);
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

/**
 * Like {@link tryLoadReservedInDirs}, but also returns the absolute source path
 * of the file that was loaded — the client hydration bundle needs the path (in
 * the same absolute form as `appPath`) to load the same component in the browser.
 */
export async function loadReservedWithPath(
  dirs: string[],
  which: keyof typeof RESERVED_COMPONENTS,
  projectDir: string,
  _mode: "development" | "production",
  adapter: RuntimeAdapter,
  projectId?: string,
  contentSourceId?: string,
  reactVersion?: string,
  dependencyPinningCacheKey?: string,
  dependencyPinningDependencies?: Readonly<Record<string, string>>,
  dependencyPinningSource?: DependencyPinningSourceInput,
  moduleServerOrigin?: string,
  serverExternalPackages?: readonly string[],
  signal?: AbortSignal,
): Promise<{ component: ReservedComponent; filePath: string } | null> {
  throwIfAborted(signal);
  const join = (a: string, b: string) => `${a.replace(/\/$/, "")}/${b.replace(/^\//, "")}`;
  const candidateName = RESERVED_COMPONENTS[which];
  const { loadComponentFromSource } = await import(
    "#veryfront/modules/react-loader/component-loader.ts"
  );

  for (const dir of dirs) {
    for (const ext of [".tsx", ".jsx"]) {
      const file = join(dir, candidateName.replace(/\.tsx$/, ext));
      try {
        const src = await adapter.fs.readFile(file);
        const Cmp = await loadComponentFromSource(src, file, projectDir, adapter, {
          projectId: projectId ?? projectDir,
          dev: true,
          contentSourceId,
          reactVersion,
          serverExternalPackages,
          moduleServerOrigin,
          dependencyPinningCacheKey,
          dependencyPinningDependencies,
          dependencyPinningSource,
          signal,
        });
        if (typeof Cmp === "function") {
          return { component: Cmp as ReservedComponent, filePath: file };
        }
      } catch (_) {
        throwIfAborted(signal);
        /* expected: component not found in this path, continue to next */
      }
    }
  }

  return null;
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
  dependencyPinningCacheKey?: string,
  dependencyPinningDependencies?: Readonly<Record<string, string>>,
  dependencyPinningSource?: DependencyPinningSourceInput,
  moduleServerOrigin?: string,
  serverExternalPackages?: readonly string[],
  signal?: AbortSignal,
): Promise<ReservedComponent | null> {
  const loaded = await loadReservedWithPath(
    dirs,
    which,
    projectDir,
    mode,
    adapter,
    projectId,
    contentSourceId,
    reactVersion,
    dependencyPinningCacheKey,
    dependencyPinningDependencies,
    dependencyPinningSource,
    moduleServerOrigin,
    serverExternalPackages,
    signal,
  );
  return loaded?.component ?? null;
}
