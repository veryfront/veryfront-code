export interface MdxRuntimeBundle {
  compiledCode: string;
  frontmatter: Record<string, unknown>;
  globals: Record<string, unknown>;
  headings?: { id: string; text: string; level: number }[];
  nodeMap?: Map<number, unknown>;
}

export type CompilationMode = "development" | "production";
export type CompilationTarget = "browser" | "server";
