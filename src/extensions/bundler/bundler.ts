/**
 * Contract interface for module bundlers.
 *
 * Default implementation: `@veryfront/ext-bundler-esbuild`
 *
 * @module extensions/bundler/bundler
 */

/** Location of an error or warning in source. */
export interface BundlerMessageLocation {
  /** Source file associated with the diagnostic. */
  file: string;
  /** One-based source line. */
  line: number;
  /** Zero-based source column. */
  column: number;
  /** Length of the highlighted source range. */
  length?: number;
  /** Source line text, when supplied by the bundler. */
  lineText?: string;
}

/** A diagnostic message (error or warning) from a bundler. */
export interface BundlerMessage {
  /** Human-readable diagnostic text. */
  text: string;
  /** Primary source location, when known. */
  location?: BundlerMessageLocation | null;
  /** Additional diagnostic notes. */
  notes?: { text: string; location?: BundlerMessageLocation | null }[];
  /** Plugin that emitted the diagnostic. */
  pluginName?: string;
  /** Implementation-specific diagnostic detail. */
  detail?: unknown;
}

/** Input file entry in a {@link Metafile}. */
export interface MetafileInput {
  /** Input size in bytes. */
  bytes: number;
  /** Imports referenced by this input. */
  imports: { path: string; kind?: string; external?: boolean; original?: string }[];
  /** Detected module format. */
  format?: "cjs" | "esm";
}

/** Output file entry in a {@link Metafile}. */
export interface MetafileOutput {
  /** Output size in bytes. */
  bytes: number;
  /** Input contribution sizes keyed by input path. */
  inputs: Record<string, { bytesInOutput: number }>;
  /** Imports referenced by this output. */
  imports: { path: string; kind?: string; external?: boolean }[];
  /** Export names emitted by this output. */
  exports: string[];
  /** Source entry point associated with the output. */
  entryPoint?: string;
  /** Related CSS bundle path. */
  cssBundle?: string;
}

/** Dependency-graph metadata produced by a bundler when `metafile: true`. */
export interface Metafile {
  /** Input metadata keyed by input path. */
  inputs: Record<string, MetafileInput>;
  /** Output metadata keyed by output path. */
  outputs: Record<string, MetafileOutput>;
}

/** In-memory source input for {@link BundleOptions.stdin}. */
export interface StdinOptions {
  /** Source text to bundle. */
  contents: string;
  /** Base directory used to resolve relative imports. */
  resolveDir?: string;
  /** Virtual source file name used in diagnostics. */
  sourcefile?: string;
  /** Loader applied to the virtual source. */
  loader?: Loader | string;
}

/** Options passed to {@link Bundler.bundle}. */
export interface BundleOptions {
  /** Entry point file paths, or a `{ outputName: inputPath }` map. */
  entryPoints?: string[] | Record<string, string>;
  /** Output directory. */
  outdir?: string;
  /** Bundle format (`esm`, `cjs`, `iife`). */
  format?: "esm" | "cjs" | "iife";
  /** Target environment(s). */
  target?: string | string[];
  /** Enable minification. */
  minify?: boolean;
  /** Enable source maps. */
  sourcemap?: boolean | "inline" | "external" | "linked" | "both";
  /** Enable code splitting. */
  splitting?: boolean;
  /** Additional plugins. */
  plugins?: BundlerPlugin[];

  /** Whether to bundle dependencies into the output (vs. leaving imports as-is). */
  bundle?: boolean;
  /** Write output to disk; when false, returns bytes in-memory only. */
  write?: boolean;
  /** Target platform influencing default externals and resolution. */
  platform?: "browser" | "node" | "neutral";
  /** Packages/paths to exclude from the bundle. */
  external?: string[];
  /** Bundle an in-memory source string instead of reading from disk. */
  stdin?: StdinOptions;
  /** Compile-time constant replacements, e.g. `{ "process.env.NODE_ENV": '"production"' }`. */
  define?: Record<string, string>;
  /** JSX transform mode. */
  jsx?: "transform" | "preserve" | "automatic";
  /** Module specifier used for the automatic JSX runtime import. */
  jsxImportSource?: string;
  /** File extensions to try during import resolution. */
  resolveExtensions?: string[];
  /** Drop unused exports and dead code. */
  treeShaking?: boolean;
  /** Verbosity of diagnostic output. */
  logLevel?: "silent" | "error" | "warning" | "info" | "debug" | "verbose";
  /** Emit a dependency-graph {@link Metafile} in the result. */
  metafile?: boolean;

  /** Extra implementation-specific options. */
  [key: string]: unknown;
}

/** A single output file produced by a bundle operation. */
export interface BundleOutput {
  /** Absolute path to the output file. */
  path: string;
  /** Raw byte content. */
  contents: Uint8Array;
  /** Lazy-decoded UTF-8 string view of `contents`. */
  text: string;
  /** Optional content hash. */
  hash?: string;
}

/** Result returned from {@link Bundler.bundle}. */
export interface BundleResult {
  /** Output files produced by the bundle. */
  outputFiles: BundleOutput[];
  /** Warnings emitted during bundling. */
  warnings: BundlerMessage[];
  /** Errors encountered during bundling. */
  errors: BundlerMessage[];
  /** Dependency-graph metadata, populated when `metafile: true`. */
  metafile?: Metafile;
}

/** Loader hint for source files. Mirrors esbuild's `Loader` type. */
export type Loader =
  | "js"
  | "jsx"
  | "ts"
  | "tsx"
  | "css"
  | "json"
  | "text"
  | "base64"
  | "file"
  | "dataurl"
  | "binary"
  | "default"
  | "empty"
  | "copy";

