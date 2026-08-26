import type {
  DirEntry,
  FileInfo,
  FileSystemAdapter,
  FileWatcher,
  ResolveFileOptions,
  SourceSnapshotFreshnessOptions,
  WatchOptions,
} from "#veryfront/platform/adapters/base.ts";
import type { ContextualFSAdapter, DirectoryEntry, FSAdapter } from "./veryfront/types.ts";
import {
  captureByteReadCapabilities,
  type CapturedByteReaders,
  type CapturedWholeFileReader,
  captureExclusiveCreateCapability,
  captureSnapshotReadCapability,
  copyFixedUint8ArrayWithinLimit,
} from "../file-system-capabilities.ts";

type CapturedMethod = (...args: never[]) => unknown;
const IntrinsicReflectApply = Reflect.apply;

function captureOptionalMethod(value: FSAdapter, key: string): CapturedMethod | undefined {
  const seen = new Set<object>();
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < 64; depth++) {
    if (owner === Object.prototype) return undefined;
    if (seen.has(owner)) throw new TypeError(`FSAdapter ${key} has an invalid prototype chain`);
    seen.add(owner);
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor !== undefined) {
      if (!("value" in descriptor)) {
        throw new TypeError(`FSAdapter ${key} must be a data-property method`);
      }
      if (descriptor.value === undefined) return undefined;
      if (typeof descriptor.value !== "function") {
        throw new TypeError(`FSAdapter ${key} must be a function`);
      }
      return descriptor.value as CapturedMethod;
    }
    owner = Object.getPrototypeOf(owner);
  }
  if (owner !== null) throw new TypeError("FSAdapter prototype chain is too deep");
  return undefined;
}

function captureOptionalOwnDataCapability(value: FSAdapter, key: string): unknown {
  const ownDescriptor = Object.getOwnPropertyDescriptor(value, key);
  if (ownDescriptor !== undefined) {
    if (!("value" in ownDescriptor)) {
      throw new TypeError(`FSAdapter ${key} must be an own data property`);
    }
    return ownDescriptor.value;
  }

  const seen = new Set<object>();
  let owner = Object.getPrototypeOf(value);
  for (let depth = 0; owner !== null && depth < 64; depth++) {
    if (owner === Object.prototype) return undefined;
    if (seen.has(owner)) throw new TypeError(`FSAdapter ${key} has an invalid prototype chain`);
    seen.add(owner);
    if (Object.getOwnPropertyDescriptor(owner, key) !== undefined) {
      throw new TypeError(`FSAdapter ${key} must be an own data property`);
    }
    owner = Object.getPrototypeOf(owner);
  }
  if (owner !== null) throw new TypeError("FSAdapter prototype chain is too deep");
  return undefined;
}

function publishFrozen(target: FSAdapterWrapper, key: PropertyKey, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: false,
    enumerable: true,
    value,
    writable: false,
  });
}

export interface ExtendedFileSystemAdapter extends FileSystemAdapter {
  getUnderlyingAdapter(): FSAdapter;
  getAdapterType(): string;
  isVeryfrontAdapter(): boolean;
  isMultiProjectMode(): boolean;
  isContextualMode(): boolean;
  isFixedProjectMode(): boolean;
  setRequestToken(token: string): void;
  clearRequestToken(): void;
  setRequestBranch(branch: string | null): void;
  getRequestBranch(): string | null;
  clearRequestBranch(): void;
  setProductionMode(enabled: boolean, releaseId?: string | null): void;
  runWithContext<T>(
    projectSlug: string,
    token: string,
    fn: () => Promise<T>,
    projectId?: string,
    options?: {
      productionMode?: boolean;
      releaseId?: string | null;
      branch?: string | null;
      environmentName?: string | null;
    },
  ): Promise<T>;
  readFileBytes(path: string): Promise<Uint8Array>;
  readonly maxWholeFileReadBytes?: number;
  readonly readFileBytesBounded?: (path: string, byteLimit: number) => Promise<Uint8Array>;
  readonly readFileBytesWithinLimit?: (path: string, byteLimit: number) => Promise<Uint8Array>;
  readonly readFileSnapshotWithinLimit?: (
    path: string,
    containmentRoot: string,
    byteLimit: number,
  ) => Promise<Uint8Array>;
  readonly createFileBytesExclusive?: (path: string, content: Uint8Array) => Promise<void>;
  readOptionalTextFile(path: string): Promise<string>;
  readdir(path: string): Promise<DirectoryEntry[]>;
  shutdown(): Promise<void>;
}

export function isExtendedFSAdapter(fs: FileSystemAdapter): fs is ExtendedFileSystemAdapter {
  return "isVeryfrontAdapter" in fs && "getUnderlyingAdapter" in fs && "isMultiProjectMode" in fs;
}

