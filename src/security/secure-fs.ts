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
import { SECURITY_VIOLATION } from "#veryfront/errors";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import {
  captureByteReadCapabilities,
  type CapturedByteReaders,
  type CapturedWholeFileReader,
  captureExclusiveCreateCapability,
  captureStaticReadCapabilities,
} from "#veryfront/platform/adapters/file-system-capabilities.ts";
import { FileSnapshotChangedError } from "#veryfront/platform/adapters/file-snapshot-error.ts";
import { resolve } from "#veryfront/platform/compat/path/index.ts";

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

function snapshotContextOptions(options?: ContextOptions): ContextOptions {
  return {
    allowedImportDirs: options?.allowedImportDirs === undefined
      ? undefined
      : [...options.allowedImportDirs],
  };
}

function snapshotValidationOptions(
  options?: Partial<ValidationOptions>,
): Partial<ValidationOptions> {
  if (options === undefined) return {};
  return {
    ...options,
    allowedDirs: options.allowedDirs === undefined ? undefined : [...options.allowedDirs],
  };
}

type FileSystemMethod = (...args: never[]) => unknown;

function captureFileSystemMethod(
  fileSystem: object,
  key: string,
  required = false,
): FileSystemMethod | undefined {
  const seen = new Set<object>();
  let owner: object | null = fileSystem;
  for (let depth = 0; owner !== null && depth < 64; depth++) {
    if (owner === Object.prototype) break;
    if (seen.has(owner)) throw new TypeError(`SecureFs ${key} has an invalid prototype chain`);
    seen.add(owner);
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor !== undefined) {
      if (!("value" in descriptor)) {
        if (!required) return undefined;
        throw new TypeError(`SecureFs filesystem ${key} must be a data-property method`);
      }
      if (descriptor.value === undefined && !required) return undefined;
      if (typeof descriptor.value !== "function") {
        if (!required) return undefined;
        throw new TypeError(`SecureFs filesystem ${key} must be a function`);
      }
      return descriptor.value as FileSystemMethod;
    }
    owner = Object.getPrototypeOf(owner);
  }
  if (owner !== null && owner !== Object.prototype) {
    throw new TypeError("SecureFs filesystem prototype chain is too deep");
  }
  if (required) throw new TypeError(`SecureFs filesystem must provide ${key}`);
  return undefined;
}

