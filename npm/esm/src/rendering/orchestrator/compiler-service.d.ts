import type { MdxBundle } from "../../types/index.js";
export type CompileMDXFunction = (content: string, frontmatter?: Record<string, unknown>, filePath?: string) => Promise<MdxBundle>;
export declare class CompilerService {
    private _compileMDX;
    setCompileMDX(fn: CompileMDXFunction): void;
    compileMDX(content: string, frontmatter?: Record<string, unknown>, filePath?: string): Promise<MdxBundle>;
    getCompileFunction(): CompileMDXFunction;
}
//# sourceMappingURL=compiler-service.d.ts.map