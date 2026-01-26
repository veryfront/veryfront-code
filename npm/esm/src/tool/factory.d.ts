import type { Tool, ToolConfig, ToolExecutionContext } from "./types.js";
export declare function tool<TInput = unknown, TOutput = unknown>(config: ToolConfig<TInput, TOutput>): Tool<TInput, TOutput>;
export interface DynamicToolConfig {
    id?: string;
    description: string;
    inputSchema: unknown;
    execute: (input: unknown, context?: ToolExecutionContext) => Promise<unknown> | unknown;
    toModelOutput?: (output: unknown) => unknown;
    mcp?: {
        enabled?: boolean;
        requiresAuth?: boolean;
        cachePolicy?: "no-cache" | "cache" | "cache-first";
    };
}
export declare function dynamicTool(config: DynamicToolConfig): Tool<unknown, unknown>;
//# sourceMappingURL=factory.d.ts.map