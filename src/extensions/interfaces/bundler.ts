/**
 * Contract interface for module bundlers.
 *
 * Default implementation: `@veryfront/ext-esbuild`
 *
 * @module extensions/interfaces/bundler
 */

/** Options passed to {@link Bundler.bundle}. */
export interface BundleOptions {
  /** Entry point file paths. */
  entryPoints: string[];
  /** Output directory. */
  outdir: string;
  /** Bundle format (`esm`, `cjs`, `iife`). */
  format?: "esm" | "cjs" | "iife";
  /** Target environment(s). */
  target?: string | string[];
  /** Enable minification. */
  minify?: boolean;
  /** Enable source maps. */
  sourcemap?: boolean | "inline" | "external";
  /** Enable code splitting. */
  splitting?: boolean;
  /** Additional plugins. */
  plugins?: BundlerPlugin[];
  /** Extra implementation-specific options. */
  [key: string]: unknown;
}

/** A single output file produced by a bundle operation. */
export interface BundleOutput {
  /** Absolute path to the output file. */
  path: string;
  /** Raw byte content. */
  contents: Uint8Array;
}

/** Result returned from {@link Bundler.bundle}. */
export interface BundleResult {
  /** Output files produced by the bundle. */
  outputs: BundleOutput[];
  /** Warnings emitted during bundling. */
  warnings: string[];
  /** Errors encountered during bundling. */
  errors: string[];
}

/** Options passed to {@link Bundler.transform}. */
export interface TransformOptions {
  /** Source code to transform. */
  code: string;
  /** Loader hint (`ts`, `tsx`, `jsx`, `css`, etc.). */
  loader?: string;
  /** Output format. */
  format?: "esm" | "cjs" | "iife";
  /** Target environment(s). */
  target?: string | string[];
  /** Enable minification. */
  minify?: boolean;
  /** Enable source maps. */
  sourcemap?: boolean | "inline" | "external";
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

/** Build context exposed to bundler plugins. */
export interface BundlerPluginBuild {
  /** Register a resolver callback for the given filter. */
  onResolve(
    options: { filter: RegExp; namespace?: string },
    callback: (
      args: { path: string; namespace: string },
    ) => { path?: string; namespace?: string; external?: boolean } | undefined,
  ): void;
  /** Register a loader callback for the given filter. */
  onLoad(
    options: { filter: RegExp; namespace?: string },
    callback: (
      args: { path: string; namespace: string },
    ) => { contents?: string; loader?: string } | undefined,
  ): void;
}

/** A bundler plugin that hooks into the build pipeline. */
export interface BundlerPlugin {
  /** Unique plugin name. */
  name: string;
  /** Called once when the plugin is registered. */
  setup(build: BundlerPluginBuild): void;
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
  /** Release bundler resources (child processes, watchers, etc.). */
  stop?(): Promise<void>;
}
