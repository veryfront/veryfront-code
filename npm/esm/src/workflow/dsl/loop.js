import { validateNodeId } from "./validation.js";
export function loop(id, options) {
    validateNodeId(id);
    if (typeof options.while !== "function") {
        throw new Error(`Loop "${id}" must have a 'while' condition function`);
    }
    if (!options.steps) {
        throw new Error(`Loop "${id}" must have 'steps' configured`);
    }
    const maxIterations = options.maxIterations ?? 10;
    if (maxIterations < 1) {
        throw new Error(`Loop "${id}" maxIterations must be at least 1`);
    }
    if (maxIterations > 100) {
        throw new Error(`Loop "${id}" maxIterations cannot exceed 100 (got ${maxIterations}). ` +
            `For higher limits, consider restructuring your workflow.`);
    }
    return {
        id,
        config: {
            type: "loop",
            while: options.while,
            steps: options.steps,
            maxIterations,
            onMaxIterations: options.onMaxIterations,
            onComplete: options.onComplete,
            checkpoint: options.checkpoint ?? true,
            retry: options.retry,
            timeout: options.timeout,
            iterationTimeout: options.iterationTimeout,
            skip: options.skip,
            delay: options.delay,
        },
    };
}
export function doWhile(id, options) {
    const { until, ...rest } = options;
    return loop(id, {
        ...rest,
        while: async (ctx, loopCtx) => {
            if (loopCtx.isFirstIteration)
                return true;
            return !(await until(ctx, loopCtx));
        },
    });
}
export function times(id, count, steps, options) {
    return loop(id, {
        ...options,
        maxIterations: count,
        while: (_, loopCtx) => loopCtx.iteration < count,
        steps,
    });
}
