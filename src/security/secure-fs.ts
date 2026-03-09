import type {
  DirEntry,
  FileInfo,
  FileWatcher,
  RuntimeAdapter,
} from "#veryfront/platform/adapters/base.ts";
import { logger as baseLogger } from "#veryfront/utils";
import {
  sanitizePathForDisplay,
  validatePath,
  validatePathSync,
  type ValidationOptions,
  ValidationPresets,
  type ValidationResult,
} from "./path-validation.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SECURITY_VIOLATION } from "#veryfront/errors/error-registry.ts";

const logger = baseLogger.component("secure-fs");

export type SecurityContext =
  | "user-input"
  | "static-serving"
  | "build"
  | "internal"
  | "route-discovery"
  | "module-loading";

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

interface ContextOptions {
  allowedImportDirs?: string[];
}

function getContextValidationOptions(
  context: SecurityContext,
  baseDir: string,
  options?: ContextOptions,
): ValidationOptions {
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
  private config: Required<SecureFsConfig>;
  private validationOptions: ValidationOptions;

  constructor(config: SecureFsConfig) {
    this.config = {
      context: "internal",
      contextOptions: {},
      throwOnError: true,
      onSecurityEvent: () => {},
      validationOptions: {},
      ...config,
    };

    this.validationOptions = this.buildValidationOptions(
      this.config.context,
      this.config.contextOptions,
    );
  }

  private buildValidationOptions(
    context: SecurityContext,
    contextOptions?: ContextOptions,
  ): ValidationOptions {
    const contextValidationOptions = getContextValidationOptions(
      context,
      this.config.baseDir,
      contextOptions,
    );

    return {
      ...contextValidationOptions,
      ...this.config.validationOptions,
      baseDir: this.config.baseDir,
      adapter: this.config.adapter,
    };
  }

  private emitValidationEvent(
    result: ValidationResult,
    operation: string,
    path: string,
  ): void {
    this.config.onSecurityEvent({
      type: result.valid ? "validation-passed" : "validation-failed",
      operation,
      path: sanitizePathForDisplay(path, this.config.baseDir),
      error: result.error,
      code: result.code,
      timestamp: new Date(),
    });
  }

  private throwIfInvalid(
    result: ValidationResult,
    operation: string,
    path: string,
  ): void {
    if (result.valid || !this.config.throwOnError) return;

    throw SECURITY_VIOLATION.create({
      detail: `Path validation failed for ${operation}: ${result.error}`,
      context: { code: result.code, path },
    });
  }

  private async validatePathForOperation(
    path: string,
    operation: string,
  ): Promise<ValidationResult> {
    const result = await validatePath(path, this.validationOptions);
    this.emitValidationEvent(result, operation, path);
    this.throwIfInvalid(result, operation, path);
    return result;
  }

  private validatePathForOperationSync(
    path: string,
    operation: string,
  ): ValidationResult {
    const result = validatePathSync(path, this.validationOptions);
    this.emitValidationEvent(result, operation, path);
    this.throwIfInvalid(result, operation, path);
    return result;
  }

  private getCanonicalPathOrThrow(
    validation: ValidationResult,
    path: string,
  ): string {
    if (validation.valid && validation.canonicalPath) return validation.canonicalPath;
    throw SECURITY_VIOLATION.create({
      detail: "Invalid path",
      context: { code: validation.code, path },
    });
  }

  readFile(path: string): Promise<string> {
    return withSpan(
      "security.secureFs.readFile",
      async () => {
        const validation = await this.validatePathForOperation(path, "readFile");
        const canonicalPath = this.getCanonicalPathOrThrow(validation, path);
        return await this.config.adapter.fs.readFile(canonicalPath);
      },
      { "fs.path": path, "security.context": this.config.context },
    );
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    const validation = await this.validatePathForOperation(path, "readFileBytes");
    const canonicalPath = this.getCanonicalPathOrThrow(validation, path);

    const reader = this.config.adapter.fs.readFileBytes;
    if (reader) return await reader.call(this.config.adapter.fs, canonicalPath);

    const content = await this.config.adapter.fs.readFile(canonicalPath);
    return new TextEncoder().encode(content);
  }

  async writeFile(path: string, content: string): Promise<void> {
    const validation = await this.validatePathForOperation(path, "writeFile");
    const canonicalPath = this.getCanonicalPathOrThrow(validation, path);
    await this.config.adapter.fs.writeFile(canonicalPath, content);
  }

  stat(path: string): Promise<FileInfo> {
    return withSpan(
      "security.secureFs.stat",
      async () => {
        const validation = await this.validatePathForOperation(path, "stat");
        const canonicalPath = this.getCanonicalPathOrThrow(validation, path);
        return await this.config.adapter.fs.stat(canonicalPath);
      },
      { "fs.path": path, "security.context": this.config.context },
    );
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const validation = await this.validatePathForOperation(path, "mkdir");
    const canonicalPath = this.getCanonicalPathOrThrow(validation, path);
    await this.config.adapter.fs.mkdir(canonicalPath, options);
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    const validation = await this.validatePathForOperation(path, "remove");
    const canonicalPath = this.getCanonicalPathOrThrow(validation, path);
    await this.config.adapter.fs.remove(canonicalPath, options);
  }

  async exists(path: string): Promise<boolean> {
    const validation = await this.validatePathForOperation(path, "exists");
    if (!validation.valid || !validation.canonicalPath) return false;
    return await this.config.adapter.fs.exists(validation.canonicalPath);
  }

  readDir(path: string): AsyncIterable<DirEntry> {
    const validation = this.validatePathForOperationSync(path, "readDir");
    const canonicalPath = this.getCanonicalPathOrThrow(validation, path);
    return this.config.adapter.fs.readDir(canonicalPath);
  }

  async makeTempDir(prefix: string): Promise<string> {
    return await this.config.adapter.fs.makeTempDir(prefix);
  }

  watch(
    paths: string | string[],
    options?: { recursive?: boolean; signal?: AbortSignal },
  ): FileWatcher {
    const pathArray = Array.isArray(paths) ? paths : [paths];
    const validatedPaths: string[] = [];

    for (const path of pathArray) {
      const validation = this.validatePathForOperationSync(path, "watch");
      if (validation.valid && validation.canonicalPath) {
        validatedPaths.push(validation.canonicalPath);
      }
    }

    if (validatedPaths.length === 0) {
      if (this.config.throwOnError) {
        throw SECURITY_VIOLATION.create({
          detail: "No valid paths to watch",
          context: { code: "NO_VALID_PATHS", path: paths.toString() },
        });
      }

      return this.config.adapter.fs.watch([], options);
    }

    const pathArg: string | string[] = validatedPaths.length === 1
      ? validatedPaths[0] ?? ""
      : validatedPaths;

    return this.config.adapter.fs.watch(pathArg, options);
  }

  getUnsafeAdapter(): RuntimeAdapter {
    if (typeof Deno !== "undefined" && Deno.env.get("NODE_ENV") === "production") {
      throw SECURITY_VIOLATION.create({
        detail: "getUnsafeAdapter() is not allowed in production",
      });
    }
    logger.warn("Using unsafe adapter - security checks bypassed!");
    return this.config.adapter;
  }

  updateValidationOptions(options: Partial<ValidationOptions>): void {
    this.validationOptions = { ...this.validationOptions, ...options };
  }

  setContext(context: SecurityContext): void {
    this.validationOptions = this.buildValidationOptions(context);
    this.config.context = context;
  }
}

export { SECURITY_VIOLATION } from "#veryfront/errors/error-registry.ts";

export function createSecureFs(config: SecureFsConfig): SecureFs {
  return new SecureFs(config);
}

export function wrapAdapterWithSecurity(
  adapter: RuntimeAdapter,
  options: Omit<SecureFsConfig, "adapter">,
): RuntimeAdapter & { secureFs: SecureFs } {
  const secureFs = createSecureFs({ ...options, adapter });

  return {
    ...adapter,
    fs: secureFs,
    secureFs,
  };
}
