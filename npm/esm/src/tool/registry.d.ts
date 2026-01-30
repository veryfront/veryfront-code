/**
 * Tool Registry
 *
 * Project-scoped registry for AI tools. Each project has its own isolated
 * tool namespace, preventing cross-project tool access.
 *
 * @module
 */
import type { Tool, ToolDefinition } from "./types.js";
declare class ToolRegistryClass {
    register(id: string, toolInstance: Tool): void;
    /**
     * Register a framework-provided tool available to all projects.
     */
    registerShared(id: string, toolInstance: Tool): void;
    get(id: string): Tool | undefined;
    has(id: string): boolean;
    getAllIds(): string[];
    getAll(): Map<string, Tool>;
    clear(): void;
    /**
     * Clear everything (for testing).
     */
    clearAll(): void;
    getToolsForProvider(): ToolDefinition[];
    getStats(): {
        projectCount: number;
        sharedCount: number;
        totalItems: number;
        currentProjectItems: number;
    };
}
export declare const toolRegistry: ToolRegistryClass;
export declare function toolToProviderDefinition(tool: Tool): ToolDefinition;
export {};
//# sourceMappingURL=registry.d.ts.map