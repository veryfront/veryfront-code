import { endSpan, setSpanAttributes, startSpan } from "../tracing/index.js";
export function instrument(fn, spanName, options) {
    return (async (...args) => {
        const span = createSpan(spanName, args, options);
        const startTime = performance.now();
        try {
            const result = await fn(...args);
            recordDuration(span, startTime);
            endSpan(span);
            return result;
        }
        catch (error) {
            endSpan(span, error);
            throw error;
        }
    });
}
export function instrumentSync(fn, spanName, options) {
    return ((...args) => {
        const span = createSpan(spanName, args, options);
        const startTime = performance.now();
        try {
            const result = fn(...args);
            recordDuration(span, startTime);
            endSpan(span);
            return result;
        }
        catch (error) {
            endSpan(span, error);
            throw error;
        }
    });
}
export async function instrumentBatch(operationName, items, processor, options) {
    const batchSize = options?.batchSize ?? 10;
    const totalBatches = Math.ceil(items.length / batchSize);
    const batchSpan = startSpan(operationName, {
        kind: "internal",
        attributes: {
            "batch.total_items": items.length,
            "batch.size": batchSize,
            "batch.total_batches": totalBatches,
            ...(options?.attributes ?? {}),
        },
    });
    try {
        await processBatches(items, batchSize, totalBatches, processor, operationName);
        endSpan(batchSpan);
    }
    catch (error) {
        endSpan(batchSpan, error);
        throw error;
    }
}
function createSpan(spanName, args, options) {
    const spanOptions = {
        kind: options?.kind ?? "internal",
        attributes: options?.attributes?.(args) ?? {},
    };
    return startSpan(spanName, spanOptions);
}
function recordDuration(span, startTime) {
    const duration = performance.now() - startTime;
    setSpanAttributes(span, { duration_ms: Math.floor(duration) });
}
async function processBatches(items, batchSize, totalBatches, processor, operationName) {
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        await processSingleBatch(items, batchSize, batchIndex, processor, operationName);
    }
}
async function processSingleBatch(items, batchSize, batchIndex, processor, operationName) {
    const start = batchIndex * batchSize;
    const end = Math.min(start + batchSize, items.length);
    const batch = items.slice(start, end);
    const batchItemSpan = startSpan(`${operationName}.batch`, {
        kind: "internal",
        attributes: {
            "batch.index": batchIndex,
            "batch.items": batch.length,
        },
    });
    try {
        await Promise.all(batch.map((item, index) => processor(item, start + index)));
        endSpan(batchItemSpan);
    }
    catch (error) {
        endSpan(batchItemSpan, error);
        throw error;
    }
}
