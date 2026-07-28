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
import { INVALID_ARGUMENT, SECURITY_VIOLATION } from "#veryfront/errors";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";

const logger = baseLogger.component("secure-fs");

export const SECURITY_CONTEXTS = [
  "user-input",
  "static-serving",
  "build",
  "internal",
  "route-discovery",
  "module-loading",
] as const;

export type SecurityContext = (typeof SECURITY_CONTEXTS)[number];

const SECURITY_CONTEXT_SET = new Set<string>(SECURITY_CONTEXTS);

export function isSecurityContext(value: unknown): value is SecurityContext {
  return typeof value === "string" && SECURITY_CONTEXT_SET.has(value);
}

function requireSecurityContext(value: unknown): SecurityContext {
  if (!isSecurityContext(value)) {
    throw INVALID_ARGUMENT.create({
      detail: "SecureFs requires a valid security context",
    });
  }
  return value;
}

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

const VALIDATION_LEVELS = new Set<NonNullable<ValidationOptions["level"]>>([
  "strict",
  "normal",
  "permissive",
]);

function cloneAndFreezeAllowedDirs(
  allowedDirs: string[] | undefined,
): string[] | undefined {
  if (allowedDirs === undefined) return undefined;
  const snapshot = [...allowedDirs];
  Object.freeze(snapshot);
  return snapshot;
}

function normalizeValidationOptions(
  options: Partial<ValidationOptions> | undefined,
): Partial<ValidationOptions> {
  if (options === undefined) return {};
  if (typeof options !== "object" || options === null) {
    throw INVALID_ARGUMENT.create({
      detail: "SecureFs validationOptions must be an object",
    });
  }

  const normalized = { ...options };
  if (
    normalized.level !== undefined &&
    !VALIDATION_LEVELS.has(normalized.level)
  ) {
    throw INVALID_ARGUMENT.create({
      detail: "SecureFs validation level must be strict, normal, or permissive",
    });
  }
  if (
    normalized.allowedDirs !== undefined &&
    (!Array.isArray(normalized.allowedDirs) ||
      !normalized.allowedDirs.every((entry) => typeof entry === "string" && entry.length > 0))
  ) {
    throw INVALID_ARGUMENT.create({
      detail: "SecureFs allowedDirs must contain non-empty strings",
    });
  }
  normalized.allowedDirs = cloneAndFreezeAllowedDirs(normalized.allowedDirs);
  for (
    const key of [
      "followSymlinks",
      "checkExists",
      "allowAbsolute",
    ] as const
  ) {
    if (
      normalized[key] !== undefined &&
      typeof normalized[key] !== "boolean"
    ) {
      throw INVALID_ARGUMENT.create({
        detail: `SecureFs ${key} must be a boolean`,
      });
    }
  }
  return normalized;
}

function normalizeContextOptions(
  options: ContextOptions | undefined,
): ContextOptions {
  if (options === undefined) return {};
  if (typeof options !== "object" || options === null) {
    throw INVALID_ARGUMENT.create({
      detail: "SecureFs contextOptions must be an object",
    });
  }
  if (
    options.allowedImportDirs !== undefined &&
    (!Array.isArray(options.allowedImportDirs) ||
      !options.allowedImportDirs.every((entry) => typeof entry === "string" && entry.length > 0))
  ) {
    throw INVALID_ARGUMENT.create({
      detail: "SecureFs allowedImportDirs must contain non-empty strings",
    });
  }
  return {
    allowedImportDirs: options.allowedImportDirs === undefined
      ? undefined
      : [...options.allowedImportDirs],
  };
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
      return ValidationPresets.internal(baseDir);
  }
}

export class SecureFs {
  private config: Required<SecureFsConfig>;
  private validationOptions: ValidationOptions;