function snapshotFileSystemAuthority(fileSystem: RuntimeAdapter["fs"]): RuntimeAdapter["fs"] {
  const required = (key: string) => captureFileSystemMethod(fileSystem, key, true)!;
  const optional = (key: string) => captureFileSystemMethod(fileSystem, key);
  const readFile = required("readFile");
  const writeFile = required("writeFile");
  const exists = required("exists");
  const readDir = required("readDir");
  const stat = required("stat");
  const mkdir = required("mkdir");
  const remove = required("remove");
  const makeTempDir = required("makeTempDir");
  const watch = required("watch");

  const snapshot: RuntimeAdapter["fs"] = {
    readFile: (path) => Reflect.apply(readFile, fileSystem, [path]) as Promise<string>,
    writeFile: (path, content) =>
      Reflect.apply(writeFile, fileSystem, [path, content]) as Promise<void>,
    exists: (path) => Reflect.apply(exists, fileSystem, [path]) as Promise<boolean>,
    readDir: (path) => Reflect.apply(readDir, fileSystem, [path]) as AsyncIterable<DirEntry>,
    stat: (path) => Reflect.apply(stat, fileSystem, [path]) as Promise<FileInfo>,
    mkdir: (path, options) => Reflect.apply(mkdir, fileSystem, [path, options]) as Promise<void>,
    remove: (path, options) => Reflect.apply(remove, fileSystem, [path, options]) as Promise<void>,
    makeTempDir: (prefix) => Reflect.apply(makeTempDir, fileSystem, [prefix]) as Promise<string>,
    watch: (paths, options) => Reflect.apply(watch, fileSystem, [paths, options]) as FileWatcher,
  };

  const semantics = Object.getOwnPropertyDescriptor(fileSystem, "symlinkSemantics");
  if (semantics && "value" in semantics && semantics.value === "none") {
    Object.defineProperty(snapshot, "symlinkSemantics", { enumerable: true, value: "none" });
  }
  for (
    const key of [
      "readFileBytes",
      "readFileBytesBounded",
      "readFileBytesWithinLimit",
      "readFileSnapshotWithinLimit",
      "writeFileBytes",
      "createFileBytesExclusive",
      "rename",
      "lstat",
      "realPath",
      "resolveFile",
      "refreshSourceSnapshot",
      "ensureSourceSnapshotFresh",
      "getSourceSnapshotVersion",
    ] as const
  ) {
    const method = optional(key);
    if (method !== undefined) {
      Object.defineProperty(snapshot, key, {
        enumerable: true,
        value: (...args: unknown[]) => Reflect.apply(method, fileSystem, args),
      });
    }
  }
  const ceiling = Object.getOwnPropertyDescriptor(fileSystem, "maxWholeFileReadBytes");
  if (
    ceiling && "value" in ceiling &&
    Number.isSafeInteger(ceiling.value) && ceiling.value > 0 &&
    snapshot.readFileBytes !== undefined
  ) {
    Object.defineProperty(snapshot, "maxWholeFileReadBytes", {
      enumerable: true,
      value: ceiling.value,
    });
  }
  return Object.freeze(snapshot);
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
  private readonly fileSystem: RuntimeAdapter["fs"];
  private readonly validationAdapter: RuntimeAdapter;
  private readonly unboundedFileReader?: (path: string) => Promise<Uint8Array>;
  private readonly wholeFileReader?: CapturedWholeFileReader;
  readonly maxWholeFileReadBytes?: number;
  readonly readFileBytesBounded?: (path: string, byteLimit: number) => Promise<Uint8Array>;
  readonly readFileBytesWithinLimit?: (path: string, byteLimit: number) => Promise<Uint8Array>;
  readonly readFileSnapshotWithinLimit?: (
    path: string,
    byteLimit: number,
  ) => Promise<Uint8Array>;
  readonly createFileBytesExclusive?: (path: string, content: Uint8Array) => Promise<void>;

  constructor(config: SecureFsConfig) {
    this.config = {
      context: "internal",
      throwOnError: true,
      onSecurityEvent: () => {},
      ...config,
      contextOptions: snapshotContextOptions(config.contextOptions),
      validationOptions: snapshotValidationOptions(config.validationOptions),
    };
    this.fileSystem = snapshotFileSystemAuthority(this.config.adapter.fs);
    this.validationAdapter = Object.freeze({ ...this.config.adapter, fs: this.fileSystem });

    this.validationOptions = this.buildValidationOptions(
      this.config.context,
      this.config.contextOptions,
      this.validationAdapter,
    );

    const staticReaders = captureStaticReadCapabilities(this.fileSystem, "SecureFs filesystem");
    let byteReaders: CapturedByteReaders;
    try {
      byteReaders = captureByteReadCapabilities(this.fileSystem, "SecureFs filesystem");
    } catch (error) {
      if (staticReaders.snapshot === undefined) throw error;
      byteReaders = Object.freeze({}) as CapturedByteReaders;
    }
    this.unboundedFileReader = byteReaders.unbounded;
    if (byteReaders.whole !== undefined) {
      this.wholeFileReader = byteReaders.whole;
      this.maxWholeFileReadBytes = byteReaders.whole.maximumBytes;
    }
    if (byteReaders.prefix !== undefined) {
      this.readFileBytesBounded = async (path, byteLimit) => {
        const canonicalPath = await this.validateReadPath(path, "readFileBytesBounded");
        return byteReaders.prefix!(canonicalPath, byteLimit);
      };
    }
    if (byteReaders.exact !== undefined) {
      this.readFileBytesWithinLimit = async (path, byteLimit) => {
        const canonicalPath = await this.validateReadPath(path, "readFileBytesWithinLimit");
        return byteReaders.exact!(canonicalPath, byteLimit);
      };
    }
    if (staticReaders.snapshot !== undefined) {
      const reader = staticReaders.snapshot;
      const containmentRoot = this.config.baseDir;
      this.readFileSnapshotWithinLimit = async (path, byteLimit) => {
        const canonicalPath = await this.validateReadPath(path, "readFileSnapshotWithinLimit");
        return reader.read(canonicalPath, containmentRoot, byteLimit);
      };
    } else if (staticReaders.virtual !== undefined) {
      const reader = staticReaders.virtual;
      this.readFileSnapshotWithinLimit = async (path, byteLimit) => {
        const canonicalPath = await this.validateReadPath(path, "readFileSnapshotWithinLimit");
        const before = await reader.generation();
        const bytes = reader.exact !== undefined
          ? await reader.exact(canonicalPath, byteLimit)
          : reader.whole !== undefined && reader.whole.maximumBytes <= byteLimit
          ? await reader.whole.read(canonicalPath)
          : (() => {
            throw new TypeError("Virtual snapshot requires an admissible bounded reader");
          })();
        const after = await reader.generation();
        if (before !== after) {
          throw new FileSnapshotChangedError(
            "Virtual file generation changed during snapshot read",
          );
        }
        return bytes;
      };
    }

    let exclusiveCreator;
    try {
      exclusiveCreator = captureExclusiveCreateCapability(
        this.fileSystem,
        "SecureFs filesystem",
      );
    } catch {
      // Exclusive-create authority is independent from read authority. A bad
      // optional publisher is quarantined rather than weakening valid reads.
      exclusiveCreator = undefined;
    }
    if (exclusiveCreator !== undefined) {
      this.createFileBytesExclusive = async (path, content) => {
        const validation = await this.validatePathForOperation(path, "createFileBytesExclusive");
        return exclusiveCreator!.create(this.getCanonicalPathOrThrow(validation, path), content);
      };
    }

    for (
      const key of [
        "maxWholeFileReadBytes",
        "readFileBytesBounded",
        "readFileBytesWithinLimit",
        "readFileSnapshotWithinLimit",
        "createFileBytesExclusive",
      ] as const
    ) {
      Object.defineProperty(this, key, {
        configurable: false,
        enumerable: true,
        value: this[key],
        writable: false,
      });
    }
  }

  private async validateReadPath(path: string, operation: string): Promise<string> {
    const validation = await this.validatePathForOperation(path, operation);
    return this.getCanonicalPathOrThrow(validation, path);
  }

  private buildValidationOptions(
    context: SecurityContext,
    contextOptions?: ContextOptions,
    adapter: RuntimeAdapter = this.validationAdapter,
  ): ValidationOptions {
    const contextValidationOptions = getContextValidationOptions(
      context,
      this.config.baseDir,
      contextOptions,
    );

    const validationOptions = {
      ...contextValidationOptions,
      ...this.config.validationOptions,
      baseDir: this.config.baseDir,
      adapter,
    };
    return {
      ...validationOptions,
      allowedDirs: validationOptions.allowedDirs === undefined
        ? undefined
        : [...validationOptions.allowedDirs],
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
        return await this.fileSystem.readFile(canonicalPath);
      },
      { "fs.path": path, "security.context": this.config.context },
    );
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    const validation = await this.validatePathForOperation(path, "readFileBytes");
    const canonicalPath = this.getCanonicalPathOrThrow(validation, path);

    if (this.wholeFileReader) return await this.wholeFileReader.read(canonicalPath);
    if (this.unboundedFileReader) return await this.unboundedFileReader(canonicalPath);
    throw new TypeError("SecureFs filesystem does not provide binary-safe file reads");
  }

  async writeFile(path: string, content: string): Promise<void> {
    const validation = await this.validatePathForOperation(path, "writeFile");
    const canonicalPath = this.getCanonicalPathOrThrow(validation, path);
    await this.fileSystem.writeFile(canonicalPath, content);
  }

  stat(path: string): Promise<FileInfo> {
    return withSpan(
      "security.secureFs.stat",
      async () => {
        const validation = await this.validatePathForOperation(path, "stat");
        const canonicalPath = this.getCanonicalPathOrThrow(validation, path);
        return await this.fileSystem.stat(canonicalPath);
      },
      { "fs.path": path, "security.context": this.config.context },
    );
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const validation = await this.validatePathForOperation(path, "mkdir");
    const canonicalPath = this.getCanonicalPathOrThrow(validation, path);
    await this.fileSystem.mkdir(canonicalPath, options);
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    const validation = await this.validatePathForOperation(path, "remove");
    const canonicalPath = this.getCanonicalPathOrThrow(validation, path);
    await this.fileSystem.remove(canonicalPath, options);
  }

  async exists(path: string): Promise<boolean> {
    const validation = await this.validatePathForOperation(path, "exists");
    if (!validation.valid || !validation.canonicalPath) return false;
    return await this.fileSystem.exists(validation.canonicalPath);
  }

  readDir(path: string): AsyncIterable<DirEntry> {
    const validation = this.validatePathForOperationSync(path, "readDir");
    const canonicalPath = this.getCanonicalPathOrThrow(validation, path);
    return this.fileSystem.readDir(canonicalPath);
  }

  async makeTempDir(prefix: string): Promise<string> {
    return await this.fileSystem.makeTempDir(prefix);
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

      return this.fileSystem.watch([], options);
    }

    const pathArg: string | string[] = validatedPaths.length === 1
      ? validatedPaths[0] ?? ""
      : validatedPaths;

    return this.fileSystem.watch(pathArg, options);
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
    const update = snapshotValidationOptions(options);
    this.validationOptions = {
      ...this.validationOptions,
      ...update,
      baseDir: this.config.baseDir,
      adapter: this.validationAdapter,
    };
  }

  setContext(context: SecurityContext): void {
    this.validationOptions = this.buildValidationOptions(
      context,
      this.config.contextOptions,
      this.validationAdapter,
    );
    this.config.context = context;
  }
}

