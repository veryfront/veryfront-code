import type {
  DirEntry,
  FileChangeEvent,
  FileInfo,
  FileWatcher,
  RuntimeAdapter,
} from "#veryfront/platform/adapters/base.ts";
import {
  type PathValidationPolicyOptions,
  sanitizePathForDisplay,
  validatePath,
  type ValidationOptions,
  ValidationPresets,
  type ValidationResult,
} from "./path-validation.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { INVALID_ARGUMENT, NOT_SUPPORTED, SECURITY_VIOLATION } from "#veryfront/errors";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import {
  type CapturedFileSystemCapabilities,
  captureFileSystemCapabilities,
  captureLegacyFileSystemCapabilitiesForSnapshot,
  captureSnapshotReadCapability,
  captureStaticReadCapabilities,
} from "#veryfront/platform/adapters/file-system-capabilities.ts";
import { copyFixedUint8ArrayWithinLimit } from "#veryfront/platform/adapters/bounded-text-reader.ts";
import { FileSnapshotChangedError } from "#veryfront/platform/adapters/file-snapshot-error.ts";
import { isAbsolute, relative, resolve, sep } from "#veryfront/platform/compat/path/index.ts";

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
  validationOptions?: Partial<Omit<PathValidationPolicyOptions, "baseDir">>;
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
  readonly allowedImportDirs?: string[];
}

const VALIDATION_LEVELS = new Set<NonNullable<ValidationOptions["level"]>>([
  "strict",
  "normal",
]);

const SECURE_FS_CONFIG_KEYS = new Set([
  "baseDir",
  "adapter",
  "context",
  "contextOptions",
  "validationOptions",
  "onSecurityEvent",
]);
const SECURE_FS_WRAPPER_OPTION_KEYS = new Set([
  "baseDir",
  "context",
  "contextOptions",
  "validationOptions",
  "onSecurityEvent",
]);
const VALIDATION_OPTION_KEYS = new Set([
  "level",
  "allowedDirs",
  "followSymlinks",
  "checkExists",
  "allowAbsolute",
]);
const CONTEXT_OPTION_KEYS = new Set(["allowedImportDirs"]);
const RECURSIVE_OPERATION_OPTION_KEYS = new Set(["recursive"]);
const WATCH_OPTION_KEYS = new Set(["recursive", "signal"]);
const MAX_POLICY_DIRECTORY_ENTRIES = 1_024;
const MAX_POLICY_DIRECTORY_LENGTH = 4_096;
const universalObjectPrototype = Object.prototype;
const objectDefineProperty = Object.defineProperty;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

const SECURE_FS_IMMUTABLE_AUTHORITY_KEYS = [
  "config",
  "fileSystem",
  "validationOptions",
  "readFileBytesBounded",
  "readFileBytesWithinLimit",
  "maxWholeFileReadBytes",
] as const;

function hardenSecureFsAuthority(target: SecureFs): void {
  for (const key of SECURE_FS_IMMUTABLE_AUTHORITY_KEYS) {
    const descriptor = objectGetOwnPropertyDescriptor(target, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      invalidSecureFsOption(`SecureFs ${key} publication is invalid`);
    }
    objectDefineProperty(target, key, {
      configurable: false,
      enumerable: descriptor.enumerable === true,
      value: descriptor.value,
      writable: false,
    });
  }
}

type OwnOptionSnapshot = Readonly<Record<string, unknown>>;

interface NormalizedSecureFsConfig {
  readonly baseDir: string;
  readonly context: SecurityContext;
  readonly contextOptions: ContextOptions;
  readonly validationOptions: Partial<Omit<PathValidationPolicyOptions, "baseDir">>;
  readonly onSecurityEvent: (event: SecurityEvent) => void;
}

function invalidSecureFsOption(detail: string): never {
  throw INVALID_ARGUMENT.create({ detail });
}

function hasInheritedOption(value: object, key: string): boolean {
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    invalidSecureFsOption("SecureFs options could not be inspected safely");
  }

  const seen = new Set<object>();
  for (let depth = 0; prototype !== null && depth < 64; depth++) {
    if (seen.has(prototype)) {
      invalidSecureFsOption("SecureFs options contain an invalid prototype chain");
    }
    seen.add(prototype);
    try {
      if (Object.getOwnPropertyDescriptor(prototype, key) !== undefined) return true;
      prototype = Object.getPrototypeOf(prototype);
    } catch {
      invalidSecureFsOption("SecureFs options could not be inspected safely");
    }
  }

  if (prototype !== null) {
    invalidSecureFsOption("SecureFs options prototype chain is too deep");
  }
  return false;
}

