import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type * as React from "react";
export interface ComponentExports {
    default?: unknown;
    [key: string]: unknown;
}
export interface ComponentInfo {
    name: string;
    path: string;
    content?: string;
    isLoaded: boolean;
    exports?: ComponentExports;
}
export interface ComponentRegistryOptions {
    projectDir: string;
    componentDirs?: string[];
    adapter: RuntimeAdapter;
    moduleServerUrl?: string;
    vendorBundleHash?: string;
}
export type ComponentLoader = {
    loadComponent: (componentName: string, source: string, projectDir: string) => Promise<unknown>;
    clearCache: () => void;
};
export declare class ComponentRegistry {
    private options;
    private components;
    private componentDirs;
    private initializedPromise;
    private adapter;
    private initialized;
    constructor(options: ComponentRegistryOptions);
    discover(): Promise<void>;
    private _discoverInternal;
    private walkDirectory;
    loadComponent(name: string): Promise<ComponentInfo | null>;
    loadAll(): Promise<void>;
    get(name: string): ComponentInfo | undefined;
    getAll(): Map<string, ComponentInfo>;
    /**
     * Loader accessor for compatibility with older tests; loader is not used in this registry.
     */
    getLoader(): ComponentLoader | undefined;
    /**
     * Get all components as MDXComponents record (for MDX rendering)
     */
    getAllAsComponents(): Record<string, React.ComponentType<unknown>>;
    has(name: string): boolean;
    add(name: string, info: Partial<ComponentInfo>): void;
    remove(name: string): void;
    clear(): void;
    getComponentNames(): string[];
    listComponents(): Promise<Array<{
        name: string;
        path: string;
        size?: number;
        lastModified?: string;
        type: string;
    }>>;
}
//# sourceMappingURL=registry.d.ts.map