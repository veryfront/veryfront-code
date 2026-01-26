import { validateNodeId } from "./validation.js";
export function map(id, options) {
    validateNodeId(id);
    if (!options.items) {
        throw new Error(`Map node "${id}" must have 'items' configured`);
    }
    if (!options.processor) {
        throw new Error(`Map node "${id}" must have a 'processor' configured`);
    }
    const config = {
        type: "map",
        items: options.items,
        processor: options.processor,
        concurrency: options.concurrency,
        checkpoint: options.checkpoint ?? true,
        retry: options.retry,
        timeout: options.timeout,
        skip: options.skip,
    };
    return { id, config };
}
