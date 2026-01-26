/**************************
 * Veryfront Workflow Types
 *
 * Core type definitions for durable, DAG-based agentic workflows
 **************************/
import * as dntShim from "../../_dnt.shims.js";
/**
 * Parse duration string to milliseconds
 *
 * @throws Error if duration is invalid, zero, or negative
 */
export function parseDuration(duration) {
    if (typeof duration === "number") {
        if (duration < 0)
            throw new Error(`Duration cannot be negative: ${duration}`);
        return duration;
    }
    const match = duration.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/);
    if (!match || !match[1] || !match[2])
        throw new Error(`Invalid duration format: ${duration}`);
    const num = parseFloat(match[1]);
    const unit = match[2];
    if (num <= 0)
        throw new Error(`Duration must be positive: ${duration}`);
    switch (unit) {
        case "ms":
            return num;
        case "s":
            return num * 1000;
        case "m":
            return num * 60 * 1000;
        case "h":
            return num * 60 * 60 * 1000;
        case "d":
            return num * 24 * 60 * 60 * 1000;
        default:
            throw new Error(`Invalid duration unit: ${unit}`);
    }
}
/**
 * Validate retry configuration
 *
 * @throws Error if retry config has invalid values
 */
export function validateRetryConfig(config) {
    const { maxAttempts, initialDelay, maxDelay, backoff } = config;
    if (maxAttempts !== undefined && (!Number.isInteger(maxAttempts) || maxAttempts < 1)) {
        throw new Error(`maxAttempts must be a positive integer, got: ${maxAttempts}`);
    }
    if (initialDelay !== undefined && initialDelay < 0) {
        throw new Error(`initialDelay cannot be negative: ${initialDelay}`);
    }
    if (maxDelay !== undefined && maxDelay < 0) {
        throw new Error(`maxDelay cannot be negative: ${maxDelay}`);
    }
    if (initialDelay !== undefined && maxDelay !== undefined && initialDelay > maxDelay) {
        throw new Error(`initialDelay (${initialDelay}) cannot be greater than maxDelay (${maxDelay})`);
    }
    if (backoff !== undefined) {
        const validBackoffs = new Set([
            "fixed",
            "linear",
            "exponential",
        ]);
        if (!validBackoffs.has(backoff)) {
            throw new Error(`Invalid backoff strategy: ${backoff}. Must be one of: ${[...validBackoffs].join(", ")}`);
        }
    }
}
/**
 * Generate a unique ID for workflow runs, nodes, etc.
 */
export function generateId(prefix = "wf") {
    return `${prefix}_${dntShim.crypto.randomUUID().slice(0, 12)}`;
}