/**
 * Virtual filesystem adapters that fetch files remotely (API, GitHub, etc.)
 * rather than reading from a local disk.
 */
const VIRTUAL_FS_ADAPTERS = new Set([
  "VeryfrontFSAdapter",
  "MultiProjectFSAdapter",
  "GitHubFSAdapter",
]);

/**
 * Check if the adapter is using a virtual filesystem (Veryfront API, GitHub, etc.)
 * Centralized predicate — use this instead of inline checks.
 */
export function isVirtualFilesystem(fs: FileSystemAdapter): boolean {
  if (!fs || typeof fs !== "object") return false;
  if (!isExtendedFSAdapter(fs)) return false;
  if (fs.isVeryfrontAdapter()) return true;
  return VIRTUAL_FS_ADAPTERS.has(fs.getAdapterType());
}

export class NotSupportedError extends Error {
  constructor(operation: string, adapterType?: string) {
    super(
      adapterType
        ? `Operation '${operation}' is not supported by ${adapterType}`
        : `Operation '${operation}' is not supported by this FSAdapter`,
    );
    this.name = "NotSupportedError";
  }
}

function isContextualAdapter(adapter: FSAdapter): adapter is ContextualFSAdapter {
  return "setRequestToken" in adapter || "runWithContext" in adapter;
}

export class FSAdapterWrapper implements ExtendedFileSystemAdapter {
  private readonly _fsAdapter: FSAdapter;
  private readonly _unboundedFileReader?: (path: string) => Promise<Uint8Array>;
  private readonly _wholeFileReader?: CapturedWholeFileReader;
  private readonly _fixedProjectMode: boolean;
  readonly symlinkSemantics: "none" | undefined;
  readonly projectContextSemantics: "fixed" | undefined;
  readonly maxWholeFileReadBytes?: number;
  readonly readFileBytesBounded?: (path: string, byteLimit: number) => Promise<Uint8Array>;
  readonly readFileBytesWithinLimit?: (path: string, byteLimit: number) => Promise<Uint8Array>;
  readonly readFileSnapshotWithinLimit?: (
    path: string,
    containmentRoot: string,
    byteLimit: number,
  ) => Promise<Uint8Array>;
  readonly createFileBytesExclusive?: (path: string, content: Uint8Array) => Promise<void>;
  readonly refreshSourceSnapshot?: (reason?: string) => Promise<void>;
  readonly ensureSourceSnapshotFresh?: (
    reason?: string,
    options?: SourceSnapshotFreshnessOptions,
  ) => Promise<void>;
  readonly sourceSnapshotFreshnessOptionsVersion?: 1;
  readonly getSourceSnapshotVersion?: () => number | undefined | Promise<number | undefined>;
  readonly getSourceSnapshotFingerprint?: () =>
    | string
    | undefined
    | Promise<string | undefined>;
  readonly getSourceSnapshotIdentity?: () => string | undefined | Promise<string | undefined>;

