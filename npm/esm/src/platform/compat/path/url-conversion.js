import * as dntShim from "../../../../_dnt.shims.js";
import { hasNodePath, isDeno } from "./runtime.js";
import { isAbsolute, resolve } from "./resolution.js";
let _fileURLToPath = null;
function getFileURLToPath() {
    if (_fileURLToPath)
        return _fileURLToPath;
    if (!hasNodePath)
        return null;
    try {
        const nodeUrl = dntShim.dntGlobalThis.require?.("node:url");
        if (nodeUrl?.fileURLToPath) {
            _fileURLToPath = nodeUrl.fileURLToPath;
            return _fileURLToPath;
        }
    }
    catch {
        // Fallback to manual conversion
    }
    return null;
}
export function fromFileUrl(url) {
    const fileURLToPath = getFileURLToPath();
    if (fileURLToPath)
        return fileURLToPath(url);
    const urlString = typeof url === "string" ? url : url.toString();
    if (isDeno) {
        const hasCwd = Boolean(dntShim.Deno.cwd);
        const isWindows = dntShim.dntGlobalThis.Deno?.build?.os === "windows";
        if (hasCwd && isWindows) {
            return decodeURIComponent(urlString.slice(8).replace(/\//g, "\\"));
        }
        return decodeURIComponent(urlString.slice(7));
    }
    if (!urlString.startsWith("file://")) {
        throw new TypeError("Must be a file URL");
    }
    return decodeURIComponent(urlString.slice(7));
}
export function toFileUrl(path) {
    if (hasNodePath)
        return new URL(`file://${path}`);
    const absolute = isAbsolute(path) ? path : resolve(path);
    return new URL(`file://${absolute}`);
}
