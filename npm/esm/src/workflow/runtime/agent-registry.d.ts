import type { Agent } from "../../agent/index.js";
import type { Tool } from "../../tool/index.js";
import type { AgentRegistry, ToolRegistry } from "../executor/step-executor.js";
export declare class DefaultAgentRegistry implements AgentRegistry {
    private agents;
    registerAgent(agent: Agent): void;
    registerAgents(agents: Agent[]): void;
    get(id: string): Agent | undefined;
    hasAgent(id: string): boolean;
    listAgentIds(): string[];
    removeAgent(id: string): boolean;
    clear(): void;
}
export declare class DefaultToolRegistry implements ToolRegistry {
    private tools;
    registerTool(tool: Tool): void;
    registerTools(tools: Tool[]): void;
    get(name: string): Tool | undefined;
    hasTool(name: string): boolean;
    listToolNames(): string[];
    removeTool(name: string): boolean;
    clear(): void;
}
export declare function createMockAgent(id: string, options?: {
    response?: string;
    responseFunc?: (input: string) => string | Promise<string>;
    toolCalls?: Array<{
        id: string;
        name: string;
        args: Record<string, unknown>;
    }>;
}): Agent;
export declare function createMockTool(id: string, options?: {
    description?: string;
    result?: unknown;
    executeFunc?: (args: Record<string, unknown>) => unknown | Promise<unknown>;
}): Tool;
//# sourceMappingURL=agent-registry.d.ts.map