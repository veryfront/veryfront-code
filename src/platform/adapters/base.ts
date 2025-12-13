export type RuntimeId = "deno" | "node" | "bun" | "cloudflare" | "memory";

export interface RuntimeAdapter {
  readonly id: RuntimeId;

  readonly name: string;

  readonly platform: RuntimeId;

  readonly capabilities: RuntimeCapabilities;

  readonly features: RuntimeFeatures;

  fs: FileSystemAdapter;

  env: EnvironmentAdapter;

  server: ServerAdapter;

  serve(
    handler: (request: Request) => Promise<Response> | Response,
    options: ServeOptions,
  ): Promise<Server>;

  shell?: ShellAdapter;

  kv?: KVStoreAdapter;

  watcher?: FileWatcherAdapter;

  initialize?(): Promise<void>;

  shutdown?(): Promise<void>;
}

export interface RuntimeCapabilities {
  typescript: boolean;

  jsx: boolean;

  http2: boolean;

  websocket: boolean;

  workers: boolean;

  fileWatching: boolean;

  shell: boolean;

  kvStore: boolean;

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

export interface KVStoreAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): AsyncIterable<string>;
}

export interface FileWatcherAdapter {
  watch(paths: string | string[], options?: WatchOptions): FileWatcher;
}

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
