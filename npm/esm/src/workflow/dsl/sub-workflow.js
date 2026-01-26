import { validateNodeId } from "./validation.js";
/** Create a sub-workflow node for nested execution. */
export function subWorkflow(id, options) {
    validateNodeId(id);
    if (!options.workflow) {
        throw new Error(`SubWorkflow node "${id}" must have a 'workflow' configured`);
    }
    const config = {
        type: "subWorkflow",
        workflow: options.workflow,
        checkpoint: options.checkpoint,
        retry: options.retry,
        timeout: options.timeout,
        skip: options.skip,
        input: options.input,
        output: options.output,
    };
    return { id, config };
}
