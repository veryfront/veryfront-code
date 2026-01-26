import type { Tool } from "../../tool/index.js";
import type { JsonSchema } from "../../tool/schema/index.js";
declare const MODEL_BRAND = "ai-sdk-model";
export interface AISDKModelWrapper<Model = unknown> {
    __type: typeof MODEL_BRAND;
    model: Model;
}
export declare function aiSDKModel<Model = unknown>(model: Model): AISDKModelWrapper<Model>;
export declare function isAISDKModel(value: unknown): value is AISDKModelWrapper;
export declare const useAISDK: typeof aiSDKModel;
export declare function toAISDKTool(tool: Tool): {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: JsonSchema;
    };
};
export declare function toAISDKTools(tools: Record<string, Tool>): Record<string, {
    description: string;
    parameters: JsonSchema;
    execute: Tool["execute"];
}>;
export declare const AI_SDK_ADAPTER_VERSION = "1.0.0";
export declare const AI_SDK_SUPPORTED_VERSION = "3.x";
export {};
//# sourceMappingURL=ai-sdk.d.ts.map