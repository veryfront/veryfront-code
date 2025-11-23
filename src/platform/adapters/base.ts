export interface RuntimeAdapter {
  name: string;
  platform: "deno" | "node" | "bun" | "cloudflare";
  serve(
    handler: (request: Request) => Promise<Response> | Response,
    options: ServeOptions,
  ): Promise<Server>;
  fs: FileSystemAdapter;
  env: EnvironmentAdapter;
  features: RuntimeFeatures;
  server: ServerAdapter;
  shell?: ShellAdapter; // Optional: shell adapters were deleted in previous cleanup
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
