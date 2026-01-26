import type { DirEntry, FileInfo, FileWatcher, RuntimeAdapter } from "../platform/adapters/base.js";
import { type ValidationOptions } from "./path-validation.js";
export type SecurityContext = "user-input" | "static-serving" | "build" | "internal" | "route-discovery" | "module-loading";
export interface SecureFsConfig {
    baseDir: string;
    adapter: RuntimeAdapter;
    context?: SecurityContext;
    contextOptions?: ContextOptions;
    validationOptions?: Partial<ValidationOptions>;
    throwOnError?: boolean;
    onSecurityEvent?: (event: SecurityEvent) => void;
}
export interface SecurityEvent {
    type: "validation-failed" | "validation-passed" | "operation-blocked";
    operation: string;
    path: string;
    error?: string;
    code?: string;
    timestamp: Date;
}
export interface ContextOptions {
    allowedImportDirs?: string[];
}
export declare class SecureFs {
    private config;
    private validationOptions;
    constructor(config: SecureFsConfig);
    private emitValidationEvent;
    private throwIfInvalid;
    private validatePathForOperation;
    private validatePathSync;
    private getCanonicalPathOrThrow;
    readFile(path: string): Promise<string>;
    readFileBytes(path: string): Promise<Uint8Array>;
    writeFile(path: string, content: string): Promise<void>;
    stat(path: string): Promise<FileInfo>;
    mkdir(path: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
    remove(path: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
    exists(path: string): Promise<boolean>;
    readDir(path: string): AsyncIterable<DirEntry>;
    makeTempDir(prefix: string): Promise<string>;
    watch(paths: string | string[], options?: {
        recursive?: boolean;
        signal?: AbortSignal;
    }): FileWatcher;
    getUnsafeAdapter(): RuntimeAdapter;
    updateValidationOptions(options: Partial<ValidationOptions>): void;
    setContext(context: SecurityContext): void;
}
export declare class SecurityError extends Error {
    code?: string | undefined;
    path?: string | undefined;
    constructor(message: string, code?: string | undefined, path?: string | undefined);
}
export declare function createSecureFs(config: SecureFsConfig): SecureFs;
export declare function wrapAdapterWithSecurity(adapter: RuntimeAdapter, options: Omit<SecureFsConfig, "adapter">): RuntimeAdapter & {
    secureFs: SecureFs;
};
//# sourceMappingURL=secure-fs.d.ts.map