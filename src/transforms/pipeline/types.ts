/**
 * Transform pipeline types.
 *
 * Defines the plugin-based architecture for ESM transforms.
 * Each stage handles one concern, making the pipeline testable and maintainable.
 */

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
  /** Vendor bundle hash for cache busting */
  vendorBundleHash?: string;
  /** SSR mode (true) or browser mode (false) */
  ssr?: boolean;
  /** API base URL for cross-project imports */
  apiBaseUrl?: string;
  /** Enable node position injection for Studio Navigator */
  studioEmbed?: boolean;
}

/**
 * Context passed through the transform pipeline.
 * Mutable - stages update ctx.code as they process.
 */
export interface TransformContext {
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
}

/**
 * A transform plugin that processes code at a specific stage.
 */
export interface TransformPlugin {
  /** Plugin name for logging/debugging */
  name: string;
  /** Stage this plugin runs at */
  stage: TransformStage;
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
  /** Enable debug logging */
  debug?: boolean;
  /** Enable timing collection */
  collectTiming?: boolean;
  /** Custom plugins to add */
  plugins?: TransformPlugin[];
}
