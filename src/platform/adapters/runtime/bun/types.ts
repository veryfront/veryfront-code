export interface BunFile {
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  bytes?(): Promise<Uint8Array>;
  exists(): Promise<boolean>;
  readonly size: number;
}

export type BunWebSocketMessage = string | ArrayBuffer | Uint8Array;

export interface BunServerWebSocket<T> {
  readonly data: T;
  readonly readyState: number;
  send(data: string | ArrayBuffer | Uint8Array): number;
  close(code?: number, reason?: string): void;
  terminate?(): void;
}

export interface BunWebSocketHandler<T> {
  readonly data?: T;
  readonly idleTimeout?: number;
  open?(socket: BunServerWebSocket<T>): void | Promise<void>;
  message(
    socket: BunServerWebSocket<T>,
    message: BunWebSocketMessage,
  ): void | Promise<void>;
  close?(
    socket: BunServerWebSocket<T>,
    code: number,
    reason: string,
  ): void | Promise<void>;
  error?(socket: BunServerWebSocket<T>, error: Error): void | Promise<void>;
}

export interface BunServeOptions<T = unknown> {
  port?: number;
  hostname?: string;
  fetch(
    request: Request,
    server: BunServer<T>,
  ): Promise<Response | undefined> | Response | undefined;
  websocket?: BunWebSocketHandler<T>;
}

export interface BunServer<T = unknown> {
  stop(closeActiveConnections?: boolean): Promise<void>;
  upgrade(
    request: Request,
    options: { data: T; headers?: HeadersInit },
  ): boolean;
  readonly port: number | undefined;
  readonly hostname: string | undefined;
}

export interface BunNamespace {
  file(path: string): BunFile;
  write(path: string, content: string | Uint8Array): Promise<number>;
  serve<T = unknown>(options: BunServeOptions<T>): BunServer<T>;
  readonly env: Record<string, string | undefined>;
}

export function getBunRuntime(): BunNamespace | undefined {
  const runtime = (globalThis as typeof globalThis & { Bun?: unknown }).Bun;
  return typeof runtime === "object" && runtime !== null ? runtime as BunNamespace : undefined;
}

/**
 * @deprecated Bun exposes the Node-compatible `node:fs` watcher API, not
 * `Bun.watch`. Use `import("node:fs").FSWatcher`.
 */
export type BunFSWatcher = import("node:fs").FSWatcher;

/**
 * @deprecated Use `import("node:fs").WatchOptions`.
 */
export type BunWatchOptions = import("node:fs").WatchOptions;

/**
 * @deprecated Use the platform `FileChangeEvent` returned by adapter.watch().
 */
export interface BunWatchEvent {
  readonly type: string;
  readonly path: string;
}