function snapshotOwnOptions(
  value: unknown,
  label: string,
  allowedKeys: ReadonlySet<string>,
): OwnOptionSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidSecureFsOption(`${label} must be an object`);
  }

  let ownKeys: Array<string | symbol>;
  try {
    ownKeys = Reflect.ownKeys(value);
  } catch {
    invalidSecureFsOption(`${label} could not be inspected safely`);
  }

  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const key of ownKeys) {
    if (typeof key !== "string" || !allowedKeys.has(key)) {
      invalidSecureFsOption(
        `${label} contains an unsupported ${typeof key === "string" ? `option: ${key}` : "symbol"}`,
      );
    }

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      invalidSecureFsOption(`${label}.${key} could not be inspected safely`);
    }
    if (descriptor === undefined || !("value" in descriptor)) {
      invalidSecureFsOption(`${label}.${key} must be an own data property`);
    }
    snapshot[key] = descriptor.value;
  }

  for (const key of allowedKeys) {
    if (
      Object.getOwnPropertyDescriptor(snapshot, key) === undefined &&
      hasInheritedOption(value, key)
    ) {
      invalidSecureFsOption(`${label}.${key} must be an own data property`);
    }
  }

  Object.freeze(snapshot);
  return snapshot;
}

function snapshotDirectoryList(
  value: unknown,
  label: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    invalidSecureFsOption(`${label} must contain non-empty strings`);
  }

  let lengthDescriptor: PropertyDescriptor | undefined;
  let ownKeys: Array<string | symbol>;
  try {
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    ownKeys = Reflect.ownKeys(value);
  } catch {
    invalidSecureFsOption(`${label} could not be inspected safely`);
  }
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > MAX_POLICY_DIRECTORY_ENTRIES
  ) {
    invalidSecureFsOption(
      `${label} must contain at most ${MAX_POLICY_DIRECTORY_ENTRIES} entries`,
    );
  }

  for (const key of ownKeys) {
    if (key === "length") continue;
    if (typeof key !== "string") {
      invalidSecureFsOption(`${label} must not contain symbol properties`);
    }
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key) {
      invalidSecureFsOption(`${label} must be a dense array without custom properties`);
    }
  }

  const snapshot = new Array<string>(length);
  for (let index = 0; index < length; index++) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    } catch {
      invalidSecureFsOption(`${label}[${index}] could not be inspected safely`);
    }
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "string" ||
      descriptor.value.length === 0 ||
      descriptor.value.length > MAX_POLICY_DIRECTORY_LENGTH
    ) {
      invalidSecureFsOption(
        `${label} must contain dense, non-empty strings no longer than ${MAX_POLICY_DIRECTORY_LENGTH} characters`,
      );
    }
    snapshot[index] = descriptor.value;
  }
  Object.freeze(snapshot);
  return snapshot;
}

type FilesystemMethod = (...args: unknown[]) => unknown;
type FilesystemMethodKey =
  | "readFile"
  | "readFileBytes"
  | "readFileBytesBounded"
  | "readFileBytesWithinLimit"
  | "writeFile"
  | "stat"
  | "lstat"
  | "realPath"
  | "mkdir"
  | "remove"
  | "exists"
  | "readDir"
  | "makeTempDir"
  | "watch";

function snapshotFilesystemMethod(
  fileSystem: object,
  key: FilesystemMethodKey,
): FilesystemMethod | undefined {
  let owner: object | null = fileSystem;
  const seen = new Set<object>();
  for (let depth = 0; owner !== null && depth < 64; depth++) {
    if (owner === universalObjectPrototype) return undefined;
    if (isProxyWithoutHooks(owner)) {
      invalidSecureFsOption(`SecureFs filesystem ${key} capability cannot be a Proxy`);
    }
    if (seen.has(owner)) {
      invalidSecureFsOption("SecureFs filesystem contains an invalid prototype chain");
    }
    seen.add(owner);

    let parent: object | null;
    try {
      parent = Object.getPrototypeOf(owner);
    } catch {
      invalidSecureFsOption(`SecureFs filesystem ${key} capability could not be inspected safely`);
    }
    if (owner !== fileSystem && parent === null) return undefined;

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(owner, key);
    } catch {
      invalidSecureFsOption(`SecureFs filesystem ${key} capability could not be inspected safely`);
    }
    if (descriptor !== undefined) {
      if (!("value" in descriptor)) {
        invalidSecureFsOption(`SecureFs filesystem ${key} must be a data-property method`);
      }
      if (descriptor.value === undefined) return undefined;
      if (
        typeof descriptor.value !== "function" ||
        isProxyWithoutHooks(descriptor.value)
      ) {
        invalidSecureFsOption(`SecureFs filesystem ${key} must be a non-Proxy function`);
      }
      return descriptor.value as FilesystemMethod;
    }

    owner = parent;
  }

  if (owner !== null) {
    invalidSecureFsOption("SecureFs filesystem prototype chain is too deep");
  }
  return undefined;
}

