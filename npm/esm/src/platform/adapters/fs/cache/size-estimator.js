export function estimateSize(value) {
    if (value instanceof Uint8Array)
        return value.length;
    if (typeof value === "string")
        return value.length * 2;
    if (value && typeof value === "object")
        return JSON.stringify(value).length * 2;
    return 8;
}
