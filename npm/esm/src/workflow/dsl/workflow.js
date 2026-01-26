/**************************
 * Workflow DSL Builder
 *
 * Main factory function for creating durable workflows
 **************************/
import { workflowRegistry } from "../registry.js";
export function workflow(options) {
    if (!options.id) {
        throw new Error("Workflow must have an 'id'");
    }
    if (!options.steps) {
        throw new Error(`Workflow "${options.id}" must have 'steps'`);
    }
    const definition = {
        id: options.id,
        description: options.description,
        version: options.version,
        inputSchema: options.inputSchema,
        outputSchema: options.outputSchema,
        retry: options.retry,
        timeout: options.timeout,
        introspect: options.introspect,
        steps: options.steps,
        onError: options.onError,
        onComplete: options.onComplete,
    };
    const wf = {
        definition,
        id: options.id,
        version: options.version,
    };
    // Auto-register for discovery in dev tools
    // Use type assertion since registry only stores metadata, not the full generic type
    workflowRegistry.register(wf);
    return wf;
}
export function sequence(...nodes) {
    return nodes.map((node, index) => {
        if (index === 0)
            return node;
        return {
            ...node,
            dependsOn: [nodes[index - 1].id],
        };
    });
}
export function dag(nodes) {
    const result = [];
    const seenIds = new Set();
    for (const [id, value] of Object.entries(nodes)) {
        const isWithDeps = "node" in value && "dependsOn" in value;
        const baseNode = isWithDeps ? value.node : value;
        const nodeId = baseNode.id || id;
        const node = isWithDeps
            ? { ...baseNode, id: nodeId, dependsOn: value.dependsOn }
            : { ...baseNode, id: nodeId };
        if (seenIds.has(nodeId)) {
            throw new Error(`Duplicate node ID detected in dag: "${nodeId}"`);
        }
        seenIds.add(nodeId);
        result.push(node);
    }
    return result;
}
export function dependsOn(node, ...dependencies) {
    return {
        ...node,
        dependsOn: [...(node.dependsOn ?? []), ...dependencies],
    };
}
