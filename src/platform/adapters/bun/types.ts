export interface BunFile {
  text(): Promise<string>;
  exists(): Promise<boolean>;
  size: number;
}

export interface BunServeOptions {
  port?: number;
  hostname?: string;
  fetch(request: Request): Promise<Response> | Response;
}

export interface BunServer {
  stop(): void;
  port: number;
  hostname: string;
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
  upgrade(request: Request): boolean;
  watch(path: string, options: BunWatchOptions): BunFSWatcher;
  env: Record<string, string>;
}

declare global {
  // @ts-ignore - May conflict with bun-shim in test environments
  const Bun: BunNamespace;
}
