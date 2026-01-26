export { DevServer } from "./server.js";
export { OptimizedFileWatcher } from "./file-watcher.js";
export async function createDevServer(options) {
    const { DevServer } = await import("./server.js");
    const server = new DevServer(options);
    await server.start();
    return server;
}
