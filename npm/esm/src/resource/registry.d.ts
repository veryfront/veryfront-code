import type { Resource } from "./types.js";
declare class ResourceRegistryClass {
    private resources;
    register(id: string, resourceInstance: Resource): void;
    get(id: string): Resource | undefined;
    findByPattern(uri: string): Resource | undefined;
    private patternToRegex;
    private matchesPattern;
    extractParams(uri: string, pattern: string): Record<string, string>;
    getAll(): Map<string, Resource>;
    list(): string[];
    has(id: string): boolean;
    clear(): void;
}
export declare const resourceRegistry: ResourceRegistryClass;
export {};
//# sourceMappingURL=registry.d.ts.map