/**
 * Prompt Registry
 *
 * Project-scoped registry for prompt templates. Each project has its own
 * isolated prompt namespace, preventing cross-project prompt access.
 *
 * @module
 */
import type { Prompt } from "./types.js";
declare class PromptRegistryClass {
    register(id: string, promptInstance: Prompt): void;
    /**
     * Register a framework-provided prompt available to all projects.
     */
    registerShared(id: string, promptInstance: Prompt): void;
    get(id: string): Prompt | undefined;
    getContent(id: string, variables?: Record<string, unknown>): Promise<string>;
    getAll(): Map<string, Prompt>;
    list(): string[];
    has(id: string): boolean;
    clear(): void;
    /**
     * Clear everything (for testing).
     */
    clearAll(): void;
    getStats(): {
        projectCount: number;
        sharedCount: number;
        totalItems: number;
        currentProjectItems: number;
    };
}
export declare const promptRegistry: PromptRegistryClass;
export {};
//# sourceMappingURL=registry.d.ts.map