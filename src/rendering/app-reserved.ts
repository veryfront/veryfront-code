import * as BundledReact from "react";
import { rendererLogger as logger, throwIfAborted } from "#veryfront/utils";
import { normalizePath } from "#veryfront/utils/path-utils.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { DependencyPinningSourceInput } from "#veryfront/transforms/esm/package-registry.ts";
import type { loadComponentFromSource } from "#veryfront/modules/react-loader/component-loader.ts";
import type { RenderModes } from "#veryfront/rendering/context/render-context.ts";
import { isCanonicalNotFoundError } from "#veryfront/platform/compat/not-found-error.ts";
import { UNKNOWN_ERROR } from "#veryfront/errors";

type ReservedComponent = BundledReact.ComponentType<{ error?: Error; reset?: () => void }>;

/** Test seam for the component loader that {@link loadReservedWithPath} imports lazily. */
export interface LoadReservedDeps {
  loadComponentFromSource: typeof loadComponentFromSource;
}

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
  const isWithinRoot = (path: string) =>
    root === "/" ? path.startsWith("/") : path === root || path.startsWith(`${root}/`);

  while (isWithinRoot(current)) {
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
  modes: RenderModes,
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
  deps?: LoadReservedDeps,
): Promise<{ component: ReservedComponent; filePath: string } | null> {
  throwIfAborted(signal);
  const join = (a: string, b: string) => `${a.replace(/\/$/, "")}/${b.replace(/^\//, "")}`;
  const candidateName = RESERVED_COMPONENTS[which];
  const loadComponentFromSource = deps?.loadComponentFromSource ??
    (await import("#veryfront/modules/react-loader/component-loader.ts"))
      .loadComponentFromSource;

  for (const dir of dirs) {
    for (const ext of [".tsx", ".jsx"]) {
      const file = join(dir, candidateName.replace(/\.tsx$/, ext));
      let src: string;
      try {
        src = await adapter.fs.readFile(file);
      } catch (error) {
        throwIfAborted(signal);
        if (isCanonicalNotFoundError(error)) continue;
        throw UNKNOWN_ERROR.create({
          detail: "Failed to read reserved component",
          cause: error,
          context: { operation: "readReservedComponent", component: which },
        });
      }

      const Cmp = await loadComponentFromSource(src, file, projectDir, adapter, {
        projectId: projectId ?? projectDir,
        dev: modes.compileMode === "development",
        mode: modes.environment,
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
    }
  }

  return null;
}

export async function tryLoadReservedInDirs(
  dirs: string[],
  which: keyof typeof RESERVED_COMPONENTS,
  projectDir: string,
  modes: RenderModes,
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
  deps?: LoadReservedDeps,
): Promise<ReservedComponent | null> {
  const loaded = await loadReservedWithPath(
    dirs,
    which,
    projectDir,
    modes,
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
    deps,
  );
  return loaded?.component ?? null;
}
