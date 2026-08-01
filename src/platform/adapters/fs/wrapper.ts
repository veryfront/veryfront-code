import type {
  DirEntry,
  FileInfo,
  FileSystemAdapter,
  FileWatcher,
  ResolveFileOptions,
  WatchOptions,
} from "../base.ts";
import type {
  ContextualFSAdapter,
  DirectoryEntry,
  FSAdapter,
  StyleArtifactAccess,
  StyleConfigBinding,
} from "./veryfront/types.ts";
import type { RequestTokenProvenance } from "./veryfront/request-context.ts";
import { getVeryfrontFSAdapterKind } from "./veryfront/adapter-kind.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import {
  type CapturedFileSystemCapabilities,
  captureFileSystemCapabilities,
} from "#veryfront/platform/adapters/file-system-capabilities.ts";
import { copyFixedUint8ArrayWithinLimit } from "#veryfront/platform/adapters/bounded-text-reader.ts";

const universalObjectPrototype = Object.prototype;
const defineProperty = Object.defineProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

const WRAPPER_PUBLISHED_CAPABILITY_KEYS = [
  "symlinkSemantics",
  "maxWholeFileReadBytes",
  "readFileBytesBounded",
  "readFileBytesWithinLimit",
  "writeFileBytes",
  "refreshSourceSnapshot",
  "ensureSourceSnapshotFresh",
  "getSourceSnapshotVersion",
  "getStyleArtifactAccess",
] as const;

function hardenPublishedCapabilities(target: object): void {
  for (const key of WRAPPER_PUBLISHED_CAPABILITY_KEYS) {
    const descriptor = getOwnPropertyDescriptor(target, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new TypeError(`FSAdapterWrapper ${key} publication is invalid`);
    }
    defineProperty(target, key, {
      configurable: false,
      enumerable: true,
      value: descriptor.value,
      writable: false,
    });
  }
}

type SnapshotMethod = (...args: never[]) => unknown;

function captureOptionalAdapterMethod(
  adapter: object,
  key: string,
): SnapshotMethod | undefined {
  let owner: object | null = adapter;
  const seen = new Set<object>();
  for (let depth = 0; owner !== null && depth < 64; depth++) {
    if (owner === universalObjectPrototype) return undefined;
    if (isProxyWithoutHooks(owner) || seen.has(owner)) {
      throw new TypeError(`FSAdapter ${key} capability has an invalid prototype chain`);
    }
    seen.add(owner);
    let parent: object | null;
    try {
      parent = Object.getPrototypeOf(owner);
    } catch (cause) {
      throw new TypeError(`FSAdapter ${key} capability could not be inspected safely`, {
        cause,
      });
    }
    if (owner !== adapter && parent === null) return undefined;
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(owner, key);
    } catch (cause) {
      throw new TypeError(`FSAdapter ${key} capability could not be inspected safely`, {
        cause,
      });
    }
    if (descriptor !== undefined) {
      if (!("value" in descriptor)) {
        throw new TypeError(`FSAdapter ${key} must be a data-property method`);
      }
      if (descriptor.value === undefined) return undefined;
      if (typeof descriptor.value !== "function" || isProxyWithoutHooks(descriptor.value)) {
        throw new TypeError(`FSAdapter ${key} must be a non-Proxy function`);
      }
      return descriptor.value as SnapshotMethod;
    }
    owner = parent;
  }
  if (owner !== null) {
    throw new TypeError("FSAdapter capability prototype chain is too deep");
  }
  return undefined;
}

function assertPositiveReadLimit(byteLimit: number, label: string): void {
  if (!Number.isSafeInteger(byteLimit) || byteLimit <= 0) {
    throw new RangeError(`${label} limit must be a positive safe integer`);
  }
}

/** Capture request-scoped style authority without accessors or ambient prototypes. */
export function captureStyleArtifactAccessCapability(
  value: unknown,
): (() => Promise<StyleArtifactAccess>) | undefined {
  if (typeof value !== "object" || value === null || isProxyWithoutHooks(value)) {
    throw new TypeError("Style artifact filesystem must be a non-Proxy object");
  }
  const method = captureOptionalAdapterMethod(value, "getStyleArtifactAccess");
  return method === undefined
    ? undefined
    : () => Reflect.apply(method, value, []) as Promise<StyleArtifactAccess>;
}

