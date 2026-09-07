/****
 * Transform pipeline types.
 *
 * Defines the plugin-based architecture for ESM transforms.
 * Each stage handles one concern, making the pipeline testable and maintainable.
 */

import type { DependencyHashCache } from "#veryfront/cache/dependency-graph.ts";
import type { PreloadImportMapContext } from "#veryfront/modules/import-map/preloader.ts";
import type { ImportMapConfig } from "#veryfront/modules/import-map/types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { TransformProgressListener } from "#veryfront/transforms/progress.ts";
import type { DependencyPinningSourceInput } from "../esm/package-registry.ts";
import type { DependencyResolutionObservation } from "../import-rewriter/dependency-resolution.ts";

/**
 * Transform stages in execution order.
 * Each stage runs after the previous completes.
 */
export enum TransformStage {
  /** MDX → JSX compilation */
  PARSE = 0,
  /** esbuild JSX → JS compilation */
  COMPILE = 1,
  /** @/ alias resolution */
  RESOLVE_ALIASES = 2,
  /** react/jsx-runtime → esm.sh URLs (cached to file:// for SSR later) */
  RESOLVE_REACT = 3,
  /** Context packages (@tanstack/react-query, etc.) → unified URLs */
  RESOLVE_CONTEXT = 4,
  /** ./relative imports → full paths or module server URLs */
  RESOLVE_RELATIVE = 5,
  /** Bare npm imports → esm.sh URLs (cached to file:// for SSR later) */
  RESOLVE_BARE = 6,
  /** Final cleanup, caching, HTTP normalization */
  FINALIZE = 7,
}

/**
 * Transform target environment.
 */
export type TransformTarget = "ssr" | "browser";

/**
 * Options passed to the transform pipeline.
 */
export interface TransformOptions {
  /** Development mode (enables sourcemaps, disables minification) */
  dev?: boolean;
  /** Project identifier for caching */
  projectId: string;
  /** JSX import source (default: "react") */
  jsxImportSource?: string;
  /** Module server URL for browser imports */
  moduleServerUrl?: string;
  /** Absolute request origin used for browser-loadable static asset URLs. */
  moduleServerOrigin?: string;
  /** Vendor bundle hash for cache busting */
  vendorBundleHash?: string;
  /** SSR mode (true) or browser mode (false) */
  ssr?: boolean;
  /** API base URL for cross-project imports */
  apiBaseUrl?: string;
  /** Enable node position injection for Studio Navigator */
  studioEmbed?: boolean;
  /** React version to use (detected from project package.json if not provided) */
  reactVersion?: string;
  /** Bare npm package roots that the runtime resolves without bundling. */
  serverExternalPackages?: readonly string[];
  /** Immutable import-map snapshot already selected for this render. */
  preloadedImportMap?: ImportMapConfig;
  /** Adapter used to load and cache the project import map before SSR cache identity. */
  importMapAdapter?: RuntimeAdapter;
  /** Content-source/config identity for the import-map preloader. */
  importMapPreloadContext?: PreloadImportMapContext;
  /** File reader for dependency hash computation. When provided, enables dependency-aware cache invalidation. */
  readFile?: (path: string) => Promise<string>;
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
  /** Cancels request-scoped transform work after module loading stops. */
  abortSignal?: AbortSignal;
}

/**
 * Context passed through the transform pipeline.
 * Mutable - stages update ctx.code as they process.
 */
export interface TransformContext {
  /** Import representation selected by the pipeline configuration. */
  ssrImports?: PipelineConfig["ssrImports"];
  /** Current code being transformed */
  code: string;
  /** Original source code (immutable) */
  originalSource: string;
  /** File path being transformed */
  filePath: string;
  /** Project root directory */
  projectDir: string;
  /** Project identifier */
  projectId: string;
  /** Transform target: SSR or browser */
  target: TransformTarget;
  /** Development mode */
  dev: boolean;
  /** Content hash for caching */
  contentHash: string;
  /** Module server URL (browser only) */
  moduleServerUrl?: string;
  /** Absolute request origin used for browser-loadable static asset URLs. */
  moduleServerOrigin?: string;
  /** Vendor bundle hash (browser only) */
  vendorBundleHash?: string;
  /** API base URL for cross-project imports */
  apiBaseUrl?: string;
  /** JSX import source */
  jsxImportSource: string;
  /** Timing data per stage */
  timing: Map<TransformStage, number>;
  /** Enable debug logging */
  debug: boolean;
  /** Metadata set by stages (e.g., MDX frontmatter) */
  metadata: Map<string, unknown>;
  /** Enable node position injection for Studio Navigator */
  studioEmbed?: boolean;
  /** React version to use for esm.sh URLs */
  reactVersion: string;
  /** Immutable bare npm package roots that the runtime resolves without bundling. */
  serverExternalPackages?: readonly string[];
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
  /** Cancels request-scoped transform work after module loading stops. */
  abortSignal?: AbortSignal;
}

/**
 * A transform plugin that processes code at a specific stage.
 */
export interface TransformPlugin {
  /** Plugin name for logging/debugging */
  name: string;
  /**
   * Numeric ordering coordinate for this plugin.
   * TransformStage values are phase anchors; finite fractional values may run
   * between anchors when a plugin needs a stable intermediate position.
   */
  stage: TransformStage;
  /**
   * Stable, versioned identity for output-affecting custom plugin behavior.
   * Custom plugins without an identity still run, but disable persistent caching.
   */
  cacheIdentity?: string;
  /** Optional condition - if false, plugin is skipped */
  condition?: (ctx: TransformContext) => boolean;
  /** Transform function - returns new code */
  transform: (ctx: TransformContext) => Promise<string> | string;
}

/**
 * Result of a transform pipeline run.
 */
export interface TransformResult {
  /** Transformed code */
  code: string;
  /** Content hash */
  contentHash: string;
  /** Timing breakdown by stage */
  timing: Map<TransformStage, number>;
  /** Total transform time in ms */
  totalMs: number;
  /** Whether result was from cache */
  cached: boolean;
}

/**
 * Pipeline configuration.
 */
export interface PipelineConfig {
  /** SSR dependency output, files by default. References require scoped resolution before execution. */
  ssrImports?: "files" | "references";
  /** Enable debug logging */
  debug?: boolean;
  /** Enable timing collection */
  collectTiming?: boolean;
  /** Custom plugins to add */
  plugins?: TransformPlugin[];
}