export { SECURITY_VIOLATION } from "#veryfront/errors";

export function createSecureFs(config: SecureFsConfig): SecureFs {
  return new SecureFs(config);
}

function createSecuredAdapterFileSystem(
  secureFs: SecureFs,
  constructionRoot: string,
): RuntimeAdapter["fs"] {
  const fileSystem: RuntimeAdapter["fs"] = {
    readFile: (path) => secureFs.readFile(path),
    readFileBytes: (path) => secureFs.readFileBytes(path),
    writeFile: (path, content) => secureFs.writeFile(path, content),
    exists: (path) => secureFs.exists(path),
    readDir: (path) => secureFs.readDir(path),
    stat: (path) => secureFs.stat(path),
    mkdir: (path, options) => secureFs.mkdir(path, options),
    remove: (path, options) => secureFs.remove(path, options),
    makeTempDir: (prefix) => secureFs.makeTempDir(prefix),
    watch: (paths, options) => secureFs.watch(paths, options),
  };
  if (secureFs.maxWholeFileReadBytes !== undefined) {
    Object.defineProperty(fileSystem, "maxWholeFileReadBytes", {
      enumerable: true,
      value: secureFs.maxWholeFileReadBytes,
    });
  }
  if (secureFs.readFileBytesBounded !== undefined) {
    fileSystem.readFileBytesBounded = (path, byteLimit) =>
      secureFs.readFileBytesBounded!(path, byteLimit);
  }
  if (secureFs.readFileBytesWithinLimit !== undefined) {
    fileSystem.readFileBytesWithinLimit = (path, byteLimit) =>
      secureFs.readFileBytesWithinLimit!(path, byteLimit);
  }
  if (secureFs.readFileSnapshotWithinLimit !== undefined) {
    fileSystem.readFileSnapshotWithinLimit = (path, containmentRoot, byteLimit) => {
      if (resolve(containmentRoot) !== constructionRoot) {
        throw new TypeError("Secured snapshot reads require the construction-time root");
      }
      return secureFs.readFileSnapshotWithinLimit!(path, byteLimit);
    };
  }
  if (secureFs.createFileBytesExclusive !== undefined) {
    fileSystem.createFileBytesExclusive = (path, content) =>
      secureFs.createFileBytesExclusive!(path, content);
  }
  return Object.freeze(fileSystem);
}

export function wrapAdapterWithSecurity(
  adapter: RuntimeAdapter,
  options: Omit<SecureFsConfig, "adapter">,
): RuntimeAdapter & { secureFs: SecureFs } {
  const secureFs = createSecureFs({ ...options, adapter });
  const constructionRoot = resolve(options.baseDir);

  return {
    ...adapter,
    fs: createSecuredAdapterFileSystem(secureFs, constructionRoot),
    secureFs,
  };
}