function requireFilesystemMethod(
  fileSystem: RuntimeAdapter["fs"],
  key: Exclude<
    FilesystemMethodKey,
    | "readFileBytes"
    | "readFileBytesBounded"
    | "readFileBytesWithinLimit"
    | "lstat"
    | "realPath"
  >,
): FilesystemMethod {
  const method = snapshotFilesystemMethod(fileSystem, key);
  if (method === undefined) {
    invalidSecureFsOption(`SecureFs filesystem must provide ${key}`);
  }
  return method;
}

function snapshotFilesystem(
  fileSystem: RuntimeAdapter["fs"],
  hasSnapshotAuthority: boolean,
): RuntimeAdapter["fs"] {
  if (isProxyWithoutHooks(fileSystem)) {
    invalidSecureFsOption("SecureFs filesystem cannot be a Proxy");
  }
  let fileCapabilities: CapturedFileSystemCapabilities;
  try {
    fileCapabilities = hasSnapshotAuthority
      ? captureLegacyFileSystemCapabilitiesForSnapshot(fileSystem, "SecureFs filesystem")
      : captureFileSystemCapabilities(fileSystem, "SecureFs filesystem");
  } catch (_) {
    invalidSecureFsOption("SecureFs filesystem binary capabilities are invalid");
  }
  const readFile = requireFilesystemMethod(fileSystem, "readFile");
  const writeFile = requireFilesystemMethod(fileSystem, "writeFile");
  const stat = requireFilesystemMethod(fileSystem, "stat");
  const lstat = snapshotFilesystemMethod(fileSystem, "lstat");
  const realPath = snapshotFilesystemMethod(fileSystem, "realPath");
  const mkdir = requireFilesystemMethod(fileSystem, "mkdir");
  const remove = requireFilesystemMethod(fileSystem, "remove");
  const exists = requireFilesystemMethod(fileSystem, "exists");
  const readDir = requireFilesystemMethod(fileSystem, "readDir");
  const makeTempDir = requireFilesystemMethod(fileSystem, "makeTempDir");
  const watch = requireFilesystemMethod(fileSystem, "watch");

  let semantics: PropertyDescriptor | undefined;
  try {
    semantics = Object.getOwnPropertyDescriptor(fileSystem, "symlinkSemantics");
  } catch {
    invalidSecureFsOption("SecureFs filesystem symlink semantics could not be inspected safely");
  }

  const snapshot = Object.create(null) as RuntimeAdapter["fs"];
  if (semantics !== undefined && "value" in semantics && semantics.value === "none") {
    Object.defineProperty(snapshot, "symlinkSemantics", {
      value: "none",
      enumerable: true,
    });
  }
  snapshot.readFile = (path) => Reflect.apply(readFile, fileSystem, [path]) as Promise<string>;
  snapshot.writeFile = (path, content) =>
    Reflect.apply(writeFile, fileSystem, [path, content]) as Promise<void>;
  snapshot.stat = (path) => Reflect.apply(stat, fileSystem, [path]) as Promise<FileInfo>;
  snapshot.mkdir = (path, options) =>
    Reflect.apply(mkdir, fileSystem, [path, options]) as Promise<void>;
  snapshot.remove = (path, options) =>
    Reflect.apply(remove, fileSystem, [path, options]) as Promise<void>;
  snapshot.exists = (path) => Reflect.apply(exists, fileSystem, [path]) as Promise<boolean>;
  snapshot.readDir = (path) =>
    Reflect.apply(readDir, fileSystem, [path]) as AsyncIterable<DirEntry>;
  snapshot.makeTempDir = (prefix) =>
    Reflect.apply(makeTempDir, fileSystem, [prefix]) as Promise<string>;
  snapshot.watch = (paths, options) =>
    Reflect.apply(watch, fileSystem, [paths, options]) as FileWatcher;
  const wholeFileReader = fileCapabilities.wholeFileReader;
  if (wholeFileReader !== undefined) {
    Object.defineProperty(snapshot, "maxWholeFileReadBytes", {
      value: wholeFileReader.maximumBytes,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  const readFileBytes = fileCapabilities.readFileBytes;
  if (readFileBytes !== undefined) {
    snapshot.readFileBytes = readFileBytes;
  }
  const readFileBytesBounded = fileCapabilities.readFileBytesBounded;
  if (readFileBytesBounded !== undefined) {
    snapshot.readFileBytesBounded = readFileBytesBounded;
  }
  const readFileBytesWithinLimit = fileCapabilities.readFileBytesWithinLimit;
  if (readFileBytesWithinLimit !== undefined) {
    snapshot.readFileBytesWithinLimit = readFileBytesWithinLimit;
  }
  const writeFileBytes = fileCapabilities.writeFileBytes;
  if (writeFileBytes !== undefined) {
    snapshot.writeFileBytes = writeFileBytes;
  }
  if (lstat !== undefined) {
    snapshot.lstat = (path) => Reflect.apply(lstat, fileSystem, [path]) as Promise<FileInfo>;
  }
  if (realPath !== undefined) {
    snapshot.realPath = (path) => Reflect.apply(realPath, fileSystem, [path]) as Promise<string>;
  }

  return Object.freeze(snapshot);
}

function snapshotValidationAdapter(fileSystem: RuntimeAdapter["fs"]): RuntimeAdapter {
  const validationFs: {
    symlinkSemantics?: "none";
    stat?: RuntimeAdapter["fs"]["stat"];
    lstat?: RuntimeAdapter["fs"]["lstat"];
    realPath?: RuntimeAdapter["fs"]["realPath"];
  } = {};

  let semantics: PropertyDescriptor | undefined;
  try {
    semantics = Object.getOwnPropertyDescriptor(fileSystem, "symlinkSemantics");
  } catch {
    invalidSecureFsOption("SecureFs filesystem symlink semantics could not be inspected safely");
  }
  if (semantics !== undefined && "value" in semantics && semantics.value === "none") {
    validationFs.symlinkSemantics = "none";
  }

  const stat = snapshotFilesystemMethod(fileSystem, "stat");
  if (stat !== undefined) {
    validationFs.stat = (path: string) =>
      Reflect.apply(stat, fileSystem, [path]) as Promise<FileInfo>;
  }
  const lstat = snapshotFilesystemMethod(fileSystem, "lstat");
  if (lstat !== undefined) {
    validationFs.lstat = (path: string) =>
      Reflect.apply(lstat, fileSystem, [path]) as Promise<FileInfo>;
  }
  const realPath = snapshotFilesystemMethod(fileSystem, "realPath");
  if (realPath !== undefined) {
    validationFs.realPath = (path: string) =>
      Reflect.apply(realPath, fileSystem, [path]) as Promise<string>;
  }

  Object.freeze(validationFs);
  return Object.freeze({ fs: validationFs }) as RuntimeAdapter;
}

function cloneAndFreezeAllowedDirs(
  allowedDirs: string[] | undefined,
): string[] | undefined {
  if (allowedDirs === undefined) return undefined;
  return snapshotDirectoryList(allowedDirs, "SecureFs allowedDirs");
}

function normalizeValidationOptions(
  options: Partial<Omit<PathValidationPolicyOptions, "baseDir">> | undefined,
): Partial<Omit<PathValidationPolicyOptions, "baseDir">> {
  if (options === undefined) return Object.freeze({});
  const snapshot = snapshotOwnOptions(
    options,
    "SecureFs validationOptions",
    VALIDATION_OPTION_KEYS,
  );
  const normalized: Partial<Omit<PathValidationPolicyOptions, "baseDir">> = {};
  const level = snapshot.level;
  if (
    level !== undefined &&
    !VALIDATION_LEVELS.has(level as NonNullable<ValidationOptions["level"]>)
  ) {
    invalidSecureFsOption(
      "SecureFs validation level must be strict or normal",
    );
  }
  if (level !== undefined) normalized.level = level as ValidationOptions["level"];
  const allowedDirs = snapshotDirectoryList(snapshot.allowedDirs, "SecureFs allowedDirs");
  if (allowedDirs !== undefined) normalized.allowedDirs = allowedDirs;
  for (
    const key of [
      "followSymlinks",
      "checkExists",
      "allowAbsolute",
    ] as const
  ) {
    const value = snapshot[key];
    if (
      value !== undefined &&
      typeof value !== "boolean"
    ) {
      invalidSecureFsOption(`SecureFs ${key} must be a boolean`);
    }
    if (value !== undefined) normalized[key] = value;
  }
  return Object.freeze(normalized);
}

function normalizeContextOptions(
  options: ContextOptions | undefined,
): ContextOptions {
  if (options === undefined) return Object.freeze({});
  const snapshot = snapshotOwnOptions(
    options,
    "SecureFs contextOptions",
    CONTEXT_OPTION_KEYS,
  );
  return Object.freeze({
    allowedImportDirs: snapshotDirectoryList(
      snapshot.allowedImportDirs,
      "SecureFs allowedImportDirs",
    ),
  });
}

function normalizeRecursiveOperationOptions(
  options: { recursive?: boolean } | undefined,
  label: string,
): Readonly<{ recursive?: boolean }> | undefined {
  if (options === undefined) return undefined;
  const snapshot = snapshotOwnOptions(
    options,
    label,
    RECURSIVE_OPERATION_OPTION_KEYS,
  );
  if (snapshot.recursive !== undefined && typeof snapshot.recursive !== "boolean") {
    invalidSecureFsOption(`${label}.recursive must be a boolean`);
  }
  return Object.freeze(
    snapshot.recursive === undefined ? {} : { recursive: snapshot.recursive },
  );
}

function normalizeWatchOptions(
  options: { recursive?: boolean; signal?: AbortSignal } | undefined,
): Readonly<{ recursive?: boolean; signal?: AbortSignal }> | undefined {
  if (options === undefined) return undefined;
  const snapshot = snapshotOwnOptions(options, "SecureFs watch options", WATCH_OPTION_KEYS);
  if (snapshot.recursive !== undefined && typeof snapshot.recursive !== "boolean") {
    invalidSecureFsOption("SecureFs watch options.recursive must be a boolean");
  }
  if (snapshot.signal !== undefined && !(snapshot.signal instanceof AbortSignal)) {
    invalidSecureFsOption("SecureFs watch options.signal must be an AbortSignal");
  }
  const normalized: { recursive?: boolean; signal?: AbortSignal } = {};
  if (snapshot.recursive !== undefined) normalized.recursive = snapshot.recursive;
  if (snapshot.signal !== undefined) normalized.signal = snapshot.signal;
  return Object.freeze(normalized);
}

function getContextValidationOptions(
  context: SecurityContext,
  baseDir: string,
  options?: ContextOptions,
): PathValidationPolicyOptions {
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
        allowedDirs: options?.allowedImportDirs,
        followSymlinks: false,
        allowAbsolute: true,
      };
    case "internal":
      return ValidationPresets.internal(baseDir);
  }
}

export class SecureFs {
  private readonly config: NormalizedSecureFsConfig;
  private readonly fileSystem: RuntimeAdapter["fs"];
  private readonly validationOptions: ValidationOptions;
  readonly readFileBytesBounded?: (
    path: string,
    byteLimit: number,
  ) => Promise<Uint8Array>;
  readonly readFileBytesWithinLimit?: (
    path: string,
    byteLimit: number,
  ) => Promise<Uint8Array>;
  declare readonly readFileSnapshotWithinLimit?: (
    path: string,
    byteLimit: number,
  ) => Promise<Uint8Array>;
  readonly maxWholeFileReadBytes?: number;

  constructor(config: SecureFsConfig) {
    const snapshot = snapshotOwnOptions(
      config,
      "SecureFs config",
      SECURE_FS_CONFIG_KEYS,
    );
    const configuredBaseDir = snapshot.baseDir;
    if (typeof configuredBaseDir !== "string" || configuredBaseDir.length === 0) {
      invalidSecureFsOption("SecureFs baseDir must be a non-empty string");
    }
    const baseDir = resolve(configuredBaseDir);

    const adapter = snapshot.adapter;
    if (
      typeof adapter !== "object" ||
      adapter === null
    ) {
      invalidSecureFsOption("SecureFs requires a runtime adapter with a filesystem");
    }
    if (isProxyWithoutHooks(adapter)) {
      invalidSecureFsOption("SecureFs runtime adapter cannot be a Proxy");
    }
    let fsDescriptor: PropertyDescriptor | undefined;
    try {
      fsDescriptor = Object.getOwnPropertyDescriptor(adapter, "fs");
    } catch {
      invalidSecureFsOption("SecureFs adapter filesystem could not be inspected safely");
    }
    if (
      fsDescriptor === undefined ||
      !("value" in fsDescriptor) ||
      typeof fsDescriptor.value !== "object" ||
      fsDescriptor.value === null
    ) {
      invalidSecureFsOption(
        "SecureFs requires an own, data-property runtime adapter filesystem",
      );
    }
    const suppliedFileSystem = fsDescriptor.value as RuntimeAdapter["fs"];
    if (isProxyWithoutHooks(suppliedFileSystem)) {
      invalidSecureFsOption("SecureFs filesystem cannot be a Proxy");
    }
    let snapshotReader: ReturnType<typeof captureSnapshotReadCapability>;
    try {
      snapshotReader = captureSnapshotReadCapability(
        suppliedFileSystem,
        "SecureFs filesystem",
        // Treat an explicitly undefined capability as unsupported rather than
        // malformed. FSAdapterWrapper deliberately publishes every optional
        // capability as a frozen own property, including the ones the
        // underlying adapter does not provide, so that project code cannot
        // inject one after construction. Rejecting that shape made SecureFs
        // refuse the platform's own wrapper, and every hosted project on a
        // remote filesystem failed its render. The wrapper itself captures with
        // this same allowance. A present-but-non-function value is still
        // rejected below.
        true,
      );
    } catch (_) {
      invalidSecureFsOption("SecureFs filesystem snapshot capability is invalid");
    }
    let virtualSnapshotReader: ReturnType<typeof captureStaticReadCapabilities>["virtual"];
    if (snapshotReader === undefined) {
      try {
        virtualSnapshotReader = captureStaticReadCapabilities(
          suppliedFileSystem,
          "SecureFs filesystem",
          // Same wrapper shape as the snapshot capture above. Without this the
          // capture threw on FSAdapterWrapper's frozen `undefined` slots, and
          // the catch below turned that into a silent loss of virtual snapshot
          // authority rather than an error.
          true,
        ).virtual;
      } catch {
        // A malformed optional virtual publisher must not weaken otherwise
        // valid filesystem operations or be treated as snapshot authority.
        virtualSnapshotReader = undefined;
      }
    }
    this.fileSystem = snapshotFilesystem(
      suppliedFileSystem,
      snapshotReader !== undefined,
    );
    if (this.fileSystem.maxWholeFileReadBytes !== undefined) {
      this.maxWholeFileReadBytes = this.fileSystem.maxWholeFileReadBytes;
    }

    const context = requireSecurityContext(
      snapshot.context === undefined ? "internal" : snapshot.context,
    );
    if (
      snapshot.onSecurityEvent !== undefined &&
      typeof snapshot.onSecurityEvent !== "function"
    ) {
      invalidSecureFsOption("SecureFs onSecurityEvent must be a function");
    }

    this.config = Object.freeze({
      baseDir,
      context,
      contextOptions: normalizeContextOptions(
        snapshot.contextOptions as ContextOptions | undefined,
      ),
      onSecurityEvent: (snapshot.onSecurityEvent as ((event: SecurityEvent) => void) | undefined) ??
        (() => {}),
      validationOptions: normalizeValidationOptions(
        snapshot.validationOptions as
          | Partial<Omit<PathValidationPolicyOptions, "baseDir">>
          | undefined,
      ),
    });

    const validationAdapter = snapshotValidationAdapter(this.fileSystem);

    this.validationOptions = this.buildValidationOptions(
      this.config.context,
      this.config.contextOptions,
      validationAdapter,
    );

    const boundedReader = this.fileSystem.readFileBytesBounded;
    if (boundedReader) {
      this.readFileBytesBounded = async (path: string, byteLimit: number) => {
        if (!Number.isSafeInteger(byteLimit) || byteLimit <= 0) {
          throw new RangeError("SecureFs bounded read limit must be a positive safe integer");
        }
        const validation = await this.validatePathForOperation(
          path,
          "readFileBytesBounded",
        );
        const canonicalPath = this.getCanonicalPathOrThrow(validation, path);
        return copyFixedUint8ArrayWithinLimit(
          await boundedReader.call(this.fileSystem, canonicalPath, byteLimit),
          byteLimit,
          "SecureFs bounded read",
        );
      };
    }

    const exactReader = this.fileSystem.readFileBytesWithinLimit;
    if (exactReader) {
      this.readFileBytesWithinLimit = async (path: string, byteLimit: number) => {
        if (!Number.isSafeInteger(byteLimit) || byteLimit <= 0) {
          throw new RangeError(
            "SecureFs exact bounded read limit must be a positive safe integer",
          );
        }
        const validation = await this.validatePathForOperation(
          path,
          "readFileBytesWithinLimit",
        );
        const canonicalPath = this.getCanonicalPathOrThrow(validation, path);
        return copyFixedUint8ArrayWithinLimit(
          await exactReader.call(this.fileSystem, canonicalPath, byteLimit),
          byteLimit,
          "SecureFs exact bounded read",
        );
      };
    }
    if (snapshotReader !== undefined) {
      const containmentRoot = this.config.baseDir;
      objectDefineProperty(this, "readFileSnapshotWithinLimit", {
        configurable: false,
        enumerable: true,
        value: async (path: string, byteLimit: number) => {
          if (!Number.isSafeInteger(byteLimit) || byteLimit <= 0) {
            throw new RangeError(
              "SecureFs snapshot read limit must be a positive safe integer",
            );
          }
          const validation = await this.validatePathForOperation(
            path,
            "readFileSnapshotWithinLimit",
          );
          const canonicalPath = this.getCanonicalPathOrThrow(validation, path);
          return copyFixedUint8ArrayWithinLimit(
            await snapshotReader.read(canonicalPath, containmentRoot, byteLimit),
            byteLimit,
            "SecureFs snapshot read",
          );
        },
        writable: false,
      });
    } else if (
      virtualSnapshotReader !== undefined &&
      (virtualSnapshotReader.exact !== undefined || virtualSnapshotReader.whole !== undefined)
    ) {
      const reader = virtualSnapshotReader;
      objectDefineProperty(this, "readFileSnapshotWithinLimit", {
        configurable: false,
        enumerable: true,
        value: async (path: string, byteLimit: number) => {
          if (!Number.isSafeInteger(byteLimit) || byteLimit <= 0) {
            throw new RangeError(
              "SecureFs snapshot read limit must be a positive safe integer",
            );
          }
          const validation = await this.validatePathForOperation(
            path,
            "readFileSnapshotWithinLimit",
          );
          const canonicalPath = this.getCanonicalPathOrThrow(validation, path);
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
          return copyFixedUint8ArrayWithinLimit(
            bytes,
            byteLimit,
            "SecureFs virtual snapshot read",
          );
        },
        writable: false,
      });
    }
    hardenSecureFsAuthority(this);
  }

  private buildValidationOptions(
    context: SecurityContext,
    contextOptions: ContextOptions | undefined,
    adapter: RuntimeAdapter,
  ): ValidationOptions {
    const contextValidationOptions = getContextValidationOptions(
      context,
      this.config.baseDir,
      contextOptions,
    );
    const overrides = this.config.validationOptions;
    const validationOptions: ValidationOptions = {
      baseDir: this.config.baseDir,
      level: overrides.level ?? contextValidationOptions.level,
      allowedDirs: cloneAndFreezeAllowedDirs(
        overrides.allowedDirs ?? contextValidationOptions.allowedDirs,
      ),
      followSymlinks: overrides.followSymlinks ?? contextValidationOptions.followSymlinks,
      checkExists: overrides.checkExists ?? contextValidationOptions.checkExists,
      allowAbsolute: overrides.allowAbsolute ?? contextValidationOptions.allowAbsolute,
      adapter,
    };
    return Object.freeze(validationOptions);
  }

  private emitValidationEvent(
    result: ValidationResult,
    operation: string,
    path: string,
  ): void {
    try {
      this.config.onSecurityEvent({
        type: result.valid ? "validation-passed" : "validation-failed",
        operation,
        path: sanitizePathForDisplay(path, this.config.baseDir),
        error: result.error,
        code: result.code,
        timestamp: new Date(),
      });
    } catch {
      // Observability callbacks must not replace the filesystem policy result.
    }
  }

  private throwIfInvalid(
    result: ValidationResult,
    operation: string,
    path: string,
  ): void {
    if (result.valid) return;

    throw SECURITY_VIOLATION.create({
      detail: `Path validation failed for ${operation}: ${result.error}`,
      context: {
        code: result.code,
        path: sanitizePathForDisplay(path, this.config.baseDir),
      },
    });
  }

  private async validatePathForOperation(
    path: string,
    operation: string,
    options: ValidationOptions = this.validationOptions,
  ): Promise<ValidationResult> {
    const result = await validatePath(path, options);
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
      context: {
        code: validation.code,
        path: sanitizePathForDisplay(path, this.config.baseDir),
      },
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

    const reader = this.fileSystem.readFileBytes;
    if (reader) return await reader.call(this.fileSystem, canonicalPath);

    throw NOT_SUPPORTED.create({
      detail: "SecureFs binary reads require a binary-safe filesystem adapter",
    });
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
    const normalizedOptions = normalizeRecursiveOperationOptions(
      options,
      "SecureFs mkdir options",
    );
    const validation = await this.validatePathForOperation(path, "mkdir");
    const canonicalPath = this.getCanonicalPathOrThrow(validation, path);
    await this.fileSystem.mkdir(canonicalPath, normalizedOptions);
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    const normalizedOptions = normalizeRecursiveOperationOptions(
      options,
      "SecureFs remove options",
    );
    const validation = await this.validatePathForOperation(path, "remove");
    const canonicalPath = this.getCanonicalPathOrThrow(validation, path);
    await this.fileSystem.remove(canonicalPath, normalizedOptions);
  }

  async exists(path: string): Promise<boolean> {
    const validation = await this.validatePathForOperation(
      path,
      "exists",
      Object.freeze({ ...this.validationOptions, checkExists: false }),
    );
    const canonicalPath = this.getCanonicalPathOrThrow(validation, path);
    return await this.fileSystem.exists(canonicalPath);
  }

  async *readDir(path: string): AsyncIterable<DirEntry> {
    const validation = await this.validatePathForOperation(path, "readDir");
    const canonicalPath = this.getCanonicalPathOrThrow(validation, path);
    for await (const entry of this.fileSystem.readDir(canonicalPath)) {
      yield entry;
    }
  }

  async makeTempDir(prefix: string): Promise<string> {
    if (
      typeof prefix !== "string" ||
      prefix.length === 0 ||
      prefix.length > 128 ||
      !/^[A-Za-z0-9._-]+$/.test(prefix)
    ) {
      throw INVALID_ARGUMENT.create({
        detail: "SecureFs temporary-directory prefix must be 1-128 safe filename characters",
      });
    }

    const relativePath = `${prefix}${crypto.randomUUID()}`;
    const validation = await this.validatePathForOperation(relativePath, "makeTempDir");
    const canonicalPath = this.getCanonicalPathOrThrow(validation, relativePath);
    await this.fileSystem.mkdir(canonicalPath);
    return canonicalPath;
  }

  watch(
    paths: string | string[],
    options?: { recursive?: boolean; signal?: AbortSignal },
  ): FileWatcher {
    const pathArray = Array.isArray(paths)
      ? snapshotDirectoryList(paths, "SecureFs watch paths")!
      : [paths];
    if (
      pathArray.length === 0 ||
      !pathArray.every((path) => typeof path === "string" && path.length > 0)
    ) {
      throw INVALID_ARGUMENT.create({
        detail: "SecureFs watch requires at least one non-empty path",
      });
    }

    const watchOptions = normalizeWatchOptions(options);
    let watcher: FileWatcher | undefined;
    let closed = false;

    const ready = (async (): Promise<void> => {
      const validatedPaths: string[] = [];
      for (const path of pathArray) {
        const validation = await this.validatePathForOperation(path, "watch");
        validatedPaths.push(this.getCanonicalPathOrThrow(validation, path));
      }

      if (closed || watchOptions?.signal?.aborted) return;

      const pathArg: string | string[] = validatedPaths.length === 1
        ? validatedPaths[0]!
        : validatedPaths;
      watcher = this.fileSystem.watch(pathArg, watchOptions);
      try {
        await watcher.ready;
      } catch (error) {
        watcher.close();
        throw error;
      }
      if (closed || watchOptions?.signal?.aborted) watcher.close();
    })();

    const iterate = async function* (): AsyncIterableIterator<FileChangeEvent> {
      await ready;
      if (!watcher || closed) return;
      for await (const event of watcher) yield event;
    };

    return {
      ready,
      get done(): Promise<void> {
        return ready.then(async () => {
          await watcher?.done;
        });
      },
      close(): void {
        if (closed) return;
        closed = true;
        watcher?.close();
      },
      [Symbol.asyncIterator]() {
        return iterate();
      },
    };
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
      value: secureFs.maxWholeFileReadBytes,
      enumerable: true,
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
    fileSystem.readFileSnapshotWithinLimit = async (
      path,
      containmentRoot,
      byteLimit,
    ) => {
      if (containmentRoot !== constructionRoot) {
        throw new TypeError("Secured snapshot reads require the construction-time root");
      }
      const rootedPath = relative(constructionRoot, path);
      if (
        rootedPath === ".." ||
        rootedPath.startsWith(`..${sep}`) ||
        isAbsolute(rootedPath)
      ) {
        throw new TypeError(
          "Secured snapshot path must be contained by the construction-time root",
        );
      }
      return await secureFs.readFileSnapshotWithinLimit!(rootedPath, byteLimit);
    };
  }
  return Object.freeze(fileSystem);
}

export function wrapAdapterWithSecurity(
  adapter: RuntimeAdapter,
  options: Omit<SecureFsConfig, "adapter">,
): RuntimeAdapter & { secureFs: SecureFs } {
  const snapshot = snapshotOwnOptions(
    options,
    "SecureFs wrapper options",
    SECURE_FS_WRAPPER_OPTION_KEYS,
  );
  const secureFs = createSecureFs({
    baseDir: snapshot.baseDir as string,
    adapter,
    context: snapshot.context as SecurityContext | undefined,
    contextOptions: snapshot.contextOptions as ContextOptions | undefined,
    validationOptions: snapshot.validationOptions as
      | Partial<Omit<PathValidationPolicyOptions, "baseDir">>
      | undefined,
    onSecurityEvent: snapshot.onSecurityEvent as ((event: SecurityEvent) => void) | undefined,
  });

  const wrapped: RuntimeAdapter & { secureFs: SecureFs } = {
    id: adapter.id,
    name: adapter.name,
    capabilities: adapter.capabilities,
    fs: createSecuredAdapterFileSystem(secureFs, resolve(snapshot.baseDir as string)),
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
