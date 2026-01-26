/**
 * Path Validation Rules
 * @module security/path-validation/rules
 */
import { FORBIDDEN_PATH_PATTERNS, MAX_PATH_LENGTH, MAX_PATH_TRAVERSAL_DEPTH, } from "../../utils/index.js";
import { normalizeSeparators } from "./normalization.js";
import { PathValidationError } from "./types.js";
/**
 * Validate path for security issues (basic checks)
 */
export function validatePathBasics(path) {
    // deno-lint-ignore no-control-regex
    if (path.includes("\0") || /\x00/.test(path)) {
        return {
            valid: false,
            error: "Path contains null bytes",
            code: PathValidationError.NULL_BYTE,
        };
    }
    if (path.length > MAX_PATH_LENGTH) {
        return {
            valid: false,
            error: `Path exceeds maximum length of ${MAX_PATH_LENGTH}`,
            code: PathValidationError.PATH_TOO_LONG,
        };
    }
    const forbiddenPattern = FORBIDDEN_PATH_PATTERNS.find((pattern) => pattern.test(path));
    if (forbiddenPattern) {
        return {
            valid: false,
            error: `Path contains forbidden pattern: ${forbiddenPattern}`,
            code: PathValidationError.FORBIDDEN_PATTERN,
        };
    }
    const parts = normalizeSeparators(path).split("/");
    let depth = 0;
    let maxDepth = 0;
    for (const part of parts) {
        if (part === "..") {
            depth++;
            if (depth > maxDepth)
                maxDepth = depth;
            continue;
        }
        if (part !== "." && part !== "")
            depth = 0;
    }
    if (maxDepth > MAX_PATH_TRAVERSAL_DEPTH) {
        return {
            valid: false,
            error: `Path has excessive traversal depth (${maxDepth} > ${MAX_PATH_TRAVERSAL_DEPTH})`,
            code: PathValidationError.EXCESSIVE_TRAVERSAL,
        };
    }
    return { valid: true };
}
