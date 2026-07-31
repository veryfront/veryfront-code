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
  return "isVeryfrontAdapter" in fs && "getUnderlyingAdapter" in fs && "isMultiProjectMode" in fs;
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
    if (
      !isExtendedFSAdapter(fs) ||
      typeof fs.runWithContext !== "function" ||
      typeof fs.createStyleConfigBinding !== "function" ||
      typeof fs.installStyleConfig !== "function" ||
      typeof fs.getUnderlyingAdapter !== "function"
    ) {
      return false;
    }

    const underlying: unknown = fs.getUnderlyingAdapter();
    if (!underlying || typeof underlying !== "object") return false;
    const contextual = underlying as ContextualFSAdapter;
    return typeof contextual.runWithContext === "function" &&
      typeof contextual.createStyleConfigBinding === "function" &&
      typeof contextual.installStyleConfig === "function";
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
  return "setRequestToken" in adapter || "runWithContext" in adapter;
}

function snapshotMaxWholeFileReadBytes(adapter: FSAdapter): number | undefined {
  if (isProxyWithoutHooks(adapter)) return undefined;
  let owner: object | null = adapter;
  const seen = new Set<object>();
  for (let depth = 0; owner !== null && depth < 64; depth++) {
    if (isProxyWithoutHooks(owner) || seen.has(owner)) return undefined;
    seen.add(owner);
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(owner, "maxWholeFileReadBytes");
    } catch {
      return undefined;
    }
    if (descriptor !== undefined) {
      if (!("value" in descriptor) || descriptor.value === undefined) return undefined;
      return Number.isSafeInteger(descriptor.value) && descriptor.value > 0
        ? descriptor.value as number
        : undefined;
    }
    try {
      owner = Object.getPrototypeOf(owner);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

type ExactReadMethod = (
  path: string,
  byteLimit: number,
) => Promise<Uint8Array>;

function snapshotExactReadMethod(adapter: FSAdapter): ExactReadMethod | undefined {
  let owner: object | null = adapter;
  const seen = new Set<object>();
  for (let depth = 0; owner !== null && depth < 64; depth++) {
    // A proxied prototype makes capability discovery unverifiable. Omit the
    // optional capability without consulting any trap.
    if (isProxyWithoutHooks(owner) || seen.has(owner)) return undefined;
    seen.add(owner);

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(owner, "readFileBytesWithinLimit");
    } catch {
      return undefined;
    }
    if (descriptor !== undefined) {
      if (!("value" in descriptor)) {
        throw new TypeError(
          "FSAdapter readFileBytesWithinLimit must be a data-property method",
        );
      }
      if (descriptor.value === undefined) return undefined;
      if (
        typeof descriptor.value !== "function" ||
        isProxyWithoutHooks(descriptor.value)
      ) {
        throw new TypeError(
          "FSAdapter readFileBytesWithinLimit must be a non-Proxy function",
        );
      }
      return descriptor.value as ExactReadMethod;
    }

    try {
      owner = Object.getPrototypeOf(owner);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export class FSAdapterWrapper implements ExtendedFileSystemAdapter {
  private readonly _fsAdapter: FSAdapter;
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
    this._fsAdapter = fsAdapter;
    const symlinkSemantics = Object.getOwnPropertyDescriptor(
      fsAdapter,
      "symlinkSemantics",
    );
    this.symlinkSemantics = symlinkSemantics !== undefined &&
        "value" in symlinkSemantics &&
        symlinkSemantics.value === "none"
      ? "none"
      : undefined;
    const maxWholeFileReadBytes = snapshotMaxWholeFileReadBytes(fsAdapter);
    if (
      maxWholeFileReadBytes !== undefined &&
      typeof fsAdapter.readFileBytes === "function"
    ) {
      this.maxWholeFileReadBytes = maxWholeFileReadBytes;
    }
    if (typeof fsAdapter.readFileBytesBounded === "function") {
      this.readFileBytesBounded = (path: string, byteLimit: number) =>
        fsAdapter.readFileBytesBounded!.call(fsAdapter, path, byteLimit);
    }
    const readFileBytesWithinLimit = snapshotExactReadMethod(fsAdapter);
    if (readFileBytesWithinLimit !== undefined) {
      this.readFileBytesWithinLimit = (path: string, byteLimit: number) =>
        Reflect.apply(readFileBytesWithinLimit, fsAdapter, [path, byteLimit]);
    }
    if (typeof fsAdapter.writeFileBytes === "function") {
      this.writeFileBytes = (path: string, content: Uint8Array) =>
        fsAdapter.writeFileBytes!.call(fsAdapter, path, content);
    }
    if (typeof fsAdapter.refreshSourceSnapshot === "function") {
      this.refreshSourceSnapshot = (reason?: string) =>
        fsAdapter.refreshSourceSnapshot!.call(fsAdapter, reason);
    }
    if (typeof fsAdapter.ensureSourceSnapshotFresh === "function") {
      this.ensureSourceSnapshotFresh = (reason?: string) =>
        fsAdapter.ensureSourceSnapshotFresh!.call(fsAdapter, reason);
    }
    if (typeof fsAdapter.getSourceSnapshotVersion === "function") {
      this.getSourceSnapshotVersion = () => fsAdapter.getSourceSnapshotVersion!.call(fsAdapter);
    }
    if (typeof fsAdapter.getStyleArtifactAccess === "function") {
      this.getStyleArtifactAccess = () => fsAdapter.getStyleArtifactAccess!.call(fsAdapter);
    }
  }

  getUnderlyingAdapter(): FSAdapter {
    return this._fsAdapter;
  }

  getAdapterType(): string {
    return this._fsAdapter.constructor.name;
  }

  isVeryfrontAdapter(): boolean {
    return getVeryfrontFSAdapterKind(this._fsAdapter) !== undefined;
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
    return isContextualAdapter(this._fsAdapter) &&
      typeof this._fsAdapter.runWithContext === "function";
  }

  isContextualMode(): boolean {
    return isContextualAdapter(this._fsAdapter);
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
    if (this._fsAdapter.readFileBytes) {
      return await this._fsAdapter.readFileBytes(path);
    }
    const result = await this._fsAdapter.readFile(path);
    return typeof result === "string" ? new TextEncoder().encode(result) : result;
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