  constructor(fsAdapter: FSAdapter) {
    this._fsAdapter = fsAdapter;
    const semantics = Object.getOwnPropertyDescriptor(fsAdapter, "symlinkSemantics");
    this.symlinkSemantics = semantics && "value" in semantics && semantics.value === "none"
      ? "none"
      : undefined;
    const projectContext = Object.getOwnPropertyDescriptor(fsAdapter, "projectContextSemantics");
    this.projectContextSemantics = projectContext && "value" in projectContext &&
        projectContext.value === "fixed"
      ? "fixed"
      : undefined;
    this._fixedProjectMode = this.projectContextSemantics === "fixed";

    const snapshotReader = captureSnapshotReadCapability(fsAdapter, "FSAdapter", true);
    let byteReaders: CapturedByteReaders;
    try {
      byteReaders = captureByteReadCapabilities(fsAdapter, "FSAdapter");
    } catch (error) {
      if (snapshotReader === undefined) throw error;
      byteReaders = Object.freeze({}) as CapturedByteReaders;
    }
    this._unboundedFileReader = byteReaders.unbounded;
    if (byteReaders.whole !== undefined) {
      this._wholeFileReader = byteReaders.whole;
      this.maxWholeFileReadBytes = byteReaders.whole.maximumBytes;
    }
    if (byteReaders.prefix !== undefined) this.readFileBytesBounded = byteReaders.prefix;
    if (byteReaders.exact !== undefined) this.readFileBytesWithinLimit = byteReaders.exact;
    if (snapshotReader !== undefined) {
      this.readFileSnapshotWithinLimit = (path, containmentRoot, byteLimit) =>
        snapshotReader.read(path, containmentRoot, byteLimit);
    }
    let exclusiveCreator;
    try {
      exclusiveCreator = captureExclusiveCreateCapability(fsAdapter, "FSAdapter");
    } catch {
      exclusiveCreator = undefined;
    }
    if (exclusiveCreator !== undefined) {
      this.createFileBytesExclusive = (path, content) => exclusiveCreator.create(path, content);
    }

    const refreshSourceSnapshot = captureOptionalMethod(fsAdapter, "refreshSourceSnapshot");
    if (refreshSourceSnapshot !== undefined) {
      this.refreshSourceSnapshot = (reason?: string) =>
        IntrinsicReflectApply(refreshSourceSnapshot, fsAdapter, [reason]) as Promise<void>;
    }
    const ensureSourceSnapshotFresh = captureOptionalMethod(fsAdapter, "ensureSourceSnapshotFresh");
    if (ensureSourceSnapshotFresh !== undefined) {
      this.ensureSourceSnapshotFresh = (
        reason?: string,
        options?: SourceSnapshotFreshnessOptions,
      ) =>
        IntrinsicReflectApply(ensureSourceSnapshotFresh, fsAdapter, [reason, options]) as Promise<
          void
        >;
    }
    const freshnessOptionsVersion = captureOptionalOwnDataCapability(
      fsAdapter,
      "sourceSnapshotFreshnessOptionsVersion",
    );
    if (freshnessOptionsVersion === 1) {
      this.sourceSnapshotFreshnessOptionsVersion = 1;
    }
    const generation = captureOptionalMethod(fsAdapter, "getSourceSnapshotVersion");
    if (generation !== undefined) {
      this.getSourceSnapshotVersion = () =>
        IntrinsicReflectApply(generation, fsAdapter, []) as
          | number
          | undefined
          | Promise<number | undefined>;
    }
    const fingerprint = captureOptionalMethod(fsAdapter, "getSourceSnapshotFingerprint");
    if (fingerprint !== undefined) {
      this.getSourceSnapshotFingerprint = () =>
        IntrinsicReflectApply(fingerprint, fsAdapter, []) as
          | string
          | undefined
          | Promise<string | undefined>;
    }
    const snapshotIdentity = captureOptionalMethod(fsAdapter, "getSourceSnapshotIdentity");
    if (snapshotIdentity !== undefined) {
      this.getSourceSnapshotIdentity = () =>
        IntrinsicReflectApply(snapshotIdentity, fsAdapter, []) as
          | string
          | undefined
          | Promise<string | undefined>;
    }

    for (
      const key of [
        "symlinkSemantics",
        "projectContextSemantics",
        "maxWholeFileReadBytes",
        "readFileBytesBounded",
        "readFileBytesWithinLimit",
        "readFileSnapshotWithinLimit",
        "createFileBytesExclusive",
        "refreshSourceSnapshot",
        "ensureSourceSnapshotFresh",
        "sourceSnapshotFreshnessOptionsVersion",
        "getSourceSnapshotVersion",
        "getSourceSnapshotFingerprint",
        "getSourceSnapshotIdentity",
      ] as const
    ) {
      publishFrozen(this, key, this[key]);
    }
  }

  getUnderlyingAdapter(): FSAdapter {
    return this._fsAdapter;
  }

  getAdapterType(): string {
    return this._fsAdapter.constructor.name;
  }

  isVeryfrontAdapter(): boolean {
    const name = this._fsAdapter.constructor.name;
    return name === "VeryfrontFSAdapter" || name === "MultiProjectFSAdapter";
  }

  private get adapterType(): string {
    return this._fsAdapter.constructor.name;
  }

  private get contextual(): ContextualFSAdapter {
    if (!isContextualAdapter(this._fsAdapter)) {
      throw new NotSupportedError("contextual operations", this.adapterType);
    }
    return this._fsAdapter;
  }

  private requireContextualMethod<K extends keyof ContextualFSAdapter>(
    operation: string,
    key: K,
  ): NonNullable<ContextualFSAdapter[K]> {
    const adapter = this.contextual;
    const method = adapter[key];
    if (!method) throw new NotSupportedError(operation, this.adapterType);
    return (typeof method === "function" ? method.bind(adapter) : method) as NonNullable<
      ContextualFSAdapter[K]
    >;
  }

  setRequestToken(token: string): void {
    this.requireContextualMethod("setRequestToken", "setRequestToken")(token);
  }

  clearRequestToken(): void {
    this.requireContextualMethod("clearRequestToken", "clearRequestToken")();
  }

  setRequestBranch(branch: string | null): void {
    this.requireContextualMethod("setRequestBranch", "setRequestBranch")(branch);
  }

