/***********************
 * Runtime identifier for platform-specific code paths
 ***********************/
import type { NodeWebSocketServerProvider } from "#veryfront/extensions/websocket";

export type RuntimeId = "deno" | "node" | "bun" | "cloudflare" | "memory";

/**
 * Core runtime adapter interface
 *
 * Provides a unified abstraction over runtime-specific APIs (Deno, Node.js, Bun, Cloudflare Workers).
 * All platform-specific code should go through this adapter to ensure cross-platform compatibility.
 */
export interface RuntimeAdapter {
  /** Unique identifier for this runtime */
  readonly id: RuntimeId;

  /** Human-readable name for logging */
  readonly name: string;

  /** Runtime capabilities for feature detection */
  readonly capabilities: RuntimeCapabilities;

  /** Filesystem operations */
  fs: FileSystemAdapter;

  /**
   * Optional executor-owned imports from one prepared source generation.
   * An own data property fixed for the lifetime of one dedicated execution realm.
   * The filesystem and loader must refer to the same immutable source generation.
   * This capability does not grant permission to execute project code in a host.
   */
  readonly moduleLoader?: RuntimeModuleLoader;

  /** Environment variable access */
  env: EnvironmentAdapter;

  /** HTTP server operations */
  server: ServerAdapter;

  serve(
    handler: (request: Request) => Promise<Response> | Response,
    options: ServeOptions,
  ): Promise<Server>;

  /** Shell operations (sync fs for CLI) */
  shell?: ShellAdapter;

  /** Key-value store (Cloudflare KV, Deno KV) */
  kv?: KVStoreAdapter;

  /** File watcher (not available on Workers) */
  watcher?: FileWatcherAdapter;

  /** Initialize the adapter (called once before first use) */
  initialize?(): Promise<void>;

  /** Clean shutdown (close connections, etc.) */
  shutdown?(): Promise<void>;
}

/**
 * Realm-local imports from an already prepared graph, including its React runtime.
 * Unknown identifiers must reject without cache or network recovery.
 */
export interface RuntimeModuleLoader {
  /** Own data-property function importing an original source path or package specifier. */
  importModule(reference: RuntimeModuleReference): Promise<Record<string, unknown>>;
}

export type RuntimeModuleReference =
  | { readonly kind: "source"; readonly path: string }
  | { readonly kind: "package"; readonly specifier: string };

/**
 * Runtime capabilities for feature detection
 */
export interface RuntimeCapabilities {
  /** Native TypeScript support without compilation */
  typescript: boolean;

  /** Native JSX/TSX support */
  jsx: boolean;

  /** HTTP/2 server support */
  http2: boolean;

  /** WebSocket support */
  websocket: boolean;

  /** Web Workers / Worker threads support */
  workers: boolean;

  /** File system watching */
  fileWatching: boolean;

  /** Shell command execution */
  shell: boolean;

  /** Key-value store available */
  kvStore: boolean;

  /** Writable filesystem (false for Workers without KV) */
  writableFs: boolean;
}

export interface WebSocketUpgradeOptions {
  protocol?: string;
  headers?: Headers | Record<string, string>;
  idleTimeout?: number;
}

export interface ServerAdapter {
  upgradeWebSocket(request: Request, options?: WebSocketUpgradeOptions): WebSocketUpgrade;
}

export interface WebSocketConnection {
  readonly readyState: number;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: EventListener, options?: AddEventListenerOptions): void;
  removeEventListener(type: string, listener: EventListener): void;
}

const WEBSOCKET_UPGRADE_RESPONSE_KIND = "websocket-upgrade";

/**
 * Explicit upgrade signal used when a runtime cannot construct a native
 * `Response` with status 101.
 */
export interface WebSocketUpgradeResponse {
  readonly kind: typeof WEBSOCKET_UPGRADE_RESPONSE_KIND;
  readonly status: 101;
  readonly statusText: string;
  readonly headers: Headers;
  readonly body: null;
}

export interface WebSocketUpgrade {
  socket: WebSocketConnection;
  response: Response | WebSocketUpgradeResponse;
}

