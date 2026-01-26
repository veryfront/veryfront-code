import type { CompileOptions, CompileResult } from "./types.js";
export declare function compileAllMDX(options: CompileOptions): Promise<Map<string, CompileResult>>;
export declare function compileMDXDirectory(dir: string, options: CompileOptions, results: Map<string, CompileResult>): Promise<void>;
//# sourceMappingURL=directory-compiler.d.ts.map