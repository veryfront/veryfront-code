export interface CompileOptions {
  projectDir: string;
  outputDir: string;
  mode: "development" | "production";
  /** Cancels batch compilation or closes a long-running MDX watcher. */
  signal?: AbortSignal;
}

export interface MDXFrontmatter {
  title?: string;
  description?: string;
  layout?: boolean;
  [key: string]: unknown;
}

export interface CompileResult {
  outputPath: string;
  frontmatter: MDXFrontmatter;
  imports: string[];
}

type UnifiedPlugin = unknown | [unknown, ...unknown[]];
export type PluginList = UnifiedPlugin[];
