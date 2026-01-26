import * as dntShim from "../../../../_dnt.shims.js";
import { hasNodePath, isDeno, nodePath } from "./runtime.js";
function useNodePath() {
    return !isDeno && hasNodePath;
}
export function resolve(...paths) {
    if (useNodePath()) {
        return nodePath.resolve(...paths);
    }
    let resolvedPath = dntShim.dntGlobalThis.Deno?.cwd() ?? "/";
    for (const path of paths) {
        if (!path)
            continue;
        resolvedPath = path.startsWith("/") ? path : `${resolvedPath}/${path}`;
    }
    const parts = resolvedPath.split("/").filter(Boolean);
    const resolved = [];
    for (const part of parts) {
        if (part === "..") {
            resolved.pop();
            continue;
        }
        if (part !== ".")
            resolved.push(part);
    }
    return `/${resolved.join("/")}`;
}
export function isAbsolute(path) {
    if (useNodePath()) {
        return nodePath.isAbsolute(path);
    }
    return path.startsWith("/");
}
export function relative(from, to) {
    if (useNodePath()) {
        return nodePath.relative(from, to);
    }
    const fromParts = resolve(from).split("/").filter(Boolean);
    const toParts = resolve(to).split("/").filter(Boolean);
    let common = 0;
    for (let i = 0; i < Math.min(fromParts.length, toParts.length); i++) {
        if (fromParts[i] !== toParts[i])
            break;
        common++;
    }
    const ups = fromParts.length - common;
    const result = [...Array(ups).fill(".."), ...toParts.slice(common)];
    return result.join("/") || ".";
}
export function normalize(path) {
    if (useNodePath()) {
        return nodePath.normalize(path);
    }
    if (path === "")
        return ".";
    const isAbs = isAbsolute(path);
    const parts = path.split("/").filter((p) => p && p !== ".");
    const normalized = [];
    for (const part of parts) {
        if (part === "..") {
            const last = normalized[normalized.length - 1];
            if (normalized.length > 0 && last !== "..") {
                normalized.pop();
            }
            else if (!isAbs) {
                normalized.push("..");
            }
            continue;
        }
        normalized.push(part);
    }
    const result = normalized.join("/");
    if (isAbs)
        return result ? `/${result}` : "/";
    return result || ".";
}
