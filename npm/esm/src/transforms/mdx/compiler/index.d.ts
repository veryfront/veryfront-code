export { compileMDXRuntime } from "./mdx-compiler.js";
export { extractFrontmatter } from "./frontmatter-extractor.js";
export { rewriteBodyImports, rewriteCompiledImports } from "./import-rewriter.js";
export type { CompilationMode, CompilationTarget, MdxRuntimeBundle } from "./types.js";
export type { FrontmatterExtractionResult } from "./frontmatter-extractor.js";
export type { ImportRewriterConfig } from "./import-rewriter.js";
import type { CompilationMode, CompilationTarget, MdxRuntimeBundle } from "./types.js";
export declare function compileContent(mode: CompilationMode, projectDir: string, content: string, frontmatter?: Record<string, unknown>, filePath?: string, target?: CompilationTarget, baseUrl?: string): Promise<MdxRuntimeBundle>;
//# sourceMappingURL=index.d.ts.map