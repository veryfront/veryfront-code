/***********************
 * Runtime identifier for platform-specific code paths
 ***********************/
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
  return {
    kind: WEBSOCKET_UPGRADE_RESPONSE_KIND,
    status: 101,
    statusText: input.statusText ?? "Switching Protocols",
    headers: new Headers(input.headers),
    body: null,
  };
}

type DataPropertyRead =
  | { readonly readable: true; readonly value: unknown }
  | { readonly readable: false };

// A Proxy can synthesize a fresh prototype for every getPrototypeOf trap.
// Bound each structural field lookup so an upgrade discriminator can never
// turn into attacker-controlled, unbounded traversal.
const MAX_UPGRADE_RESPONSE_PROTOTYPE_DEPTH = 16;

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

  const body = readDataProperty(value, "body");

  return body.readable && body.value === null;
}

export interface ServeOptions {
  port?: number;
  hostname?: string;
  signal?: AbortSignal;
  onListen?: (params: { hostname: string; port: number }) => void;
}

export interface Server {
  stop(): Promise<void>;
  addr: { hostname: string; port: number };
}

export interface FileSystemAdapter {
  readFile(path: string): Promise<string>;
  /** Read raw bytes when binary-safe access is required */
  readFileBytes?(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: string): Promise<void>;
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
}

export interface ResolveFileOptions {
  allowPagesPrefix?: boolean;
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
   * Resolves once the watcher's internal loop has fully stopped, including
   * any in-flight filesystem operations. close() only signals shutdown;
   * await this to guarantee no pending async ops remain (e.g. before test
   * sanitizer checks or process exit).
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