export function createWebSocketUpgradeResponse(
  input: { headers?: HeadersInit; statusText?: string } = {},
): WebSocketUpgradeResponse {
  return Object.freeze({
    kind: WEBSOCKET_UPGRADE_RESPONSE_KIND,
    status: 101,
    statusText: input.statusText ?? "Switching Protocols",
    headers: new Headers(input.headers),
    body: null,
  });
}

type DataPropertyRead =
  | { readonly readable: true; readonly value: unknown }
  | { readonly readable: false };

// A Proxy can synthesize a fresh prototype for every getPrototypeOf trap.
// Bound each structural field lookup so an upgrade discriminator can never
// turn into attacker-controlled, unbounded traversal.
const MAX_UPGRADE_RESPONSE_PROTOTYPE_DEPTH = 16;
const headersGet = Headers.prototype.get;

function readDataProperty(value: object, key: PropertyKey): DataPropertyRead {
  const visited = new Set<object>();
  let current: object | null = value;

  try {
    for (
      let depth = 0;
      current !== null && depth < MAX_UPGRADE_RESPONSE_PROTOTYPE_DEPTH;
      depth++
    ) {
      if (visited.has(current)) return { readable: false };
      visited.add(current);
      const descriptor = Reflect.getOwnPropertyDescriptor(current, key);
      if (descriptor) {
        return "value" in descriptor
          ? { readable: true, value: descriptor.value }
          : { readable: false };
      }
      current = Reflect.getPrototypeOf(current);
    }
  } catch {
    return { readable: false };
  }

  return current === null ? { readable: true, value: undefined } : { readable: false };
}

export function isWebSocketUpgradeResponse(value: unknown): value is WebSocketUpgradeResponse {
  if (typeof value !== "object" || value === null) return false;

  const kind = readDataProperty(value, "kind");
  if (!kind.readable || kind.value !== WEBSOCKET_UPGRADE_RESPONSE_KIND) return false;

  const status = readDataProperty(value, "status");
  if (!status.readable || status.value !== 101) return false;

  const statusText = readDataProperty(value, "statusText");
  if (!statusText.readable || typeof statusText.value !== "string") return false;

  const headers = readDataProperty(value, "headers");
  if (!headers.readable || typeof headers.value !== "object" || headers.value === null) {
    return false;
  }
  try {
    // A structural object with a `get()` method is not a Headers instance and
    // can run arbitrary code when the transport clones it. Invoke a captured
    // Web IDL primordial to verify the native internal slot without consulting
    // attacker-controlled properties or Symbol.hasInstance hooks.
    Reflect.apply(headersGet, headers.value, ["upgrade"]);
  } catch {
    return false;
  }

  const body = readDataProperty(value, "body");

  return body.readable && body.value === null;
}

export interface ServeOptions {
  port?: number;
  hostname?: string;
  signal?: AbortSignal;
  onListen?: (params: { hostname: string; port: number }) => void;
  /**
   * Node.js only. Called synchronously for each raw HTTP listener `error` event
   * emitted after `onListen` returns. Returned promises are observed only for
   * rejection and are not awaited by the listener or shutdown.
   */
  onRuntimeError?: (error: Error) => void | Promise<void>;
  /**
   * Node.js only. Explicitly selected implementation for completing approved
   * WebSocket upgrades. When absent, HTTP serving remains available and every
   * Node WebSocket upgrade fails closed.
   */
  nodeWebSocketServerProvider?: Readonly<NodeWebSocketServerProvider>;
}

export interface Server {
  stop(): Promise<void>;
  addr: { hostname: string; port: number };
}

