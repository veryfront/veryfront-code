import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { DependencyHashCache } from "#veryfront/cache/dependency-graph.ts";
import type { PreloadImportMapContext } from "#veryfront/modules/import-map/preloader.ts";
import type { ImportMapConfig } from "#veryfront/modules/import-map/types.ts";
import type { TransformProgressListener } from "#veryfront/transforms/progress.ts";
import type { DependencyPinningSourceInput } from "./package-registry.ts";
import type { DependencyResolutionObservation } from "../import-rewriter/dependency-resolution.ts";

export interface TransformOptions {
  dev?: boolean;
  projectId: string;
  /** Internal request-scoped cancellation for transform dependencies. */
  abortSignal?: AbortSignal;
  jsxImportSource?: string;
  moduleServerUrl?: string;
  /** Absolute request origin used to identify same-origin module URLs. */
  moduleServerOrigin?: string;
  vendorBundleHash?: string;
  ssr?: boolean;
  apiBaseUrl?: string;
  studioEmbed?: boolean;
  /** React version for transforms (from project config, defaults to DEFAULT_REACT_VERSION) */
  reactVersion?: string;
  /** Bare npm package roots that the runtime resolves without bundling. */
  serverExternalPackages?: readonly string[];
  /** Immutable import-map snapshot already selected for this render. */
  preloadedImportMap?: ImportMapConfig;
  /** Adapter used to load and cache the project import map before SSR cache identity. */
  importMapAdapter?: RuntimeAdapter;
  /** Content-source/config identity for the import-map preloader. */
  importMapPreloadContext?: PreloadImportMapContext;
  /** Internal per-render dependency hash cache. */
  dependencyHashCache?: DependencyHashCache;
  /** Internal stable flag + package dependency-map key for cache isolation. */
  dependencyPinningCacheKey?: string;
  /** Immutable package map paired with dependencyPinningCacheKey. */
  dependencyPinningDependencies?: Readonly<Record<string, string>>;
  /** Exact package source namespace used to prove write-back authority. */
  dependencyPinningSource?: DependencyPinningSourceInput;
  /** Internal collector for unresolved dependency cache metadata. */
  onDependencyResolutionObserved?: (
    observation: DependencyResolutionObservation,
  ) => void;
  /** Internal observer for meaningful transform milestones. */
  onProgress?: TransformProgressListener;
}

export interface TransformContext {
  source: string;
  filePath: string;
  projectDir: string;
  adapter: RuntimeAdapter;
  options: TransformOptions;
}