export interface ExtendedFileSystemAdapter extends FileSystemAdapter {
  getUnderlyingAdapter(): FSAdapter;
  getAdapterType(): string;
  isVeryfrontAdapter(): boolean;
  isMultiProjectMode(): boolean;
  isContextualMode(): boolean;
  setRequestToken(token: string): void;
  clearRequestToken(): void;
  setRequestBranch(branch: string | null): void;
  getRequestBranch(): string | null;
  clearRequestBranch(): void;
  setProductionMode(enabled: boolean, releaseId?: string | null): void;
  createStyleConfigBinding?(): Promise<StyleConfigBinding>;
  installStyleConfig?(
    binding: StyleConfigBinding,
    config: Readonly<object>,
  ): Promise<boolean>;
  getStyleArtifactAccess?(): Promise<StyleArtifactAccess>;
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
      tokenProvenance?: RequestTokenProvenance;
    },
  ): Promise<T>;
  readFileBytes(path: string): Promise<Uint8Array>;
  readonly readFileBytesWithinLimit?: (
    path: string,
    byteLimit: number,
  ) => Promise<Uint8Array>;
  readOptionalTextFile(path: string): Promise<string>;
  readdir(path: string): Promise<DirectoryEntry[]>;
  shutdown(): Promise<void>;
}

export type HostedStyleConfigFileSystemAdapter =
  & ExtendedFileSystemAdapter
  & Required<
    Pick<ExtendedFileSystemAdapter, "createStyleConfigBinding" | "installStyleConfig">
  >;

export function isExtendedFSAdapter(fs: FileSystemAdapter): fs is ExtendedFileSystemAdapter {
  try {
    return captureOptionalAdapterMethod(fs, "isVeryfrontAdapter") !== undefined &&
      captureOptionalAdapterMethod(fs, "getUnderlyingAdapter") !== undefined &&
      captureOptionalAdapterMethod(fs, "isMultiProjectMode") !== undefined;
  } catch {
    return false;
  }
}

/**
 * Verify that an extended filesystem can atomically bind hosted style config to
 * the same request-scoped source used for config loading.
 *
 * `FSAdapterWrapper` exposes forwarding methods on every instance, including
 * wrappers whose underlying adapter cannot perform these operations. Inspect
 * both sides of the wrapper boundary so method presence on the facade cannot be
 * mistaken for an actual hosted capability.
 */
export function hasHostedStyleConfigCapability(
  fs: FileSystemAdapter,
): fs is HostedStyleConfigFileSystemAdapter {
  try {
    if (!isExtendedFSAdapter(fs)) {
      return false;
    }
    const runWithContext = captureOptionalAdapterMethod(fs, "runWithContext");
    const createStyleConfigBinding = captureOptionalAdapterMethod(
      fs,
      "createStyleConfigBinding",
    );
    const installStyleConfig = captureOptionalAdapterMethod(fs, "installStyleConfig");
    const getUnderlyingAdapter = captureOptionalAdapterMethod(fs, "getUnderlyingAdapter");
    if (
      runWithContext === undefined ||
      createStyleConfigBinding === undefined ||
      installStyleConfig === undefined ||
      getUnderlyingAdapter === undefined
    ) return false;

    const underlying: unknown = Reflect.apply(getUnderlyingAdapter, fs, []);
    if (!underlying || typeof underlying !== "object") return false;
    return captureOptionalAdapterMethod(underlying, "runWithContext") !== undefined &&
      captureOptionalAdapterMethod(underlying, "createStyleConfigBinding") !== undefined &&
      captureOptionalAdapterMethod(underlying, "installStyleConfig") !== undefined;
  } catch (_) {
    return false;
  }
}

/**
 * Check if the adapter is using a virtual filesystem (Veryfront API, GitHub, etc.)
 * Centralized predicate — use this instead of inline checks.
 *
 * `ExtendedFileSystemAdapter` is the provenance contract installed by the
 * remote-filesystem integration boundary, so every conforming wrapper is
 * treated as virtual. Class names are deliberately not used: they are unstable
 * under minification and prevent new wrapper implementations from being
 * classified safely.
 */
export function isVirtualFilesystem(fs: FileSystemAdapter): boolean {
  if (!fs || typeof fs !== "object") return false;
  return isExtendedFSAdapter(fs);
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
  try {
    return captureOptionalAdapterMethod(adapter, "setRequestToken") !== undefined ||
      captureOptionalAdapterMethod(adapter, "runWithContext") !== undefined;
  } catch {
    return false;
  }
}

