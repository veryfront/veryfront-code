import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { DependencyHashCache } from "#veryfront/cache/dependency-graph.ts";
import type { TransformProgressListener } from "#veryfront/transforms/progress.ts";
import type { DependencyPinningSourceInput } from "./package-registry.ts";
import type { DependencyResolutionObservation } from "../import-rewriter/dependency-resolution.ts";

export interface TransformOptions {
  dev?: boolean;
  projectId: string;
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
  /** Internal per-render dependency hash cache. */
  dependencyHashCache?: DependencyHashCache;
  /** Internal stable flag + package dependency-map key for cache isolation. */
  dependencyPinningCacheKey?: string;
  /** Immutable package map paired with dependencyPinningCacheKey. */
  dependencyPinningDependencies?: Readonly<Record<string, string>>;
  /** Exact package source namespace used to prove write-back authority. */
  dependencyPinningSource?: DependencyPinningSourceInput;
  /** Exact filesystem URLs inserted by the trusted SSR module loader. */
  allowedFilesystemImportSpecifiers?: ReadonlySet<string>;
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
