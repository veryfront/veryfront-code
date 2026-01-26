import { serverLogger as logger } from "../../../utils/index.js";
/**
 * Filters props for client components, removing children and non-serializable values.
 */
export function serializeProps(props) {
    const serializable = {};
    for (const [key, value] of Object.entries(props)) {
        if (key === "children")
            continue;
        if (!isSerializable(value)) {
            logger.warn(`[RSC] Skipping non-serializable prop: ${key}`);
            continue;
        }
        serializable[key] = value;
    }
    return serializable;
}
/**
 * Stringify props with safe handling of circular references.
 */
export function stringifyProps(props) {
    const seen = new WeakSet();
    return JSON.stringify(props, (_key, value) => {
        if (value === null || typeof value !== "object")
            return value;
        if (seen.has(value))
            return undefined;
        seen.add(value);
        return value;
    });
}
/**
 * Check if a value is JSON-serializable.
 */
function isSerializable(value, seen = new WeakSet()) {
    if (value == null)
        return true;
    const type = typeof value;
    if (type === "string" || type === "number" || type === "boolean")
        return true;
    if (type === "function" || type === "symbol" || type === "bigint")
        return false;
    if (type !== "object")
        return false;
    const obj = value;
    if (seen.has(obj))
        return false;
    seen.add(obj);
    if (Array.isArray(value)) {
        return value.every((item) => isSerializable(item, seen));
    }
    try {
        for (const v of Object.values(value)) {
            if (!isSerializable(v, seen))
                return false;
        }
        return true;
    }
    catch {
        return false;
    }
}
