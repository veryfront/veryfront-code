/**
 * Mdx - Compiler
 *
 * @module transforms/mdx/compiler
 */

export { compileMDXRuntime } from "./mdx-compiler.ts";
export { extractFrontmatter } from "./frontmatter-extractor.ts";
export { rewriteBodyImports, rewriteCompiledImports } from "./import-rewriter.ts";
export type {
  CompilationMode,
  CompilationTarget,
  ContentProcessingResult,
} from "#veryfront/extensions/content/index.ts";
export type { FrontmatterExtractionResult } from "./frontmatter-extractor.ts";
export type { ImportRewriterConfig } from "./import-rewriter.ts";

import { compileMDXRuntime } from "./mdx-compiler.ts";
import { compileMarkdownRuntime } from "../../md/compiler/index.ts";
import type {
  CompilationMode,
  CompilationTarget,
  ContentProcessingResult,
} from "#veryfront/extensions/content/index.ts";

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
  studioEmbed?: boolean,
): Promise<ContentProcessingResult> {
  if (isMarkdownFile(filePath)) {
    return compileMarkdownRuntime(
      mode,
      projectDir,
      content,
      frontmatter,
      filePath,
      target,
      baseUrl,
      studioEmbed,
    );
  }

  return compileMDXRuntime(
    mode,
    projectDir,
    content,
    frontmatter,
    filePath,
    target,
    baseUrl,
    studioEmbed,
  );
}
