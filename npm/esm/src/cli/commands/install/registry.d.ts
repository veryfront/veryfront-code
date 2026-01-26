import { type AITool, type AIToolId } from "./types.js";
export declare const AI_TOOLS: AITool[];
export declare function getAllToolIds(): AIToolId[];
export declare function getToolById(id: string): AITool;
export declare function isValidToolId(id: string): id is AIToolId;
export declare function getTemplateContent(toolId: string): Promise<string>;
//# sourceMappingURL=registry.d.ts.map