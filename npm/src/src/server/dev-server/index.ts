export { DevServer } from "./server.js";
export { OptimizedFileWatcher } from "./file-watcher.js";
export type { DevServerOptions, FileWatcherMetrics, RouteDirectory } from "./types.js";

export async function createDevServer(
  options: import("./types.js").DevServerOptions,
): Promise<import("./server.js").DevServer> {
  const { DevServer } = await import("./server.js");
  const server = new DevServer(options);
  await server.start();
  return server;
}
