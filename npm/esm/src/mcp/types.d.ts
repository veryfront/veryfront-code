import type { Tool } from "../tool/index.js";
import type { Resource } from "../resource/index.js";
import type { Prompt } from "../prompt/index.js";
export interface MCPRegistry {
    tools: Map<string, Tool>;
    resources: Map<string, Resource>;
    prompts: Map<string, Prompt>;
}
export interface MCPServerConfig {
    enabled: boolean;
    port?: number;
    auth?: {
        type: "bearer" | "api-key" | "none";
        validate?: (token: string) => Promise<boolean> | boolean;
    };
    cors?: {
        enabled: boolean;
        origins?: string[];
    };
}
export interface MCPStats {
    tools: number;
    resources: number;
    prompts: number;
    total: number;
}
//# sourceMappingURL=types.d.ts.map