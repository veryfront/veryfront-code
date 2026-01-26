import { validateNodeId } from "./validation.js";
export function step(id, options) {
    validateNodeId(id);
    const hasAgent = !!options.agent;
    const hasTool = !!options.tool;
    if (!hasAgent && !hasTool) {
        throw new Error(`Step "${id}" must specify either 'agent' or 'tool'`);
    }
    if (hasAgent && hasTool) {
        throw new Error(`Step "${id}" cannot specify both 'agent' and 'tool'`);
    }
    const config = {
        type: "step",
        agent: options.agent,
        tool: options.tool,
        input: options.input,
        checkpoint: options.checkpoint ?? hasAgent,
        retry: options.retry,
        timeout: options.timeout,
        skip: options.skip,
    };
    return { id, config };
}
export function agentStep(id, agent, options) {
    return step(id, { ...options, agent });
}
export function toolStep(id, tool, options) {
    return step(id, { ...options, tool });
}
