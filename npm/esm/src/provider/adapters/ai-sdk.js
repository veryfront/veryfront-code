import { zodToJsonSchema } from "../../tool/schema/index.js";
const MODEL_BRAND = "ai-sdk-model";
export function aiSDKModel(model) {
    return { __type: MODEL_BRAND, model };
}
export function isAISDKModel(value) {
    if (!value || typeof value !== "object")
        return false;
    return value.__type === MODEL_BRAND;
}
export const useAISDK = aiSDKModel;
function getToolSchema(tool) {
    if (tool.inputSchemaJson)
        return tool.inputSchemaJson;
    try {
        const schema = tool.inputSchema;
        if (schema?._def?.typeName)
            return zodToJsonSchema(tool.inputSchema);
    }
    catch {
        // fall through to fallback
    }
    return { type: "object", properties: {} };
}
export function toAISDKTool(tool) {
    return {
        type: "function",
        function: {
            name: tool.id,
            description: tool.description,
            parameters: getToolSchema(tool),
        },
    };
}
export function toAISDKTools(tools) {
    const aiTools = {};
    for (const [name, tool] of Object.entries(tools)) {
        aiTools[name] = {
            description: tool.description,
            parameters: getToolSchema(tool),
            execute: tool.execute,
        };
    }
    return aiTools;
}
export const AI_SDK_ADAPTER_VERSION = "1.0.0";
export const AI_SDK_SUPPORTED_VERSION = "3.x";
