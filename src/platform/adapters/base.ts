/**
 * Runtime identifier for platform-specific code paths
 */
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

  /** @deprecated Use `id` instead */
  readonly platform: RuntimeId;

  /** Runtime capabilities for feature detection */
  readonly capabilities: RuntimeCapabilities;

  /** @deprecated Use `capabilities` instead */
  readonly features: RuntimeFeatures;

  // Core adapters (required)
  /** Filesystem operations */
  fs: FileSystemAdapter;

  /** Environment variable access */
  env: EnvironmentAdapter;

  /** HTTP server operations */
  server: ServerAdapter;

  // HTTP server
  serve(
    handler: (request: Request) => Promise<Response> | Response,
    options: ServeOptions,
  ): Promise<Server>;

  // Optional adapters
  /** Shell operations (sync fs for CLI) */
  shell?: ShellAdapter;

  /** Key-value store (Cloudflare KV, Deno KV) */
  kv?: KVStoreAdapter;

  /** File watcher (not available on Workers) */
  watcher?: FileWatcherAdapter;

  // Lifecycle hooks
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

export interface ServerAdapter {
  upgradeWebSocket(request: Request): WebSocketUpgrade;
}

export interface WebSocketUpgrade {
  socket: WebSocket;
  response: Response;
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
  exists(path: string): Promise<boolean>;
  readDir(path: string): AsyncIterable<DirEntry>;
  stat(path: string): Promise<FileInfo>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  makeTempDir(prefix: string): Promise<string>;
  watch(paths: string | string[], options?: WatchOptions): FileWatcher;
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

export interface RuntimeFeatures {
  websocket: boolean;
  http2: boolean;
  workers: boolean;
  jsx: boolean;
  typescript: boolean;
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
  set(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): AsyncIterable<string>;
}

/**
 * File watcher adapter for development mode
 */
export interface FileWatcherAdapter {
  watch(paths: string | string[], options?: WatchOptions): FileWatcher;
}

/**
 * Helper to convert RuntimeFeatures to RuntimeCapabilities
 * @deprecated For backward compatibility only
 */
export function featuresToCapabilities(features: RuntimeFeatures): RuntimeCapabilities {
  return {
    typescript: features.typescript,
    jsx: features.jsx,
    http2: features.http2,
    websocket: features.websocket,
    workers: features.workers,
    fileWatching: true, // Assume true for non-workers
    shell: true, // Assume true for non-workers
    kvStore: false, // Default false
    writableFs: true, // Assume true for non-workers
  };
}
