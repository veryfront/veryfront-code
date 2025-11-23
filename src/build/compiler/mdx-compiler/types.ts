export interface CompileOptions {
  projectDir: string;
  outputDir: string;
  mode: "development" | "production";
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

// deno-lint-ignore no-explicit-any
type UnifiedPlugin = any | [any, ...any[]];
export type PluginList = UnifiedPlugin[];
