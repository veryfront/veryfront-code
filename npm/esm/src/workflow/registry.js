/****
 * Workflow Registry
 *
 * Project-scoped registry for workflow DEFINITIONS (not executions).
 * Each project has its own isolated workflow namespace, preventing
 * cross-project workflow access.
 *
 * Note: This registry stores workflow metadata/definitions only.
 * Workflow RUNS are managed by WorkflowClient with backend-specific storage.
 *
 * @module
 */
import { zodToJsonSchema } from "../tool/schema/index.js";
import { agentLogger as logger } from "../utils/index.js";
import { ProjectScopedRegistryManager } from "../ai/registry-manager.js";
function createProxy() {
    return new Proxy({}, {
        get: (_target, prop) => (typeof prop === "string" ? createProxy() : undefined),
    });
}
/**
 * Extract metadata from a workflow definition
 */
function extractMetadata(definition) {
    let workflowNodes = [];
    let dynamicSteps = false;
    let introspectionSkipped = false;
    let introspectionError;
    if (Array.isArray(definition.steps)) {
        workflowNodes = definition.steps;
    }
    else if (typeof definition.steps === "function") {
        dynamicSteps = true;
        if (!definition.introspect) {
            introspectionSkipped = true;
            logger.debug(`[WorkflowRegistry] Skipping dynamic steps introspection for "${definition.id}" (introspect=false)`);
        }
        else {
            try {
                const dummyInput = createProxy();
                const dummyContext = { input: createProxy() };
                workflowNodes = definition.steps({
                    input: dummyInput,
                    context: dummyContext,
                });
            }
            catch (error) {
                introspectionError = error instanceof Error ? error.message : String(error);
                logger.warn(`[WorkflowRegistry] Failed to introspect steps for "${definition.id}": ${introspectionError}`);
            }
        }
    }
    const nodeTypes = new Set();
    const nodeInfoList = [];
    const agentRefs = new Set();
    const toolRefs = new Set();
    function extractNodeInfo(nodeList) {
        const ids = [];
        for (const node of nodeList) {
            const type = node.config.type;
            nodeTypes.add(type);
            ids.push(node.id);
            const nodeInfo = {
                id: node.id,
                type,
                dependsOn: node.dependsOn,
            };
            const config = node.config;
            if (type === "step") {
                const agentValue = config.agent;
                const agentRef = typeof agentValue === "string"
                    ? agentValue
                    : agentValue?.id;
                if (agentRef) {
                    nodeInfo.agent = agentRef;
                    agentRefs.add(agentRef);
                }
                const toolValue = config.tool;
                const toolRef = typeof toolValue === "string"
                    ? toolValue
                    : toolValue?.id;
                if (toolRef) {
                    nodeInfo.tool = toolRef;
                    toolRefs.add(toolRef);
                }
            }
            if (type === "wait" && "message" in config) {
                nodeInfo.message = config.message;
            }
            const children = [];
            if ("nodes" in config && Array.isArray(config.nodes)) {
                children.push(...extractNodeInfo(config.nodes));
            }
            if ("then" in config && Array.isArray(config.then)) {
                children.push(...extractNodeInfo(config.then));
            }
            if ("else" in config && Array.isArray(config.else)) {
                children.push(...extractNodeInfo(config.else));
            }
            if (children.length)
                nodeInfo.children = children;
            nodeInfoList.push(nodeInfo);
        }
        return ids;
    }
    extractNodeInfo(workflowNodes);
    let inputSchemaJson;
    if (definition.inputSchema) {
        try {
            inputSchemaJson = zodToJsonSchema(definition.inputSchema);
        }
        catch {
            // Ignore conversion errors
        }
    }
    return {
        id: definition.id,
        description: definition.description,
        version: definition.version,
        timeout: definition.timeout,
        dynamicSteps,
        introspectionSkipped,
        introspectionError,
        nodeCount: workflowNodes.length,
        nodeTypes: Array.from(nodeTypes),
        nodes: nodeInfoList,
        agentRefs: Array.from(agentRefs),
        toolRefs: Array.from(toolRefs),
        hasInputSchema: !!definition.inputSchema,
        hasOutputSchema: !!definition.outputSchema,
        inputSchemaJson,
        registeredAt: new Date().toISOString(),
    };
}
const workflowMetadataManager = new ProjectScopedRegistryManager("workflow");
const workflowDefinitionManager = new ProjectScopedRegistryManager("workflow-definition");
/**
 * Workflow Registry class
 */
