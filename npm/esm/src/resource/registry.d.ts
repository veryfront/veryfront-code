/**
 * Resource Registry
 *
 * Project-scoped registry for MCP resources. Each project has its own
 * isolated resource namespace, preventing cross-project resource access.
 *
 * @module
 */
import type { Resource } from "./types.js";
declare class ResourceRegistryClass {
    register(id: string, resourceInstance: Resource): void;
    /**
     * Register a framework-provided resource available to all projects.
     */
    registerShared(id: string, resourceInstance: Resource): void;
    get(id: string): Resource | undefined;
    findByPattern(uri: string): Resource | undefined;
    private patternToRegex;
    private matchesPattern;
    extractParams(uri: string, pattern: string): Record<string, string>;
    getAll(): Map<string, Resource>;
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
export declare const resourceRegistry: ResourceRegistryClass;
export {};
//# sourceMappingURL=registry.d.ts.map