  getRequestBranch(): string | null {
    return this.requireContextualMethod("getRequestBranch", "getRequestBranch")();
  }

  clearRequestBranch(): void {
    this.requireContextualMethod("clearRequestBranch", "clearRequestBranch")();
  }

  setProductionMode(enabled: boolean, releaseId?: string | null): void {
    this.requireContextualMethod("setProductionMode", "setProductionMode")(enabled, releaseId);
  }

  runWithContext<T>(
    projectSlug: string,
    token: string,
    fn: () => Promise<T>,
    projectId?: string,
    options?: {
      productionMode?: boolean;
      releaseId?: string | null;
      branch?: string | null;
      environmentName?: string | null;
    },
  ): Promise<T> {
    return this.requireContextualMethod("runWithContext", "runWithContext")(
      projectSlug,
      token,
      fn,
      projectId,
      options,
    );
  }

  isMultiProjectMode(): boolean {
    return isContextualAdapter(this._fsAdapter) &&
      typeof this._fsAdapter.runWithContext === "function";
  }

  isFixedProjectMode(): boolean {
    return this._fixedProjectMode;
  }

  isContextualMode(): boolean {
    return isContextualAdapter(this._fsAdapter) && !this.isFixedProjectMode();
  }

  async readFile(path: string): Promise<string> {
    if (this._fsAdapter.readTextFile) return this._fsAdapter.readTextFile(path);

    const result = await this._fsAdapter.readFile(path);
    return typeof result === "string" ? result : new TextDecoder().decode(result);
  }

  async readOptionalTextFile(path: string): Promise<string> {
    if (this._fsAdapter.readOptionalTextFile) {
      return this._fsAdapter.readOptionalTextFile(path);
    }

    return this.readFile(path);
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    if (this._wholeFileReader !== undefined) return await this._wholeFileReader.read(path);
    if (this._unboundedFileReader !== undefined) return await this._unboundedFileReader(path);
    const result = await this._fsAdapter.readFile(path);
    if (typeof result === "string") return new TextEncoder().encode(result);
    return copyFixedUint8ArrayWithinLimit(
      result,
      Number.MAX_SAFE_INTEGER,
      "FSAdapter readFile fallback",
    );
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (!this._fsAdapter.writeFile) throw new NotSupportedError("writeFile", this.adapterType);
    await this._fsAdapter.writeFile(path, content);
  }

  exists(path: string): Promise<boolean> {
    return this._fsAdapter.exists(path);
  }

  private async getDirEntries(path: string): Promise<DirectoryEntry[]> {
    if (this._fsAdapter.readdir) {
      const result = this._fsAdapter.readdir(path);
      return result instanceof Promise ? await result : await Array.fromAsync(result);
    }

    if (this._fsAdapter.readDir) return await Array.fromAsync(this._fsAdapter.readDir(path));

    throw new NotSupportedError("readdir", this.adapterType);
  }

  async *readDir(path: string): AsyncIterable<DirEntry> {
    const entries = await this.getDirEntries(path);
    for (const entry of entries) {
      yield {
        name: entry.name,
        isFile: entry.isFile,
        isDirectory: entry.isDirectory,
        isSymlink: entry.isSymlink,
      };
    }
  }

  readdir(path: string): Promise<DirectoryEntry[]> {
    return this.getDirEntries(path);
  }

  async stat(path: string): Promise<FileInfo> {
    const info = await this._fsAdapter.stat(path);
    return {
      size: info.size,
      isFile: info.isFile,
      isDirectory: info.isDirectory,
      isSymlink: info.isSymlink,
      mtime: info.mtime,
    };
  }

  resolveFile(basePath: string, options?: ResolveFileOptions): Promise<string | null> {
    if (!this._fsAdapter.resolveFile) throw new NotSupportedError("resolveFile", this.adapterType);
    return this._fsAdapter.resolveFile(basePath, options);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (!this._fsAdapter.mkdir) throw new NotSupportedError("mkdir", this.adapterType);
    await this._fsAdapter.mkdir(path, options);
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (!this._fsAdapter.remove) throw new NotSupportedError("remove", this.adapterType);
    await this._fsAdapter.remove(path, options);
  }

  makeTempDir(_prefix: string): Promise<string> {
    throw new NotSupportedError("makeTempDir", this.adapterType);
  }

  watch(_paths: string | string[], _options?: WatchOptions): FileWatcher {
    throw new NotSupportedError("watch", this.adapterType);
  }

  async shutdown(): Promise<void> {
    await this._fsAdapter.shutdown?.();
  }
}

export function wrapFSAdapter(fsAdapter: FSAdapter): ExtendedFileSystemAdapter {
  return new FSAdapterWrapper(fsAdapter);
}
