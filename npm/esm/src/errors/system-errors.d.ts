import { ErrorCode, VeryfrontError } from "./types.js";
declare class SystemError extends VeryfrontError {
    constructor(name: string, message: string, code: ErrorCode, context?: unknown);
}
export declare class FileSystemError extends SystemError {
    constructor(message: string, context?: unknown);
}
export declare class ConfigError extends SystemError {
    constructor(message: string, context?: unknown);
}
export declare class NetworkError extends SystemError {
    constructor(message: string, context?: unknown);
}
export declare class PermissionError extends SystemError {
    constructor(message: string, context?: unknown);
}
export declare class NotSupportedError extends SystemError {
    constructor(message: string, context?: unknown);
}
export {};
//# sourceMappingURL=system-errors.d.ts.map