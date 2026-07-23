export interface BunFile {
  text(): Promise<string>;
  exists(): Promise<boolean>;
  size: number;
}

export interface BunServeOptions {
  port?: number;
  hostname?: string;
  fetch(
    request: Request,
    server: BunServer,
  ): Promise<Response | undefined> | Response | undefined;
  websocket?: {
    idleTimeout?: number;
    open?(socket: BunServerWebSocket): void;
    message?(socket: BunServerWebSocket, message: string | ArrayBuffer | Uint8Array): void;
    close?(socket: BunServerWebSocket, code: number, reason: string): void;
    error?(socket: BunServerWebSocket, error: unknown): void;
  };
}

export interface BunServer {
  stop(closeActiveConnections?: boolean): Promise<void> | void;
  port: number | undefined;
  hostname: string | undefined;
  upgrade(
    request: Request,
    options?: { data?: unknown; headers?: HeadersInit },
  ): boolean;
}

export interface BunServerWebSocket {
  data?: unknown;
  send(data: string | ArrayBuffer): number;
  close(code?: number, reason?: string): void;
}

export interface BunFSWatcher {
  close(): void;
  stop(): void;
}

export interface BunWatchOptions {
  recursive?: boolean;
  onChange?: (event: BunWatchEvent) => void;
}

export interface BunWatchEvent {
  type: string;
  path: string;
}

export interface BunNamespace {
  file(path: string): BunFile;
  write(path: string, content: string): Promise<number>;
  serve(options: BunServeOptions): BunServer;
  watch(path: string, options: BunWatchOptions): BunFSWatcher;
  env: Record<string, string>;
}

declare global {
  const Bun: BunNamespace;
}
