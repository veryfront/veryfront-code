export { DevServer } from "./server.ts";
export { OptimizedFileWatcher } from "./file-watcher.ts";
export type { DevServerOptions, FileWatcherMetrics, RouteDirectory } from "./types.ts";

export async function createDevServer(options: import("./types.ts").DevServerOptions) {
  const { DevServer } = await import("./server.ts");
  const server = new DevServer(options);
  await server.start();
  return server;
}
