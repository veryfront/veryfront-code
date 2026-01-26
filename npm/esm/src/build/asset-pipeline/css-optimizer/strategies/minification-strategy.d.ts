import type { CSSOptimizationOptions, CSSOptimizationStrategy, CSSProcessingResult } from "../types/index.js";
export declare class MinificationStrategy implements CSSOptimizationStrategy {
    readonly name = "basic-minification";
    readonly priority = 10;
    canProcess(options: CSSOptimizationOptions): boolean;
    process(content: string, filename: string, _options: CSSOptimizationOptions): Promise<CSSProcessingResult>;
}
//# sourceMappingURL=minification-strategy.d.ts.map