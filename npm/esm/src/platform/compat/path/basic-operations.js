import { hasNodePath, isDeno, nodePath } from "./runtime.js";
function useNodePath() {
    return !isDeno && hasNodePath;
}
export function join(...paths) {
    if (useNodePath())
        return nodePath.join(...paths);
    const joined = paths
        .filter((p) => p.length > 0)
        .join("/")
        .replace(/\/+/g, "/")
        .replace(/\/$/, "");
    return joined || "/";
}
export function dirname(path) {
    if (useNodePath())
        return nodePath.dirname(path);
    const lastSlash = path.lastIndexOf("/");
    if (lastSlash === -1)
        return ".";
    if (lastSlash === 0)
        return "/";
    return path.slice(0, lastSlash);
}
export function basename(path, ext) {
    if (useNodePath()) {
        // Only pass ext if defined - Bun is strict about this parameter
        return ext !== undefined ? nodePath.basename(path, ext) : nodePath.basename(path);
    }
    let normalizedPath = path;
    while (normalizedPath.length > 1 && normalizedPath.endsWith("/")) {
        normalizedPath = normalizedPath.slice(0, -1);
    }
    const lastSlash = normalizedPath.lastIndexOf("/");
    let base = lastSlash === -1 ? normalizedPath : normalizedPath.slice(lastSlash + 1);
    if (ext && base.endsWith(ext))
        base = base.slice(0, -ext.length);
    return base;
}
export function extname(path) {
    if (useNodePath())
        return nodePath.extname(path);
    const base = basename(path);
    const lastDot = base.lastIndexOf(".");
    if (lastDot <= 0)
        return "";
    return base.slice(lastDot);
}
