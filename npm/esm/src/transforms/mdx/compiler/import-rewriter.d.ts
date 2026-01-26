import type { CompilationTarget } from "./types.js";
export interface ImportRewriterConfig {
    filePath: string;
    target: CompilationTarget;
    baseUrl?: string;
    projectDir?: string;
}
export declare function rewriteBodyImports(body: string, config: ImportRewriterConfig): string;
export declare function rewriteCompiledImports(compiledCode: string, config: ImportRewriterConfig): string;
//# sourceMappingURL=import-rewriter.d.ts.map