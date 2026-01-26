/**
 * Platform detection utilities
 */
import { isDeno } from "../platform/compat/runtime.js";
import { execPath } from "../platform/compat/process.js";
/**
 * Detect if the code is running in a compiled Deno binary
 * @returns true if running in a compiled binary, false otherwise
 */
export function isCompiledBinary() {
    if (!isDeno)
        return false;
    try {
        return execPath().includes("veryfront");
    }
    catch {
        return false;
    }
}
