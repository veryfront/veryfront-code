export { DevServer } from "./server.ts";
export { OptimizedFileWatcher } from "./file-watcher.ts";
export type { DevServerOptions, FileWatcherMetrics, RouteDirectory } from "./types.ts";

import type { DevServerOptions } from "./types.ts";
import type { DevServer } from "./server.ts";

export async function createDevServer(options: DevServerOptions): Promise<DevServer> {
  const { DevServer } = await import("./server.ts");
  const server = new DevServer(options);
  await server.start();
  return server;
}
