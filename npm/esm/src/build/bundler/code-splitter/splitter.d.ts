import type { SplitOptions, SplitResult } from "./types.js";
export declare class CodeSplitter {
    private options;
    constructor(options: SplitOptions);
    split(): Promise<SplitResult>;
    private processOutputs;
    private calculateTotalSize;
    private sumChunkSizes;
}
//# sourceMappingURL=splitter.d.ts.map