export interface FileSystemAdapter {
  /**
   * Explicitly declares that paths in this adapter cannot traverse symbolic
   * links. The backing store may reject links or expose them only as inert
   * entries, but it must never resolve a path through one. Native/local
   * adapters must omit this marker and provide lstat and realPath instead.
   */
  readonly symlinkSemantics?: "none";
  /** Adapter is immutably bound to one project and needs no request scope. */
  readonly projectContextSemantics?: "fixed";
  readFile(path: string): Promise<string>;
  /** Read raw bytes when binary-safe access is required */
  readFileBytes?(path: string): Promise<Uint8Array>;
  /**
   * Fixed whole-object ceiling enforced by the backing store or transport
   * before a complete response can be materialized.
   *
   * This capability is distinct from `readFileBytesBounded`: the caller does
   * not choose the read size, and the implementation may materialize up to
   * this advertised ceiling even for a smaller file. It may be advertised
   * only alongside `readFileBytes` and only when the upstream boundary itself
   * rejects larger objects before returning them.
   */
  readonly maxWholeFileReadBytes?: number;
  /**
   * Read a prefix without materializing more than `byteLimit` bytes.
   *
   * Implementations must enforce the limit while reading from their backing
   * store and continue until EOF or `byteLimit`; reading the complete object
   * and slicing afterward does not satisfy this capability. Callers can
   * request their accepted maximum plus one byte to distinguish an exact-size
   * file from an oversized file. Non-native adapters used for bounded Skill
   * discovery or strict Skill runtime reads must implement this capability.
   */
  readFileBytesBounded?(path: string, byteLimit: number): Promise<Uint8Array>;
  /**
   * Read the complete file only when it is no larger than `byteLimit`.
   *
   * Implementations must enforce the limit while reading and reject when the
   * source has even one additional byte. They must not implement this by
   * materializing the whole object or by retaining a `byteLimit + 1` prefix.
   * Oversized sources reject with `RangeError`; other I/O failures propagate.
   */
  readFileBytesWithinLimit?(path: string, byteLimit: number): Promise<Uint8Array>;
  /**
   * Read one stable file snapshot beneath `containmentRoot` without following
   * links and only when its complete contents fit within `byteLimit`.
   */
  readFileSnapshotWithinLimit?(
    path: string,
    containmentRoot: string,
    byteLimit: number,
  ): Promise<Uint8Array>;
  writeFile(path: string, content: string): Promise<void>;
  /** Write raw bytes when binary-safe output is required. */
  writeFileBytes?(path: string, content: Uint8Array): Promise<void>;
  /** Create a new byte file without replacing an existing path. */
  createFileBytesExclusive?(path: string, content: Uint8Array): Promise<void>;
  /** Atomically replace a path when the runtime supports same-filesystem rename. */
  rename?(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  readDir(path: string): AsyncIterable<DirEntry>;
  stat(path: string): Promise<FileInfo>;
  /**
   * Stat a path WITHOUT following a terminal symlink (lstat semantics).
   * Unlike stat(), which follows symlinks and therefore always reports
   * isSymlink:false for a link, this reports isSymlink:true for the link
   * itself. Used by path validation to detect symlink escapes. Optional:
   * virtual/remote filesystems that have no OS-level symlinks may omit it.
   */
  lstat?(path: string): Promise<FileInfo>;
  /**
   * Resolve a path to its canonical physical form, following all symlinks.
   * Used by path validation to check containment against the real target so a
   * symlink whose target escapes the base directory can be rejected. Throws if
   * the path does not exist. Optional: virtual/remote filesystems that have no
   * OS-level symlinks may omit it.
   */
  realPath?(path: string): Promise<string>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  makeTempDir(prefix: string): Promise<string>;
  watch(paths: string | string[], options?: WatchOptions): FileWatcher;
  /** Resolve a file path with extension fallback (e.g., pages/test → pages/test.mdx) */
  resolveFile?(basePath: string, options?: ResolveFileOptions): Promise<string | null>;
  /** Refresh remote source snapshots when a preview render detects stale cached content. */
  refreshSourceSnapshot?(reason?: string): Promise<void>;
  /**
   * Confirm that a mutable remote source snapshot is within its freshness
   * lease, coalescing the network check across concurrent requests.
   */
  ensureSourceSnapshotFresh?(
    reason?: string,
    options?: SourceSnapshotFreshnessOptions,
  ): Promise<void>;
  /**
   * Contract version for `ensureSourceSnapshotFresh` options. Version 1 means
   * the adapter honors `maxAgeMs`, including zero as an unconditional refresh.
   * Omission preserves compatibility with legacy one-argument implementations.
   * Define this as an own, non-accessor data property, for example
   * `readonly sourceSnapshotFreshnessOptionsVersion = 1 as const`.
   * `FSAdapterWrapper` rejects inherited and accessor markers without invoking
   * them, so a strict document render fails closed rather than trusting a
   * dynamically computed capability.
   */
  readonly sourceSnapshotFreshnessOptionsVersion?: 1;
  /**
   * Monotonic generation for the active source snapshot. Consumers can retain
   * derived state while this value is unchanged.
   */
  getSourceSnapshotVersion?(): number | undefined | Promise<number | undefined>;
  /** Stable content digest for the active source snapshot. */
  getSourceSnapshotFingerprint?(): string | undefined | Promise<string | undefined>;
  /**
   * Stable name for the source context the snapshot currently targets, such
   * as the bound project/branch, environment, or release. Per-request context
   * changes on a reused adapter (for example `setRequestBranch`) change this
   * value, so a caller that established freshness earlier in the request can
   * detect that the establishment no longer describes the context it is about
   * to read from. `undefined` means the adapter cannot name its context, and
   * callers must not carry freshness across a possible context change.
   */
  getSourceSnapshotIdentity?(): string | undefined | Promise<string | undefined>;
}

/** A filesystem adapter that advertises genuine bounded byte reads. */
export type BoundedFileSystemAdapter =
  & FileSystemAdapter
  & Required<Pick<FileSystemAdapter, "readFileBytesBounded">>;

/** A filesystem adapter that can return only complete, size-admitted files. */
export type ExactBoundedFileSystemAdapter =
  & FileSystemAdapter
  & Required<Pick<FileSystemAdapter, "readFileBytesWithinLimit">>;

export interface ResolveFileOptions {
  allowPagesPrefix?: boolean;
}

/** How current the caller needs a mutable source snapshot to be. */
export interface SourceSnapshotFreshnessOptions {
  /**
   * Oldest freshness check the caller will accept, in milliseconds. The
   * adapter re-establishes the snapshot from the source authority when its
   * last check is older than this. `0` (like any non-positive value) refuses
   * every existing lease and always re-establishes, which is what a document
   * render needs, because the snapshot it serves is the one hydration compares
   * against. Callers that omit it accept the adapter's default lease, which
   * keeps sub-resource requests inside a single page load from each re-listing
   * the source tree.
   *
   * `0` is not an absolute read-your-writes guarantee. Re-establishment is
   * singleflighted, so a strict caller arriving while a refresh is already in
   * flight joins it and observes the listing that refresh issued, which can
   * predate an edit made after that refresh started. The exposure is one
   * source round trip rather than the whole default lease.
   */
  maxAgeMs?: number;
}

export interface DirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
}