class WorkflowRegistryClass {
    /**
     * Register a workflow definition
     */
    register(workflow) {
        const definition = "definition" in workflow ? workflow.definition : workflow;
        const metadata = extractMetadata(definition);
        workflowMetadataManager.register(definition.id, metadata);
        workflowDefinitionManager.register(definition.id, definition);
    }
    /**
     * Register a framework-provided workflow available to all projects.
     */
    registerShared(workflow) {
        const definition = "definition" in workflow ? workflow.definition : workflow;
        const metadata = extractMetadata(definition);
        workflowMetadataManager.registerShared(definition.id, metadata);
        workflowDefinitionManager.registerShared(definition.id, definition);
    }
    /**
     * Get workflow metadata by ID
     */
    get(id) {
        return workflowMetadataManager.get(id);
    }
    /**
     * Get workflow definition by ID
     */
    getDefinition(id) {
        return workflowDefinitionManager.get(id);
    }
    /**
     * Check if a workflow is registered
     */
    has(id) {
        return workflowMetadataManager.has(id);
    }
    /**
     * Get all workflow IDs
     */
    getAllIds() {
        return workflowMetadataManager.getAllIds();
    }
    /**
     * Get all workflow metadata
     */
    getAll() {
        return workflowMetadataManager.getAll();
    }
    /**
     * Get all as array (for API responses)
     */
    getAllAsArray() {
        return Array.from(this.getAll().values());
    }
    /**
     * Get registry stats
     */
    getStats() {
        const byNodeType = {};
        let withInputSchema = 0;
        let withOutputSchema = 0;
        for (const metadata of this.getAll().values()) {
            for (const nodeType of metadata.nodeTypes) {
                byNodeType[nodeType] = (byNodeType[nodeType] ?? 0) + 1;
            }
            if (metadata.hasInputSchema)
                withInputSchema++;
            if (metadata.hasOutputSchema)
                withOutputSchema++;
        }
        return {
            total: this.getAll().size,
            byNodeType,
            withInputSchema,
            withOutputSchema,
        };
    }
    /**
     * Remove a workflow
     */
    unregister(id) {
        const metaDeleted = workflowMetadataManager.delete(id);
        const defDeleted = workflowDefinitionManager.delete(id);
        return metaDeleted || defDeleted;
    }
    /**
     * Clear all workflows for current project
     */
    clear() {
        workflowMetadataManager.clear();
        workflowDefinitionManager.clear();
    }
    /**
     * Clear everything (for testing)
     */
    clearAll() {
        workflowMetadataManager.clearAll();
        workflowDefinitionManager.clearAll();
    }
    getRegistryStats() {
        return workflowMetadataManager.getStats();
    }
}
// Singleton instance - maintains same interface but now project-scoped internally
export const workflowRegistry = new WorkflowRegistryClass();
// Export class for type usage
export { WorkflowRegistryClass };
/**
 * Register a workflow definition globally
 */
export function registerWorkflow(workflow) {
    workflowRegistry.register(workflow);
}
/**
 * Get a workflow by ID
 */
export function getWorkflow(id) {
    return workflowRegistry.get(id);
}
/**
 * Get all registered workflow IDs
 */
export function getAllWorkflowIds() {
    return workflowRegistry.getAllIds();
}
