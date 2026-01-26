import * as dntShim from "../../../_dnt.shims.js";
import { SSR_TIMEOUT_MS } from "../../config/defaults.js";
import { rendererLogger as logger } from "../../utils/index.js";
export class TimeoutError extends Error {
    constructor(label, timeoutMs) {
        super(`${label} timed out after ${timeoutMs}ms`);
        this.name = "TimeoutError";
    }
}
export async function withTimeout(promise, timeoutMs, label) {
    let timeoutId;
    const timeoutPromise = new Promise((resolve) => {
        timeoutId = dntShim.setTimeout(() => {
            logger.warn("TIMEOUT_SOFT operation timed out (returning undefined)", {
                label,
                timeoutMs,
            });
            resolve(undefined);
        }, timeoutMs);
    });
    try {
        return await Promise.race([promise, timeoutPromise]);
    }
    finally {
        if (timeoutId)
            clearTimeout(timeoutId);
    }
}
export async function withTimeoutThrow(promise, timeoutMs, label) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = dntShim.setTimeout(() => {
            logger.error("TIMEOUT_HARD operation timed out (throwing)", { label, timeoutMs });
            reject(new TimeoutError(label, timeoutMs));
        }, timeoutMs);
    });
    try {
        return await Promise.race([promise, timeoutPromise]);
    }
    finally {
        if (timeoutId)
            clearTimeout(timeoutId);
    }
}
export class StreamTimeoutError extends Error {
    partialContent;
    constructor(timeoutMs, partialContent) {
        super(`Stream read timed out after ${timeoutMs}ms`);
        this.name = "StreamTimeoutError";
        this.partialContent = partialContent;
    }
}
function concatUint8Arrays(chunks, totalLength) {
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result;
}
export async function streamToString(stream, timeoutMs = SSR_TIMEOUT_MS) {
    const reader = stream.getReader();
    const binaryChunks = [];
    let totalBytes = 0;
    let timedOut = false;
    const timeoutId = dntShim.setTimeout(() => {
        timedOut = true;
        reader.cancel("Stream read timeout").catch(() => { });
    }, timeoutMs);
    const throwTimeout = () => {
        const partial = new TextDecoder().decode(concatUint8Arrays(binaryChunks, totalBytes));
        logger.error("STREAM_TIMEOUT stream read timed out", {
            timeoutMs,
            partialLength: partial.length,
        });
        throw new StreamTimeoutError(timeoutMs, partial);
    };
    try {
        while (true) {
            if (timedOut)
                throwTimeout();
            const { done, value } = await reader.read();
            if (timedOut)
                throwTimeout();
            if (done)
                break;
            if (value) {
                binaryChunks.push(value);
                totalBytes += value.byteLength;
            }
        }
        return new TextDecoder().decode(concatUint8Arrays(binaryChunks, totalBytes));
    }
    finally {
        clearTimeout(timeoutId);
        try {
            reader.releaseLock();
        }
        catch {
            // Ignore if already released
        }
    }
}
