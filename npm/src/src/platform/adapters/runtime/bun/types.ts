import * as dntShim from "../../../../../_dnt.shims.js";
export interface BunFile {
  text(): Promise<string>;
  exists(): Promise<boolean>;
  size: number;
}

export interface BunServeOptions {
  port?: number;
  hostname?: string;
  fetch(request: dntShim.Request): Promise<dntShim.Response> | dntShim.Response;
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
  upgrade(request: dntShim.Request): boolean;
  watch(path: string, options: BunWatchOptions): BunFSWatcher;
  env: Record<string, string>;
}

declare global {
  const Bun: BunNamespace;
}
