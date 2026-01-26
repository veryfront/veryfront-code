import { FORBIDDEN_PATH_PATTERNS, MAX_PATH_LENGTH, MAX_PATH_TRAVERSAL_DEPTH, } from "../../../utils/index.js";
export function validatePathSecurity(path) {
    if (path == null || path.length > MAX_PATH_LENGTH)
        return false;
    for (const pattern of FORBIDDEN_PATH_PATTERNS) {
        if (pattern.test(path))
            return false;
    }
    const parts = path.split(/[\/\\]/);
    let depth = 0;
    for (const part of parts) {
        if (part === "..") {
            depth++;
        }
        else if (part !== "." && part !== "") {
            depth = 0;
        }
        if (depth > MAX_PATH_TRAVERSAL_DEPTH)
            return false;
    }
    return true;
}
