import { isBun, isCloudflare, isDeno, isNode } from "../compat/runtime.js";
export function detectRuntime() {
    if (isDeno)
        return "deno";
    if (isBun)
        return "bun";
    if (isNode)
        return "node";
    if (isCloudflare)
        return "cloudflare";
    return "unknown";
}
