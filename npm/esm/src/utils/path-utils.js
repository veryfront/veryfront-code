import { logger } from "./logger/logger.js";
export function normalizePath(pathname) {
    let normalized = pathname.replace(/\\+/g, "/").replace(/\/\.+\//g, "/");
    if (normalized !== "/" && normalized.endsWith("/")) {
        normalized = normalized.slice(0, -1);
    }
    return normalized;
}
export function joinPath(a, b) {
    return `${a.replace(/\/$/, "")}/${b.replace(/^\//, "")}`;
}
export function isWithinDirectory(root, target) {
    const normalizedRoot = normalizePath(root);
    const normalizedTarget = normalizePath(target);
    return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
}
export function getExtension(path) {
    const lastDot = path.lastIndexOf(".");
    if (lastDot === -1 || lastDot === path.length - 1)
        return "";
    return path.slice(lastDot);
}
export function getDirectory(path) {
    const normalized = normalizePath(path);
    const lastSlash = normalized.lastIndexOf("/");
    if (lastSlash <= 0)
        return "/";
    return normalized.slice(0, lastSlash);
}
export function hasHashedFilename(path) {
    return /\.[a-f0-9]{8,}\./.test(path);
}
const EXTENSION_TO_LOADER = {
    ".tsx": "tsx",
    ".jsx": "jsx",
    ".ts": "ts",
};
/**
 * Get esbuild loader type from file extension
 */
export function getEsbuildLoader(filePath) {
    const ext = getExtension(filePath).toLowerCase();
    return EXTENSION_TO_LOADER[ext] ?? "js";
}
export function isAbsolutePath(path) {
    return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}
export function toBase64Url(s) {
    return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function getBase64Padding(length) {
    switch (length % 4) {
        case 2:
            return "==";
        case 3:
            return "=";
        default:
            return "";
    }
}
export function fromBase64Url(encoded) {
    const b64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
    try {
        return atob(b64 + getBase64Padding(b64.length));
    }
    catch (error) {
        logger.debug(`Failed to decode base64url string "${encoded}":`, error);
        return "";
    }
}
