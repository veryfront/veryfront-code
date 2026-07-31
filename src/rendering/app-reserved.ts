import * as BundledReact from "react";
import { rendererLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { ImportMapConfig } from "#veryfront/modules/import-map/types.ts";
import { dirname, isAbsolute, normalize, parse, relative } from "#veryfront/compat/path";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { assertReactComponentType } from "./react-component-type.ts";
import type { DependencyPinningSourceInput } from "#veryfront/transforms/esm/package-registry.ts";

type ReservedComponent = BundledReact.ComponentType<{ error?: Error; reset?: () => void }>;

export const RESERVED_COMPONENTS = {
  loading: "loading.tsx",
  error: "error.tsx",
  notFound: "not-found.tsx",
};

const MAX_RESERVED_COMPONENT_ANCESTORS = 256;

function normalizeDirectoryPath(path: string): string {
  let normalized = normalize(path);
  const rootLength = parse(normalized).root?.length ?? 0;

  while (
    normalized.length > rootLength &&
    (normalized.endsWith("/") || normalized.endsWith("\\"))
  ) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

function isSameOrDescendant(rootDir: string, path: string): boolean {
  const relativePath = relative(rootDir, path).replaceAll("\\", "/");
  return relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith("../") &&
      !isAbsolute(relativePath));
}

export function collectAncestorDirs(segmentDir: string, appRootDir: string): string[] {
  const dirs: string[] = [];
  let current = normalizeDirectoryPath(segmentDir);
  const root = normalizeDirectoryPath(appRootDir);

  if (!isSameOrDescendant(root, current)) return dirs;

  while (isSameOrDescendant(root, current)) {
    if (dirs.length >= MAX_RESERVED_COMPONENT_ANCESTORS) {
      throw new RangeError(
        `Reserved component ancestor limit of ${MAX_RESERVED_COMPONENT_ANCESTORS} was exceeded`,
      );
    }
    dirs.push(current);

    if (current === root) break;
    const parent = dirname(current);
    if (parent === current) break;

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

type LoadComponentFromSource =
  typeof import("#veryfront/modules/react-loader/component-loader.ts")["loadComponentFromSource"];

export interface ReservedComponentLoaderDeps {
  loadComponentFromSource: (
    ...args: Parameters<LoadComponentFromSource>
  ) => Promise<unknown>;
}

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
  mode: "development" | "production",
  adapter: RuntimeAdapter,
  projectId?: string,
  contentSourceId?: string,
  reactVersion?: string,
  importMap?: ImportMapConfig,
  deps?: ReservedComponentLoaderDeps,
  dependencyPinningCacheKey?: string,
  dependencyPinningDependencies?: Readonly<Record<string, string>>,
  dependencyPinningSource?: DependencyPinningSourceInput,
  moduleServerOrigin?: string,
): Promise<{ component: ReservedComponent; filePath: string } | null> {
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
        if (isNotFoundError(error)) continue;
        throw error;
      }

      const exported = await loadComponentFromSource(src, file, projectDir, adapter, {
        projectId: projectId ?? projectDir,
        dev: mode === "development",
        mode,
        contentSourceId,
        reactVersion,
        importMap,
        moduleServerOrigin,
        dependencyPinningCacheKey,
        dependencyPinningDependencies,
        dependencyPinningSource,
      });
      const component = assertReactComponentType(
        exported,
        `Reserved ${which} module "${file}"`,
      ) as ReservedComponent;
      return { component, filePath: file };
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
  importMap?: ImportMapConfig,
  deps?: ReservedComponentLoaderDeps,
  dependencyPinningCacheKey?: string,
  dependencyPinningDependencies?: Readonly<Record<string, string>>,
  dependencyPinningSource?: DependencyPinningSourceInput,
  moduleServerOrigin?: string,
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
    importMap,
    deps,
    dependencyPinningCacheKey,
    dependencyPinningDependencies,
    dependencyPinningSource,
    moduleServerOrigin,
  );
  return loaded?.component ?? null;
}
