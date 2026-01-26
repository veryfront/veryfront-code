export { hasBunRuntime, hasDenoRuntime, hasNodeProcess } from "../utils/index.js";
export function hasReactDOM(global) {
    if (typeof global !== "object" || global === null)
        return false;
    if (!("ReactDOM" in global))
        return false;
    return typeof global.ReactDOM !== "undefined";
}
export function hasVeryFrontCache(global) {
    if (typeof global !== "object" || global === null)
        return false;
    return "__VF_CACHE_NAMESPACE__" in global;
}
