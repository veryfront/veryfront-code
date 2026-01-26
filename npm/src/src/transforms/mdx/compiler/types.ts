export interface MdxRuntimeBundle {
  compiledCode: string;
  frontmatter: Record<string, unknown>;
  globals: Record<string, unknown>;
  headings?: { id: string; text: string; level: number }[];
  nodeMap?: Map<number, unknown>;
  /** Raw HTML output (for standalone markdown preview) */
  rawHtml?: string;
}

export type CompilationMode = "development" | "production";
export type CompilationTarget = "browser" | "server";
