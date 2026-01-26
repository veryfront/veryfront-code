import { logger } from "../utils/index.js";
import { sanitizePathForDisplay, validatePath, validatePathSync, ValidationPresets, } from "./path-validation.js";
import { withSpan } from "../observability/tracing/otlp-setup.js";
function getContextValidationOptions(context, baseDir, options) {
    switch (context) {
        case "user-input":
            return ValidationPresets.userInput(baseDir);
        case "static-serving":
            return ValidationPresets.static(baseDir);
        case "build":
            return ValidationPresets.build(baseDir);
        case "route-discovery":
            return {
                baseDir,
                level: "normal",
                allowedDirs: ["app", "pages", "routes", "api"],
                followSymlinks: false,
                allowAbsolute: false,
            };
        case "module-loading":
            return {
                baseDir,
                level: "normal",
                allowedDirs: options?.allowedImportDirs ?? [],
                followSymlinks: false,
                allowAbsolute: true,
            };
        case "internal":
        default:
            return ValidationPresets.internal(baseDir);
    }
}
export class SecureFs {
    config;
    validationOptions;
    constructor(config) {
        this.config = {
            context: "internal",
            contextOptions: {},
            throwOnError: true,
            onSecurityEvent: () => { },
            validationOptions: {},
            ...config,
        };
        const contextValidationOptions = getContextValidationOptions(this.config.context, this.config.baseDir, this.config.contextOptions);
        this.validationOptions = {
            ...contextValidationOptions,
            ...this.config.validationOptions,
            baseDir: this.config.baseDir,
            adapter: this.config.adapter,
        };
    }
    emitValidationEvent(result, operation, path) {
        this.config.onSecurityEvent({
            type: result.valid ? "validation-passed" : "validation-failed",
            operation,
            path: sanitizePathForDisplay(path, this.config.baseDir),
            error: result.error,
            code: result.code,
            timestamp: new Date(),
        });
    }
    throwIfInvalid(result, operation, path) {
        if (result.valid || !this.config.throwOnError)
            return;
        throw new SecurityError(`Path validation failed for ${operation}: ${result.error}`, result.code, path);
    }
    async validatePathForOperation(path, operation) {
        const result = await validatePath(path, this.validationOptions);
        this.emitValidationEvent(result, operation, path);
        this.throwIfInvalid(result, operation, path);
        return result;
    }
    validatePathSync(path, operation) {
        const result = validatePathSync(path, this.validationOptions);
        this.emitValidationEvent(result, operation, path);
        this.throwIfInvalid(result, operation, path);
        return result;
    }
    getCanonicalPathOrThrow(validation, path) {
        if (validation.valid && validation.canonicalPath)
            return validation.canonicalPath;
        throw new SecurityError("Invalid path", validation.code, path);
    }
    readFile(path) {
        return withSpan("security.secureFs.readFile", async () => {
            const validation = await this.validatePathForOperation(path, "readFile");
            const canonicalPath = this.getCanonicalPathOrThrow(validation, path);
            return await this.config.adapter.fs.readFile(canonicalPath);
        }, { "fs.path": path, "security.context": this.config.context });
    }
    async readFileBytes(path) {
        const validation = await this.validatePathForOperation(path, "readFileBytes");
        const canonicalPath = this.getCanonicalPathOrThrow(validation, path);
        const reader = this.config.adapter.fs.readFileBytes;
        if (reader) {
            return await reader.call(this.config.adapter.fs, canonicalPath);
        }
        const content = await this.config.adapter.fs.readFile(canonicalPath);
        return new TextEncoder().encode(content);
    }
    async writeFile(path, content) {
        const validation = await this.validatePathForOperation(path, "writeFile");
        const canonicalPath = this.getCanonicalPathOrThrow(validation, path);
        await this.config.adapter.fs.writeFile(canonicalPath, content);
    }
    stat(path) {
        return withSpan("security.secureFs.stat", async () => {
            const validation = await this.validatePathForOperation(path, "stat");
            const canonicalPath = this.getCanonicalPathOrThrow(validation, path);
            return await this.config.adapter.fs.stat(canonicalPath);
        }, { "fs.path": path, "security.context": this.config.context });
    }
    async mkdir(path, options) {
        const validation = await this.validatePathForOperation(path, "mkdir");
        const canonicalPath = this.getCanonicalPathOrThrow(validation, path);
        await this.config.adapter.fs.mkdir(canonicalPath, options);
    }
    async remove(path, options) {
        const validation = await this.validatePathForOperation(path, "remove");
        const canonicalPath = this.getCanonicalPathOrThrow(validation, path);
        await this.config.adapter.fs.remove(canonicalPath, options);
    }
    async exists(path) {
        const validation = await this.validatePathForOperation(path, "exists");
        if (!validation.valid || !validation.canonicalPath)
            return false;
        return await this.config.adapter.fs.exists(validation.canonicalPath);
    }
    readDir(path) {
        const validation = this.validatePathSync(path, "readDir");
        const canonicalPath = this.getCanonicalPathOrThrow(validation, path);
        return this.config.adapter.fs.readDir(canonicalPath);
    }
    async makeTempDir(prefix) {
        return await this.config.adapter.fs.makeTempDir(prefix);
    }
    watch(paths, options) {
        const pathArray = Array.isArray(paths) ? paths : [paths];
        const validatedPaths = [];
        for (const path of pathArray) {
            const validation = this.validatePathSync(path, "watch");
            if (validation.valid && validation.canonicalPath) {
                validatedPaths.push(validation.canonicalPath);
                continue;
            }
            if (this.config.throwOnError) {
                throw new SecurityError("Invalid path", validation.code, path);
            }
        }
        if (validatedPaths.length === 0) {
            throw new SecurityError("No valid paths to watch", "NO_VALID_PATHS", paths.toString());
        }
        const pathArg = validatedPaths.length === 1
            ? validatedPaths[0]
            : validatedPaths;
        return this.config.adapter.fs.watch(pathArg, options);
    }
    getUnsafeAdapter() {
        logger.warn("[SecureFs] Using unsafe adapter - security checks bypassed!");
        return this.config.adapter;
    }
    updateValidationOptions(options) {
        this.validationOptions = { ...this.validationOptions, ...options };
    }
    setContext(context) {
        const contextOptions = getContextValidationOptions(context, this.config.baseDir);
        this.validationOptions = {
            ...contextOptions,
            ...this.config.validationOptions,
            adapter: this.config.adapter,
        };
        this.config.context = context;
    }
}
export class SecurityError extends Error {
    code;
    path;
    constructor(message, code, path) {
        super(message);
        this.code = code;
        this.path = path;
        this.name = "SecurityError";
    }
}
export function createSecureFs(config) {
    return new SecureFs(config);
}
export function wrapAdapterWithSecurity(adapter, options) {
    const secureFs = createSecureFs({ ...options, adapter });
    return {
        ...adapter,
        fs: secureFs,
        secureFs,
    };
}
