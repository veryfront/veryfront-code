/**
 * Component registry for managing and loading React components.
 * @module
 */
import * as React from "react";
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import { VirtualModuleSystem } from "../virtual-module-system.js";
interface FailedComponent {
    name: string;
    error: string;
    filePath: string;
    timestamp: number;
}
/**
 * Registry for managing React components with virtual module system integration.
 * Supports deferred loading, caching, and component initialization.
 *
 * @example
 * ```ts
 * const registry = new ComponentRegistry(virtualModules, 3000, adapter)
 * await registry.loadFromDirectory('./components')
 * const Button = registry.get('Button')
 * ```
 */
export declare class ComponentRegistry {
    private components;
    private virtualModules;
    private componentSources;
    private failedComponents;
    private initialized;
    private projectDir;
    private serverPort;
    private adapter?;
    private moduleServerUrl?;
    private vendorBundleHash?;
    /** Project ID (UUID) for SSR cache isolation in multi-project mode */
    private projectId?;
    /** Content source identifier for cache isolation (branch or release) */
    private contentSourceId?;
    /**
     * Creates a new component registry.
     *
     * @param virtualModules - Optional virtual module system instance
     * @param serverPort - Server port for module loading (defaults to DEFAULT_DASHBOARD_PORT)
     * @param adapter - Runtime adapter for file system operations
     * @param moduleServerUrl - Optional URL for module server
     * @param vendorBundleHash - Optional hash for vendor bundle versioning
     * @param projectId - Project ID (UUID) for SSR cache isolation in multi-project mode
     * @param contentSourceId - Content source identifier for cache isolation
     */
    constructor(virtualModules?: VirtualModuleSystem, serverPort?: number, adapter?: RuntimeAdapter, moduleServerUrl?: string, vendorBundleHash?: string, projectId?: string, contentSourceId?: string);
    /**
     * Loads components from a directory.
     *
     * @param dir - Directory path containing component files
     * @param deferLoading - If true, stores component sources for later initialization
     *
     * @remarks
     * Processes files with extensions: .tsx, .jsx, .ts, .js
     * Automatically determines project root from directory structure
     * Registers components in virtual module system
     */
    loadFromDirectory(dir: string, deferLoading?: boolean): Promise<void>;
    /**
     * Retrieves a component by name.
     *
     * @param name - Component name (without file extension)
     * @returns The React component or null if not found
     *
     * @remarks
     * Returns null if component is pending initialization (deferred loading)
     */
    get(name: string): React.ComponentType<Record<string, unknown>> | null;
    /**
     * Gets all registered components as a record.
     *
     * @returns Record mapping component names to component instances
     */
    getAll(): Record<string, React.ComponentType<Record<string, unknown>>>;
    /**
     * Gets all components as MDXComponents record (for MDX rendering).
     * Returns components typed as ComponentType<unknown> for compatibility with MDX.
     *
     * @returns Record mapping component names to component instances with unknown props
     */
    getAllAsComponents(): Record<string, React.ComponentType<unknown>>;
    /**
     * Checks if a component is registered.
     *
     * @param name - Component name to check
     * @returns True if the component is registered
     */
    has(name: string): boolean;
    /**
     * Gets the virtual module system instance.
     *
     * @returns The virtual module system used by this registry
     */
    getVirtualModuleSystem(): VirtualModuleSystem;
    /**
     * Clear loaded components and reset initialization state.
     */
    clear(): void;
    /**
     * Initializes all deferred components.
     * Should be called after loadFromDirectory with deferLoading=true.
     *
     * @remarks
     * Loads all stored component sources and marks registry as initialized.
     * Failed components are replaced with error fallback components to prevent
     * one broken component from crashing the entire page.
     * Only runs once - subsequent calls return immediately.
     */
    initializeComponents(): Promise<void>;
    /**
     * Gets information about failed components.
     * @returns Array of failed component records
     */
    getFailedComponents(): FailedComponent[];
    /**
     * Checks if a component failed to load.
     * @param name - Component name to check
     * @returns True if the component failed to load
     */
    hasFailed(name: string): boolean;
    private getLoaderOptions;
    private collectComponents;
}
export {};
//# sourceMappingURL=component-registry.d.ts.map