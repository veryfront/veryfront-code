import type { CSSOptimizationOptions, CSSOptimizationStrategy, CSSProcessingResult } from "../types/index.js";
export declare class LightningCSSStrategy implements CSSOptimizationStrategy {
    readonly name = "lightning-css";
    readonly priority = 100;
    private lightningCSS;
    private initialized;
    init(): Promise<boolean>;
    canProcess(options: CSSOptimizationOptions): boolean;
    process(content: string, filename: string, options: CSSOptimizationOptions): Promise<CSSProcessingResult>;
    isAvailable(): boolean;
}
//# sourceMappingURL=lightning-strategy.d.ts.map