export class FSAdapterWrapper implements ExtendedFileSystemAdapter {
  readonly #fsAdapter: FSAdapter;
  readonly #fileCapabilities: CapturedFileSystemCapabilities;
  readonly symlinkSemantics: "none" | undefined;
  readonly maxWholeFileReadBytes?: number;
  readonly readFileBytesBounded?: (
    path: string,
    byteLimit: number,
  ) => Promise<Uint8Array>;
  readonly readFileBytesWithinLimit?: (
    path: string,
    byteLimit: number,
  ) => Promise<Uint8Array>;
  readonly writeFileBytes?: (
    path: string,
    content: Uint8Array,
  ) => Promise<void>;
  readonly refreshSourceSnapshot?: (reason?: string) => Promise<void>;
  readonly ensureSourceSnapshotFresh?: (reason?: string) => Promise<void>;
  readonly getSourceSnapshotVersion?: () => number | undefined | Promise<number | undefined>;
  readonly getStyleArtifactAccess?: () => Promise<StyleArtifactAccess>;

  constructor(fsAdapter: FSAdapter) {
    if (isProxyWithoutHooks(fsAdapter)) {
      throw new TypeError("FSAdapterWrapper cannot safely wrap a Proxy filesystem adapter");
    }
    this.#fsAdapter = fsAdapter;
    this.#fileCapabilities = captureFileSystemCapabilities(fsAdapter, "FSAdapter");
    const symlinkSemantics = Object.getOwnPropertyDescriptor(
      fsAdapter,
      "symlinkSemantics",
    );
    this.symlinkSemantics = symlinkSemantics !== undefined &&
        "value" in symlinkSemantics &&
        symlinkSemantics.value === "none"
      ? "none"
      : undefined;
    const wholeFileReader = this.#fileCapabilities.wholeFileReader;
    if (wholeFileReader !== undefined) {
      this.maxWholeFileReadBytes = wholeFileReader.maximumBytes;
    }
    const boundedReader = this.#fileCapabilities.readFileBytesBounded;
    if (boundedReader !== undefined) {
      this.readFileBytesBounded = async (path: string, byteLimit: number) => {
        assertPositiveReadLimit(byteLimit, "FSAdapter bounded read");
        return copyFixedUint8ArrayWithinLimit(
          await boundedReader(path, byteLimit),
          byteLimit,
          "FSAdapter bounded read",
        );
      };
    }
    const readFileBytesWithinLimit = this.#fileCapabilities.readFileBytesWithinLimit;
    if (readFileBytesWithinLimit !== undefined) {
      this.readFileBytesWithinLimit = async (path: string, byteLimit: number) => {
        assertPositiveReadLimit(byteLimit, "FSAdapter exact bounded read");
        return copyFixedUint8ArrayWithinLimit(
          await readFileBytesWithinLimit(path, byteLimit),
          byteLimit,
          "FSAdapter exact bounded read",
        );
      };
    }
    const writeFileBytes = this.#fileCapabilities.writeFileBytes;
    if (writeFileBytes !== undefined) {
      this.writeFileBytes = writeFileBytes;
    }
    const refreshSourceSnapshot = captureOptionalAdapterMethod(
      fsAdapter,
      "refreshSourceSnapshot",
    );
    if (refreshSourceSnapshot !== undefined) {
      this.refreshSourceSnapshot = (reason?: string) =>
        Reflect.apply(refreshSourceSnapshot, fsAdapter, [reason]) as Promise<void>;
    }
    const ensureSourceSnapshotFresh = captureOptionalAdapterMethod(
      fsAdapter,
      "ensureSourceSnapshotFresh",
    );
    if (ensureSourceSnapshotFresh !== undefined) {
      this.ensureSourceSnapshotFresh = (reason?: string) =>
        Reflect.apply(ensureSourceSnapshotFresh, fsAdapter, [reason]) as Promise<void>;
    }
    const getSourceSnapshotVersion = captureOptionalAdapterMethod(
      fsAdapter,
      "getSourceSnapshotVersion",
    );
    if (getSourceSnapshotVersion !== undefined) {
      this.getSourceSnapshotVersion = () =>
        Reflect.apply(getSourceSnapshotVersion, fsAdapter, []) as
          | number
          | undefined
          | Promise<number | undefined>;
    }
    const getStyleArtifactAccess = captureStyleArtifactAccessCapability(fsAdapter);
    if (getStyleArtifactAccess !== undefined) {
      this.getStyleArtifactAccess = getStyleArtifactAccess;
    }
    hardenPublishedCapabilities(this);
  }

  getUnderlyingAdapter(): FSAdapter {
    return this.#fsAdapter;
  }

