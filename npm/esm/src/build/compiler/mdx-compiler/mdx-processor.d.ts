import type { CompileOptions } from "./types.js";
export interface ProcessedMDX {
    code: string;
    imports: string[];
}
export declare function compileMDX(content: string, options: CompileOptions): Promise<ProcessedMDX>;
//# sourceMappingURL=mdx-processor.d.ts.map