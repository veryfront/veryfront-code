/**
 * Path Validation Types
 * @module security/path-validation/types
 */
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
export type ValidationLevel = "strict" | "normal" | "permissive";
export interface ValidationResult {
    valid: boolean;
    canonicalPath?: string;
    error?: string;
    code?: string;
}
export interface ValidationOptions {
    level?: ValidationLevel;
    baseDir: string;
    allowedDirs?: string[];
    followSymlinks?: boolean;
    checkExists?: boolean;
    adapter?: RuntimeAdapter;
    allowAbsolute?: boolean;
}
export declare const PathValidationError: {
    readonly NULL_BYTE: "NULL_BYTE";
    readonly PATH_TOO_LONG: "PATH_TOO_LONG";
    readonly EXCESSIVE_TRAVERSAL: "EXCESSIVE_TRAVERSAL";
    readonly FORBIDDEN_PATTERN: "FORBIDDEN_PATTERN";
    readonly OUTSIDE_BASE: "OUTSIDE_BASE";
    readonly NOT_IN_ALLOWLIST: "NOT_IN_ALLOWLIST";
    readonly FILE_NOT_FOUND: "FILE_NOT_FOUND";
    readonly SYMLINK_DETECTED: "SYMLINK_DETECTED";
    readonly INVALID_PATH: "INVALID_PATH";
    readonly ABSOLUTE_PATH_DENIED: "ABSOLUTE_PATH_DENIED";
};
//# sourceMappingURL=types.d.ts.map