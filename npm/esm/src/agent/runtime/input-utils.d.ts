import type { Message } from "../types.js";
export declare function normalizeInput(input: string | Message[]): Message[];
export declare function accumulateUsage(total: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}, usage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
}): void;
export declare function getMaxSteps(configuredMaxSteps: number | undefined, edgeMaxSteps: number | undefined, platformLimit: number, defaultMaxSteps?: number): number;
//# sourceMappingURL=input-utils.d.ts.map