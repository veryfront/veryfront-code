export { compileMDXRuntime } from "./mdx-compiler.js";
export { extractFrontmatter } from "./frontmatter-extractor.js";
export { rewriteBodyImports, rewriteCompiledImports } from "./import-rewriter.js";
export type { CompilationMode, CompilationTarget, MdxRuntimeBundle } from "./types.js";
export type { FrontmatterExtractionResult } from "./frontmatter-extractor.js";
export type { ImportRewriterConfig } from "./import-rewriter.js";

import { compileMDXRuntime } from "./mdx-compiler.js";
import { compileMarkdownRuntime } from "../../md/compiler/index.js";
import type { CompilationMode, CompilationTarget, MdxRuntimeBundle } from "./types.js";

function isMarkdownFile(filePath?: string): boolean {
  if (!filePath) return false;
  return filePath.endsWith(".md");
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