  getAdapterType(): string {
    return this.#fsAdapter.constructor.name;
  }

  isVeryfrontAdapter(): boolean {
    return getVeryfrontFSAdapterKind(this.#fsAdapter) !== undefined;
  }

  private get adapterType(): string {
    return this.#fsAdapter.constructor.name;
  }

  private get contextual(): ContextualFSAdapter {
    if (!isContextualAdapter(this.#fsAdapter)) {
      throw new NotSupportedError("contextual operations", this.adapterType);
    }
    return this.#fsAdapter;
  }

  private requireContextualMethod<K extends keyof ContextualFSAdapter>(
    operation: string,
    key: K,
  ): NonNullable<ContextualFSAdapter[K]> {
    const adapter = this.contextual;
    const method = captureOptionalAdapterMethod(adapter, String(key));
    if (method === undefined) throw new NotSupportedError(operation, this.adapterType);
    return ((...args: unknown[]) => Reflect.apply(method, adapter, args)) as NonNullable<
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

  async createStyleConfigBinding(): Promise<StyleConfigBinding> {
    return await this.requireContextualMethod(
      "createStyleConfigBinding",
      "createStyleConfigBinding",
    )();
  }

  async installStyleConfig(
    binding: StyleConfigBinding,
    config: Readonly<object>,
  ): Promise<boolean> {
    return await this.requireContextualMethod("installStyleConfig", "installStyleConfig")(
      binding,
      config,
    );
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
      tokenProvenance?: RequestTokenProvenance;
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
    return isContextualAdapter(this.#fsAdapter) &&
      typeof this.#fsAdapter.runWithContext === "function";
  }

  isContextualMode(): boolean {
    return isContextualAdapter(this.#fsAdapter);
  }

  async readFile(path: string): Promise<string> {
    if (this.#fsAdapter.readTextFile) return this.#fsAdapter.readTextFile(path);

    const result = await this.#fsAdapter.readFile(path);
    return typeof result === "string" ? result : new TextDecoder().decode(result);
  }

  async readOptionalTextFile(path: string): Promise<string> {
    if (this.#fsAdapter.readOptionalTextFile) {
      return this.#fsAdapter.readOptionalTextFile(path);
    }

    return this.readFile(path);
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    const binaryReader = this.#fileCapabilities.readFileBytes;
    if (binaryReader !== undefined) {
      return await binaryReader(path);
    }
    const result = await this.#fsAdapter.readFile(path);
    return typeof result === "string" ? new TextEncoder().encode(result) : result;
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (!this.#fsAdapter.writeFile) throw new NotSupportedError("writeFile", this.adapterType);
    await this.#fsAdapter.writeFile(path, content);
  }

  exists(path: string): Promise<boolean> {
    return this.#fsAdapter.exists(path);
  }

  private async getDirEntries(path: string): Promise<DirectoryEntry[]> {
    if (this.#fsAdapter.readdir) {
      const result = this.#fsAdapter.readdir(path);
      return result instanceof Promise ? await result : await Array.fromAsync(result);
    }

    if (this.#fsAdapter.readDir) return await Array.fromAsync(this.#fsAdapter.readDir(path));

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
    const info = await this.#fsAdapter.stat(path);
    return {
      size: info.size,
      isFile: info.isFile,
      isDirectory: info.isDirectory,
      isSymlink: info.isSymlink,
      mtime: info.mtime,
    };
  }

  resolveFile(basePath: string, options?: ResolveFileOptions): Promise<string | null> {
    if (!this.#fsAdapter.resolveFile) throw new NotSupportedError("resolveFile", this.adapterType);
    return this.#fsAdapter.resolveFile(basePath, options);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (!this.#fsAdapter.mkdir) throw new NotSupportedError("mkdir", this.adapterType);
    await this.#fsAdapter.mkdir(path, options);
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (!this.#fsAdapter.remove) throw new NotSupportedError("remove", this.adapterType);
    await this.#fsAdapter.remove(path, options);
  }

  makeTempDir(_prefix: string): Promise<string> {
    throw new NotSupportedError("makeTempDir", this.adapterType);
  }

  watch(_paths: string | string[], _options?: WatchOptions): FileWatcher {
    throw new NotSupportedError("watch", this.adapterType);
  }

  async shutdown(): Promise<void> {
    await this.#fsAdapter.shutdown?.();
  }
}

export function wrapFSAdapter(fsAdapter: FSAdapter): ExtendedFileSystemAdapter {
  return new FSAdapterWrapper(fsAdapter);
}
