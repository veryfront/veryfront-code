import type { CSSOptimizationOptions, CSSOptimizationStrategy, CSSProcessingResult } from "../types/index.js";
export declare class PurgeStrategy implements CSSOptimizationStrategy {
    readonly name = "purge-css";
    readonly priority = 50;
    private usedSelectors;
    canProcess(options: CSSOptimizationOptions): boolean;
    analyzeContent(purgeContent: string[]): Promise<void>;
    process(content: string, _filename: string, options: CSSOptimizationOptions): Promise<CSSProcessingResult>;
    private purgeUnusedCSS;
    getUsedSelectors(): Set<string>;
    clearCache(): void;
}
//# sourceMappingURL=purge-strategy.d.ts.map