  constructor(config: SecureFsConfig) {
    if (typeof config.baseDir !== "string" || config.baseDir.length === 0) {
      throw INVALID_ARGUMENT.create({
        detail: "SecureFs baseDir must be a non-empty string",
      });
    }
    if (
      typeof config.adapter !== "object" ||
      config.adapter === null ||
      typeof config.adapter.fs !== "object" ||
      config.adapter.fs === null
    ) {
      throw INVALID_ARGUMENT.create({
        detail: "SecureFs requires a runtime adapter with a filesystem",
      });
    }

    const context = requireSecurityContext(
      config.context === undefined ? "internal" : config.context,
    );
    if (
      config.throwOnError !== undefined &&
      typeof config.throwOnError !== "boolean"
    ) {
      throw INVALID_ARGUMENT.create({
        detail: "SecureFs throwOnError must be a boolean",
      });
    }
    if (
      config.onSecurityEvent !== undefined &&
      typeof config.onSecurityEvent !== "function"
    ) {
      throw INVALID_ARGUMENT.create({
        detail: "SecureFs onSecurityEvent must be a function",
      });
    }

    this.config = {
      baseDir: config.baseDir,
      adapter: config.adapter,
      context,
      contextOptions: normalizeContextOptions(config.contextOptions),
      throwOnError: config.throwOnError === undefined ? true : config.throwOnError,
      onSecurityEvent: config.onSecurityEvent ?? (() => {}),
      validationOptions: normalizeValidationOptions(
        config.validationOptions,
      ),
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

    const validationOptions: ValidationOptions = {
      ...contextValidationOptions,
      ...this.config.validationOptions,
      baseDir: this.config.baseDir,
      adapter: this.config.adapter,
    };
    validationOptions.allowedDirs = cloneAndFreezeAllowedDirs(
      validationOptions.allowedDirs,
    );
    return validationOptions;
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
    // Fail closed: an unset NODE_ENV must be treated as production so a missing
    // env var can never silently open this path-validation-bypassing escape
    // hatch. Only an explicit non-production NODE_ENV unlocks it.
    const nodeEnv = getHostEnv("NODE_ENV");
    if (!nodeEnv || nodeEnv === "production") {
      throw SECURITY_VIOLATION.create({
        detail: "getUnsafeAdapter() is not allowed in production",
      });
    }
    logger.warn("Using unsafe adapter - security checks bypassed!");
    return this.config.adapter;
  }

  updateValidationOptions(options: Partial<ValidationOptions>): void {
    const validationOptions: ValidationOptions = {
      ...this.validationOptions,
      ...normalizeValidationOptions(options),
      baseDir: this.config.baseDir,
      adapter: this.config.adapter,
    };
    validationOptions.allowedDirs = cloneAndFreezeAllowedDirs(
      validationOptions.allowedDirs,
    );
    this.validationOptions = validationOptions;
  }

  setContext(context: SecurityContext): void {
    const validatedContext = requireSecurityContext(context);
    this.validationOptions = this.buildValidationOptions(
      validatedContext,
      this.config.contextOptions,
    );
    this.config.context = validatedContext;
  }
}

export { SECURITY_VIOLATION } from "#veryfront/errors";

export function createSecureFs(config: SecureFsConfig): SecureFs {
  return new SecureFs(config);
}

export function wrapAdapterWithSecurity(
  adapter: RuntimeAdapter,
  options: Omit<SecureFsConfig, "adapter">,
): RuntimeAdapter & { secureFs: SecureFs } {
  const secureFs = createSecureFs({ ...options, adapter });

  const wrapped: RuntimeAdapter & { secureFs: SecureFs } = {
    id: adapter.id,
    name: adapter.name,
    capabilities: adapter.capabilities,
    fs: secureFs,
    env: adapter.env,
    server: adapter.server,
    serve: (handler, serveOptions) => adapter.serve(handler, serveOptions),
    secureFs,
  };

  if (adapter.shell !== undefined) wrapped.shell = adapter.shell;
  if (adapter.kv !== undefined) wrapped.kv = adapter.kv;
  if (adapter.watcher !== undefined) wrapped.watcher = adapter.watcher;
  if (adapter.initialize !== undefined) {
    wrapped.initialize = () => adapter.initialize!.call(adapter);
  }
  if (adapter.shutdown !== undefined) {
    wrapped.shutdown = () => adapter.shutdown!.call(adapter);
  }

  return wrapped;
}
