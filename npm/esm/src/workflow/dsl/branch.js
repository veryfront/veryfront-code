import { validateNodeId } from "./validation.js";
function prefixNodes(id, branch, nodes) {
    const prefix = `${id}/${branch}/`;
    return nodes.map((node) => ({
        ...node,
        id: node.id.startsWith(prefix) ? node.id : `${prefix}${node.id}`,
    }));
}
/** Create a conditional branch node. */
export function branch(id, options) {
    validateNodeId(id);
    if (!options.condition) {
        throw new Error(`Branch "${id}" must specify a condition`);
    }
    if (!options.then?.length) {
        throw new Error(`Branch "${id}" must have at least one 'then' node`);
    }
    const config = {
        type: "branch",
        condition: options.condition,
        then: prefixNodes(id, "then", options.then),
        else: options.else ? prefixNodes(id, "else", options.else) : undefined,
        checkpoint: options.checkpoint ?? false,
        retry: options.retry,
        timeout: options.timeout,
        skip: options.skip,
    };
    return { id, config };
}
/** Create a branch that only executes if condition is true (no else). */
export function when(id, condition, nodes) {
    return branch(id, { condition, then: nodes });
}
/** Create a branch that only executes if condition is false. */
export function unless(id, condition, nodes) {
    return branch(id, {
        condition: async (ctx) => !(await condition(ctx)),
        then: nodes,
    });
}
