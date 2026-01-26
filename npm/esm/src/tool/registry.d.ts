import type { Tool, ToolDefinition } from "./types.js";
declare class ToolRegistryClass {
    private tools;
    register(id: string, toolInstance: Tool): void;
    get(id: string): Tool | undefined;
    has(id: string): boolean;
    getAllIds(): string[];
    getAll(): Map<string, Tool>;
    clear(): void;
    getToolsForProvider(): ToolDefinition[];
}
export declare const toolRegistry: ToolRegistryClass;
export declare function toolToProviderDefinition(tool: Tool): ToolDefinition;
export {};
//# sourceMappingURL=registry.d.ts.map