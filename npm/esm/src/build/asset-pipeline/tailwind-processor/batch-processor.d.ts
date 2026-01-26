import type { TailwindProcessorOptions, TailwindProcessResult } from "./types.js";
export declare function processTailwindCSS(options: TailwindProcessorOptions): Promise<TailwindProcessResult>;
export declare function processTailwindCSSInDirectory(projectDir: string, cssDir?: string, outputDir?: string): Promise<TailwindProcessResult[]>;
//# sourceMappingURL=batch-processor.d.ts.map