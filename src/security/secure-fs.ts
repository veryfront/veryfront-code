import type {
  DirEntry,
  FileInfo,
  FileWatcher,
  RuntimeAdapter,
} from "#veryfront/platform/adapters/base.ts";
import { logger } from "#veryfront/utils";
import {
  sanitizePathForDisplay,
  validatePath,
  validatePathSync,
  type ValidationOptions,
  ValidationPresets,
  type ValidationResult,
} from "./path-validation.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

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

export interface ContextOptions {
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

    const contextValidationOptions = getContextValidationOptions(
      this.config.context,
      this.config.baseDir,
      this.config.contextOptions,
    );

    this.validationOptions = {
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

    throw new SecurityError(
      `Path validation failed for ${operation}: ${result.error}`,
      result.code,
      path,
    );
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

  private validatePathSync(path: string, operation: string): ValidationResult {
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
    throw new SecurityError("Invalid path", validation.code, path);
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
    if (reader) {
      return await reader.call(this.config.adapter.fs, canonicalPath);
    }

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
    const validation = this.validatePathSync(path, "readDir");
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
      throw new SecurityError(
        "No valid paths to watch",
        "NO_VALID_PATHS",
        paths.toString(),
      );
    }

    const pathArg: string | string[] = validatedPaths.length === 1
      ? validatedPaths[0]!
      : validatedPaths;

    return this.config.adapter.fs.watch(pathArg, options);
  }

  getUnsafeAdapter(): RuntimeAdapter {
    logger.warn("[SecureFs] Using unsafe adapter - security checks bypassed!");
    return this.config.adapter;
  }

  updateValidationOptions(options: Partial<ValidationOptions>): void {
    this.validationOptions = { ...this.validationOptions, ...options };
  }

  setContext(context: SecurityContext): void {
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
  constructor(
    message: string,
    public code?: string,
    public path?: string,
  ) {
    super(message);
    this.name = "SecurityError";
  }
}

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
