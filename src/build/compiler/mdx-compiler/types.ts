import type { MDXFrontmatter } from "../frontmatter.ts";

/** Options shared by batch, single-file, and watch-mode MDX compilation. */
export interface CompileOptions {
  /** Project root that contains every source directory. */
  projectDir: string;
  /** Output root for generated JavaScript modules. */
  outputDir: string;
  /** Controls development or production content transforms. */
  mode: "development" | "production";
  /** Project-relative directories that contain MDX sources. */
  sourceDirectories?: readonly string[];
  /** Stops an active MDX watcher when aborted. */
  signal?: AbortSignal;
}

export type { MDXFrontmatter } from "../frontmatter.ts";

/** Output metadata for one compiled MDX source. */
export interface CompileResult {
  /** Generated module path. */
  outputPath: string;
  /** Validated frontmatter extracted from the source. */
  frontmatter: MDXFrontmatter;
  /** Static module specifiers referenced by the generated module. */
  imports: string[];
}

type UnifiedPlugin = unknown | [unknown, ...unknown[]];
/** Unified-compatible plugin values retained for extension contracts. */
export type PluginList = UnifiedPlugin[];