export interface FileInfo {
  size: number;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  mtime: Date | null;
}

export interface EnvironmentAdapter {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  toObject(): Record<string, string>;
}

export interface WatchOptions {
  recursive?: boolean;
  signal?: AbortSignal;
}

export type FileChangeKind = "create" | "modify" | "delete" | "any";

export interface FileChangeEvent {
  kind: FileChangeKind;
  paths: string[];
}

export interface FileWatcher extends AsyncIterable<FileChangeEvent> {
  close(): void;
  /**
   * Resolves once the underlying watcher has been installed and can observe
   * subsequent filesystem changes. Rejects when any requested watch root
   * cannot be acquired; callers must not advertise watching before it resolves.
   */
  ready?: Promise<void>;
  /**
   * Resolves once the watcher's internal loop has fully stopped, including
   * any in-flight filesystem operations. close() only signals shutdown;
   * await this to guarantee no pending async ops remain (e.g. before test
   * sanitizer checks or process exit). Rejects when the native watcher fails
   * or teardown cannot complete cleanly.
   */
  done?: Promise<void>;
}

export interface ShellAdapter {
  statSync(path: string): { isFile: boolean; isDirectory: boolean };
  readFileSync(path: string): string;
}

/**
 * Key-value store adapter for Cloudflare KV, Deno KV, etc.
 */
export interface KVStoreAdapter {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): AsyncIterable<string>;
}

/**
 * File watcher adapter for development mode
 */
export interface FileWatcherAdapter {
  watch(paths: string | string[], options?: WatchOptions): FileWatcher;
}
