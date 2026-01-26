import { validateNodeId } from "./validation.js";
/** Create a parallel node for concurrent execution of multiple steps. */
export function parallel(id, nodes, options = {}) {
    validateNodeId(id);
    if (nodes.length === 0) {
        throw new Error(`Parallel node "${id}" must have at least one child node`);
    }
    const prefixedNodes = nodes.map((node, index) => {
        if (typeof node.id !== "string" || node.id.length === 0) {
            throw new Error(`Child node at index ${index} in parallel "${id}" has invalid ID`);
        }
        const prefix = `${id}/`;
        const childId = node.id.startsWith(prefix) ? node.id : `${prefix}${node.id}`;
        return { ...node, id: childId };
    });
    const config = {
        type: "parallel",
        nodes: prefixedNodes,
        strategy: options.strategy ?? "all",
        checkpoint: options.checkpoint ?? true,
        retry: options.retry,
        timeout: options.timeout,
        skip: options.skip,
    };
    return { id, config };
}
