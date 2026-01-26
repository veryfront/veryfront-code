import type { MCPRegistry, MCPStats } from "./types.js";
import type { Tool } from "../tool/index.js";
import type { Resource } from "../resource/index.js";
import type { Prompt } from "../prompt/index.js";
export declare function getMCPRegistry(): MCPRegistry;
export declare function registerTool(id: string, tool: Tool): void;
export declare function registerResource(id: string, resource: Resource): void;
export declare function registerPrompt(id: string, prompt: Prompt): void;
export declare function getMCPStats(): MCPStats;
export declare function clearMCPRegistry(): void;
//# sourceMappingURL=registry.d.ts.map