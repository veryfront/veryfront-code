import type { Workflow, WorkflowDefinition } from "./types.js";
/**
 * Serializable node information for the registry
 */
export interface NodeInfo {
    id: string;
    type: string;
    /** Agent ID if this is a step using an agent */
    agent?: string;
    /** Tool ID if this is a step using a tool */
    tool?: string;
    /** Node IDs this node depends on */
    dependsOn?: string[];
    /** Child node IDs (for parallel/branch nodes) */
    children?: string[];
    /** Description from wait/approval nodes */
    message?: string;
}
/**
 * Workflow metadata for the registry (serializable)
 */
export interface WorkflowMetadata {
    id: string;
    description?: string;
    version?: string;
    timeout?: string | number;
    /** True when steps are defined dynamically via a function */
    dynamicSteps?: boolean;
    /** True when dynamic step introspection is disabled */
    introspectionSkipped?: boolean;
    /** Error message if introspection failed */
    introspectionError?: string;
    nodeCount: number;
    nodeTypes: string[];
    /** Detailed node information */
    nodes: NodeInfo[];
    /** Agent IDs referenced by this workflow */
    agentRefs: string[];
    /** Tool IDs referenced by this workflow */
    toolRefs: string[];
    hasInputSchema: boolean;
    hasOutputSchema: boolean;
    /** JSON Schema representation of input schema (if available) */
    inputSchemaJson?: Record<string, unknown>;
    registeredAt: string;
}
/**
 * Workflow Registry class
 */
declare class WorkflowRegistryClass {
    private workflows;
    private definitions;
    /**
     * Register a workflow definition
     */
    register(workflow: Workflow | WorkflowDefinition): void;
    /**
     * Get workflow metadata by ID
     */
    get(id: string): WorkflowMetadata | undefined;
    /**
     * Get workflow definition by ID
     */
    getDefinition(id: string): WorkflowDefinition | undefined;
    /**
     * Check if a workflow is registered
     */
    has(id: string): boolean;
    /**
     * Get all workflow IDs
     */
    getAllIds(): string[];
    /**
     * Get all workflow metadata
     */
    getAll(): Map<string, WorkflowMetadata>;
    /**
     * Get all as array (for API responses)
     */
    getAllAsArray(): WorkflowMetadata[];
    /**
     * Get registry stats
     */
    getStats(): {
        total: number;
        byNodeType: Record<string, number>;
        withInputSchema: number;
        withOutputSchema: number;
    };
    /**
     * Remove a workflow
     */
    unregister(id: string): boolean;
    /**
     * Clear all workflows (for testing)
     */
    clear(): void;
}
export declare const workflowRegistry: WorkflowRegistryClass;
export { WorkflowRegistryClass };
/**
 * Register a workflow definition globally
 */
export declare function registerWorkflow(workflow: Workflow | WorkflowDefinition): void;
/**
 * Get a workflow by ID
 */
export declare function getWorkflow(id: string): WorkflowMetadata | undefined;
/**
 * Get all registered workflow IDs
 */
export declare function getAllWorkflowIds(): string[];
//# sourceMappingURL=registry.d.ts.map