import * as dntShim from "../../../../../_dnt.shims.js";
import { createError, toError } from "../../../../errors/index.js";
import { join } from "../../../compat/path/index.js";
import { serverLogger } from "../../../../utils/index.js";
import { getEnvOverlayStorage } from "../../../compat/process.js";
import { createFileWatcher, createWatcherIterator, enqueueWatchEvent, } from "../shared/watcher-queue.js";
/** Default server port. Defined locally to keep adapters module isolated. */
const DEFAULT_PORT = 3000;
const DEFAULT_POLL_INTERVAL_MS = 200;
function toSnapshotEntry(info) {
    return {
        mtimeMs: info.mtime?.getTime() ?? 0,
        size: info.size,
    };
}
async function collectPathSnapshot(path, recursive, snapshot) {
    let info;
    try {
        info = await dntShim.Deno.stat(path);
    }
    catch {
        return;
    }
    if (info.isFile) {
        snapshot.set(path, toSnapshotEntry(info));
        return;
    }
    if (!info.isDirectory)
        return;
    try {
        for await (const entry of dntShim.Deno.readDir(path)) {
            const entryPath = join(path, entry.name);
            if (entry.isDirectory) {
                if (recursive)
                    await collectPathSnapshot(entryPath, recursive, snapshot);
                continue;
            }
            if (!entry.isFile && !entry.isSymlink)
                continue;
            try {
                const entryInfo = await dntShim.Deno.stat(entryPath);
                if (entryInfo.isFile)
                    snapshot.set(entryPath, toSnapshotEntry(entryInfo));
            }
            catch {
                // Ignore files that disappear during traversal
            }
        }
    }
    catch {
        // Ignore readDir failures (e.g., permission or transient removal)
    }
}
async function collectFileSnapshot(paths, recursive) {
    const snapshot = new Map();
    for (const path of paths) {
        await collectPathSnapshot(path, recursive, snapshot);
    }
    return snapshot;
}
function diffSnapshots(prev, next) {
    const events = [];
    for (const [path, nextEntry] of next) {
        const prevEntry = prev.get(path);
        if (!prevEntry) {
            events.push({ kind: "create", paths: [path] });
            continue;
        }
        if (nextEntry.mtimeMs !== prevEntry.mtimeMs || nextEntry.size !== prevEntry.size) {
            events.push({ kind: "modify", paths: [path] });
        }
    }
    for (const path of prev.keys()) {
        if (!next.has(path))
            events.push({ kind: "delete", paths: [path] });
    }
    return events;
}
class DenoFileSystemAdapter {
    assertDeno(method) {
        if (typeof dntShim.Deno === "undefined") {
            throw new Error(`DenoFileSystemAdapter.${method}() can only be used in Deno runtime`);
        }
    }
    async readFile(path) {
        this.assertDeno("readFile");
        return await dntShim.Deno.readTextFile(path);
    }
    async readFileBytes(path) {
        this.assertDeno("readFileBytes");
        return await dntShim.Deno.readFile(path);
    }
    async writeFile(path, content) {
        this.assertDeno("writeFile");
        await dntShim.Deno.writeTextFile(path, content);
    }
    async exists(path) {
        if (typeof dntShim.Deno === "undefined")
            return false;
        try {
            await dntShim.Deno.stat(path);
            return true;
        }
        catch {
            return false;
        }
    }
    async *readDir(path) {
        this.assertDeno("readDir");
        for await (const entry of dntShim.Deno.readDir(path)) {
            yield {
                name: entry.name,
                isFile: entry.isFile,
                isDirectory: entry.isDirectory,
                isSymlink: entry.isSymlink,
            };
        }
    }
    async stat(path) {
        this.assertDeno("stat");
        const stat = await dntShim.Deno.stat(path);
        return {
            size: stat.size,
            isFile: stat.isFile,
            isDirectory: stat.isDirectory,
            isSymlink: stat.isSymlink,
            mtime: stat.mtime,
        };
    }
    async mkdir(path, options) {
        this.assertDeno("mkdir");
        await dntShim.Deno.mkdir(path, options);
    }
    async remove(path, options) {
        this.assertDeno("remove");
        await dntShim.Deno.remove(path, options);
    }
    async makeTempDir(prefix) {
        this.assertDeno("makeTempDir");
        return await dntShim.Deno.makeTempDir({ prefix });
    }
    watch(paths, options) {
        this.assertDeno("watch");
        const pathArray = Array.isArray(paths) ? paths : [paths];
        const recursive = options?.recursive ?? true;
        const signal = options?.signal;
        const pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
        let closed = false;
        const eventQueue = [];
        let resolver = null;
        const iterator = createWatcherIterator(eventQueue, (r) => {
            resolver = r;
        }, () => closed, () => signal?.aborted ?? false);
        const cleanup = () => {
            if (closed)
                return;
            closed = true;
            resolver?.({ done: true, value: undefined });
            resolver = null;
        };
        const pollLoop = async () => {
            let snapshot = new Map();
            try {
                snapshot = await collectFileSnapshot(pathArray, recursive);
            }
            catch (error) {
                serverLogger.debug("[Deno] Initial file snapshot failed", { error });
            }
            while (!closed && !signal?.aborted) {
                await new Promise((resolve) => dntShim.setTimeout(resolve, pollIntervalMs));
                if (closed || signal?.aborted)
                    break;
                let nextSnapshot;
                try {
                    nextSnapshot = await collectFileSnapshot(pathArray, recursive);
                }
                catch (error) {
                    serverLogger.debug("[Deno] File snapshot failed", { error });
                    continue;
                }
                const events = diffSnapshots(snapshot, nextSnapshot);
                snapshot = nextSnapshot;
                for (const event of events) {
                    enqueueWatchEvent(event, eventQueue, () => resolver, (r) => {
                        resolver = r;
                    });
                }
            }
        };
        signal?.addEventListener("abort", cleanup);
        void pollLoop();
        return createFileWatcher(iterator, cleanup);
    }
}
class DenoEnvironmentAdapter {
    get(key) {
        // Check both Deno and Deno.env exist to handle partial mocks
        if (typeof dntShim.Deno === "undefined" || typeof dntShim.Deno.env === "undefined")
            return undefined;
        return dntShim.Deno.env.get(key);
    }
    set(key, value) {
        if (typeof dntShim.Deno === "undefined" || typeof dntShim.Deno.env === "undefined") {
            throw new Error("DenoEnvironmentAdapter.set() can only be used in Deno runtime");
        }
        dntShim.Deno.env.set(key, value);
    }
    toObject() {
        if (typeof dntShim.Deno === "undefined" || typeof dntShim.Deno.env === "undefined")
            return {};
        return dntShim.Deno.env.toObject();
    }
}
class DenoServerAdapter {
    upgradeWebSocket(request) {
        if (typeof dntShim.Deno === "undefined") {
            throw new Error("DenoServerAdapter.upgradeWebSocket() can only be used in Deno runtime");
        }
        const { socket, response } = dntShim.Deno.upgradeWebSocket(request);
        return { socket, response };
    }
}
class DenoShellAdapter {
    statSync(path) {
        if (typeof dntShim.Deno === "undefined") {
            throw new Error("DenoShellAdapter.statSync() can only be used in Deno runtime");
        }
        try {
            const stat = dntShim.Deno.statSync(path);
            return { isFile: stat.isFile, isDirectory: stat.isDirectory };
        }
        catch (error) {
            throw toError(createError({
                type: "file",
                message: `Failed to stat file: ${error}`,
            }));
        }
    }
    readFileSync(path) {
        if (typeof dntShim.Deno === "undefined") {
            throw new Error("DenoShellAdapter.readFileSync() can only be used in Deno runtime");
        }
        try {
            return dntShim.Deno.readTextFileSync(path);
        }
        catch (error) {
            throw toError(createError({
                type: "file",
                message: `Failed to read file: ${error}`,
            }));
        }
    }
}
class DenoServer {
    server;
    hostname;
    port;
    abortController;
    constructor(server, hostname, port, abortController) {
        this.server = server;
        this.hostname = hostname;
        this.port = port;
        this.abortController = abortController;
    }
    async stop() {
        try {
            this.abortController?.abort();
            await this.server.shutdown();
        }
        catch (error) {
            serverLogger.debug("[Deno] Server shutdown failed", { error });
        }
    }
    get addr() {
        return { hostname: this.hostname, port: this.port };
    }
}
export class DenoAdapter {
    id = "deno";
    name = "deno";
    fs = new DenoFileSystemAdapter();
    env = new DenoEnvironmentAdapter();
    server = new DenoServerAdapter();
    shell = new DenoShellAdapter();
    capabilities = {
        typescript: true,
        jsx: true,
        http2: true,
        websocket: true,
        workers: true,
        fileWatching: true,
        shell: true,
        kvStore: true,
        writableFs: true,
    };
    activeServer = null;
    serve(handler, options = {}) {
        if (typeof dntShim.Deno === "undefined") {
            throw new Error("DenoAdapter.serve() can only be used in Deno runtime");
        }
        const { port = DEFAULT_PORT, hostname = "localhost", onListen } = options;
        const controller = new AbortController();
        const signal = options.signal || controller.signal;
        const envOverlay = getEnvOverlayStorage();
        const envStore = envOverlay?.getStore();
        let wrappedHandler = handler;
        if (envOverlay && envStore) {
            wrappedHandler = (request) => {
                if (envOverlay.run)
                    return envOverlay.run(envStore, () => handler(request));
                envOverlay.enterWith?.(envStore);
                return handler(request);
            };
        }
        const server = dntShim.Deno.serve({
            port,
            hostname,
            signal,
            handler: async (request) => {
                try {
                    return await wrappedHandler(request);
                }
                catch (error) {
                    serverLogger.error("Request handler error:", error);
                    return new dntShim.Response("Internal Server Error", { status: 500 });
                }
            },
            onListen: (params) => {
                onListen?.({ hostname: params.hostname, port: params.port });
            },
        });
        const controllerToPass = options.signal ? undefined : controller;
        this.activeServer = new DenoServer(server, hostname, port, controllerToPass);
        return Promise.resolve(this.activeServer);
    }
    async shutdown() {
        if (!this.activeServer)
            return;
        await this.activeServer.stop();
        this.activeServer = null;
    }
}
export const denoAdapter = new DenoAdapter();