/** Options passed to {@link Bundler.transform}. */
export interface TransformOptions {
  /** Source code to transform. */
  code: string;
  /** Loader hint (`ts`, `tsx`, `jsx`, `css`, etc.). */
  loader?: Loader;
  /** Output format. */
  format?: "esm" | "cjs" | "iife";
  /** Target environment(s). */
  target?: string | string[];
  /** Enable minification. */
  minify?: boolean;
  /** Enable source maps. */
  sourcemap?: boolean | "inline" | "external";
  /** JSX transform mode. */
  jsx?: "transform" | "preserve" | "automatic";
  /** Module specifier used for the automatic JSX runtime import. */
  jsxImportSource?: string;
  /** Drop unused exports and dead code. */
  treeShaking?: boolean;
  /** Preserve original identifier names through minification. */
  keepNames?: boolean;
  /** Extra implementation-specific options. */
  [key: string]: unknown;
}

/** Result returned from {@link Bundler.transform}. */
export interface TransformResult {
  /** Transformed source code. */
  code: string;
  /** Source map, if requested. */
  map?: string;
  /** Warnings emitted during transformation. */
  warnings: string[];
}

/** Arguments passed to an `onResolve` callback. */
export interface OnResolveArgs {
  /** Import path being resolved. */
  path: string;
  /** Source path containing the import. */
  importer: string;
  /** Active plugin namespace. */
  namespace: string;
  /** Directory used to resolve relative paths. */
  resolveDir: string;
  /** e.g. "import-statement", "dynamic-import", "require-call", "entry-point". */
  kind: string;
  /** Data passed from an earlier plugin callback. */
  pluginData?: unknown;
}

/** Result returned from an `onResolve` callback. */
export interface OnResolveResult {
  /** Resolved path. */
  path?: string;
  /** Namespace assigned to the resolved path. */
  namespace?: string;
  /** Leave the resolved path outside the bundle. */
  external?: boolean;
  /** Errors emitted by the resolver. */
  errors?: BundlerMessage[];
  /** Warnings emitted by the resolver. */
  warnings?: BundlerMessage[];
  /** Data forwarded to later plugin callbacks. */
  pluginData?: unknown;
  /** Whether loading the module may produce side effects. */
  sideEffects?: boolean;
  /** Files whose changes invalidate this resolution. */
  watchFiles?: string[];
}

/** Arguments passed to an `onLoad` callback. */
export interface OnLoadArgs {
  /** Resolved path being loaded. */
  path: string;
  /** Active plugin namespace. */
  namespace: string;
  /** Path suffix excluded from filesystem resolution. */
  suffix?: string;
  /** Data passed from an earlier plugin callback. */
  pluginData?: unknown;
}

/** Result returned from an `onLoad` callback. */
export interface OnLoadResult {
  /** Loaded source contents. */
  contents?: string | Uint8Array;
  /** Loader applied to the contents. */
  loader?: string;
  /** Base directory used to resolve imports in the contents. */
  resolveDir?: string;
  /** Errors emitted by the loader. */
  errors?: BundlerMessage[];
  /** Warnings emitted by the loader. */
  warnings?: BundlerMessage[];
  /** Data forwarded to later plugin callbacks. */
  pluginData?: unknown;
  /** Files whose changes invalidate this load. */
  watchFiles?: string[];
}

/** Build context exposed to bundler plugins. */
export interface BundlerPluginBuild {
  /** Register an import-resolution callback. */
  onResolve(
    options: { filter: RegExp; namespace?: string },
    callback: (
      args: OnResolveArgs,
    ) =>
      | OnResolveResult
      | null
      | undefined
      | void
      | Promise<OnResolveResult | null | undefined | void>,
  ): void;
  /** Register a module-loading callback. */
  onLoad(
    options: { filter: RegExp; namespace?: string },
    callback: (
      args: OnLoadArgs,
    ) =>
      | OnLoadResult
      | null
      | undefined
      | void
      | Promise<OnLoadResult | null | undefined | void>,
  ): void;
  /** Register a callback invoked when the build is disposed. */
  onDispose(callback: () => void): void;
}

/** A bundler plugin that hooks into the build pipeline. */
export interface BundlerPlugin {
  /** Unique plugin name. */
  name: string;
  /** Called once when the plugin is registered. May be async. */
  setup(build: BundlerPluginBuild): void | Promise<void>;
}

/** Incremental/rebuild context produced by {@link Bundler.context}. */
export interface BuildContext {
  /** Re-run the build with cached state. */
  rebuild(): Promise<BundleResult>;
  /** Release context resources. */
  dispose(): Promise<void>;
}

/** Failure thrown by {@link Bundler.bundle} or {@link Bundler.transform}. */
export interface BuildFailure extends Error {
  /** Bundler errors associated with the failure. */
  errors: BundlerMessage[];
  /** Bundler warnings emitted before the failure. */
  warnings: BundlerMessage[];
}

/**
 * Bundler contract interface.
 *
 * Implementations compile and bundle application source code into
 * optimized output suitable for deployment or development.
 */
export interface Bundler {
  /** Bundle one or more entry points into output files. */
  bundle(options: BundleOptions): Promise<BundleResult>;
  /** Transform a single source string without writing to disk. */
  transform(options: TransformOptions): Promise<TransformResult>;
  /** Create an incremental build context (watch/rebuild mode). */
  context?(options: BundleOptions): Promise<BuildContext>;
  /** Release bundler resources (child processes, watchers, etc.). */
  stop?(): Promise<void>;
}
