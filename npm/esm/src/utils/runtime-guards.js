function isObject(value) {
    return typeof value === "object" && value !== null;
}
export function hasDenoRuntime(global) {
    if (!isObject(global) || !("Deno" in global))
        return false;
    return typeof global.Deno?.env?.get === "function";
}
export function hasNodeProcess(global) {
    if (!isObject(global) || !("process" in global))
        return false;
    return typeof global.process?.env === "object";
}
export function hasBunRuntime(global) {
    if (!isObject(global) || !("Bun" in global))
        return false;
    return global.Bun !== undefined;
}
