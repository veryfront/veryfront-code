export { compileMDXRuntime } from "./mdx-compiler.ts";
export { extractFrontmatter } from "./frontmatter-extractor.ts";
export { rewriteBodyImports, rewriteCompiledImports } from "./import-rewriter.ts";
export type { CompilationMode, CompilationTarget, MdxRuntimeBundle } from "./types.ts";
export type { FrontmatterExtractionResult } from "./frontmatter-extractor.ts";
export type { ImportRewriterConfig } from "./import-rewriter.ts";

import { compileMDXRuntime } from "./mdx-compiler.ts";
import { compileMarkdownRuntime } from "../../md/compiler/index.ts";
import type { CompilationMode, CompilationTarget, MdxRuntimeBundle } from "./types.ts";

function isMarkdownFile(filePath?: string): boolean {
  return filePath?.endsWith(".md") ?? false;
}

export function compileContent(
  mode: CompilationMode,
  projectDir: string,
  content: string,
  frontmatter?: Record<string, unknown>,
  filePath?: string,
  target: CompilationTarget = "server",
  baseUrl?: string,
): Promise<MdxRuntimeBundle> {
  if (isMarkdownFile(filePath)) {
    return compileMarkdownRuntime(
      mode,
      projectDir,
      content,
      frontmatter,
      filePath,
      target,
      baseUrl,
    );
  }

  return compileMDXRuntime(mode, projectDir, content, frontmatter, filePath, target, baseUrl);
}
