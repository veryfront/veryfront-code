import { createError, toError } from "#veryfront/errors";
import { join } from "#veryfront/compat/path";
import type {
  DirEntry,
  EnvironmentAdapter,
  FileChangeEvent,
  FileInfo,
  FileSystemAdapter,
  FileWatcher,
  RuntimeAdapter,
  ServeOptions,
  Server,
  ServerAdapter,
  ShellAdapter,
  WatchOptions,
  WebSocketUpgrade,
} from "../../base.ts";
import { serverLogger } from "#veryfront/utils";
import { getEnvOverlayStorage } from "../../../compat/process.ts";
import {
  createFileWatcher,
  createWatcherIterator,
  enqueueWatchEvent,
} from "../shared/watcher-queue.ts";
import { stopManagedServer } from "../shared/server-lifecycle.ts";

/** Default server port. Defined locally to keep adapters module isolated. */
const DEFAULT_PORT = 3000;
const DEFAULT_POLL_INTERVAL_MS = 200;

type FileSnapshotEntry = {
  mtimeMs: number;
  size: number;
};

function assertDenoRuntime(adapterName: string, method: string): void {
  if (typeof Deno === "undefined") {
    throw new Error(`${adapterName}.${method}() can only be used in Deno runtime`);
  }
}

function toSnapshotEntry(info: Deno.FileInfo): FileSnapshotEntry {
  return {
    mtimeMs: info.mtime?.getTime() ?? 0,
    size: info.size,
  };
}

async function collectPathSnapshot(
  path: string,
  recursive: boolean,
  snapshot: Map<string, FileSnapshotEntry>,
): Promise<void> {
  let info: Deno.FileInfo;
  try {
    info = await Deno.stat(path);
  } catch {
    return;
  }

  if (info.isFile) {
    snapshot.set(path, toSnapshotEntry(info));
    return;
  }

  if (!info.isDirectory) return;

  try {
    for await (const entry of Deno.readDir(path)) {
      const entryPath = join(path, entry.name);

      if (entry.isDirectory) {
        if (recursive) await collectPathSnapshot(entryPath, recursive, snapshot);
        continue;
      }

      if (!entry.isFile && !entry.isSymlink) continue;

      try {
        const entryInfo = await Deno.stat(entryPath);
        if (entryInfo.isFile) snapshot.set(entryPath, toSnapshotEntry(entryInfo));
      } catch {
        // Ignore files that disappear during traversal
      }
    }
  } catch {
    // Ignore readDir failures (e.g., permission or transient removal)
  }
}

async function collectFileSnapshot(
  paths: string[],
  recursive: boolean,
): Promise<Map<string, FileSnapshotEntry>> {
  const snapshot = new Map<string, FileSnapshotEntry>();
  for (const path of paths) {
    await collectPathSnapshot(path, recursive, snapshot);
  }
  return snapshot;
}

function diffSnapshots(
  prev: Map<string, FileSnapshotEntry>,
  next: Map<string, FileSnapshotEntry>,
): FileChangeEvent[] {
  const events: FileChangeEvent[] = [];

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
    if (!next.has(path)) events.push({ kind: "delete", paths: [path] });
  }

  return events;
}

class DenoFileSystemAdapter implements FileSystemAdapter {
  async readFile(path: string): Promise<string> {
    assertDenoRuntime("DenoFileSystemAdapter", "readFile");
    return Deno.readTextFile(path);
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    assertDenoRuntime("DenoFileSystemAdapter", "readFileBytes");
    return Deno.readFile(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    assertDenoRuntime("DenoFileSystemAdapter", "writeFile");
    await Deno.writeTextFile(path, content);
  }

  async exists(path: string): Promise<boolean> {
    if (typeof Deno === "undefined") return false;
    try {
      await Deno.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  async *readDir(path: string): AsyncIterable<DirEntry> {
    assertDenoRuntime("DenoFileSystemAdapter", "readDir");
    for await (const entry of Deno.readDir(path)) {
      yield {
        name: entry.name,
        isFile: entry.isFile,
        isDirectory: entry.isDirectory,
        isSymlink: entry.isSymlink,
      };
    }
  }

  async stat(path: string): Promise<FileInfo> {
    assertDenoRuntime("DenoFileSystemAdapter", "stat");
    const stat = await Deno.stat(path);
    return {
      size: stat.size,
      isFile: stat.isFile,
      isDirectory: stat.isDirectory,
      isSymlink: stat.isSymlink,
      mtime: stat.mtime,
    };
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    assertDenoRuntime("DenoFileSystemAdapter", "mkdir");
    await Deno.mkdir(path, options);
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    assertDenoRuntime("DenoFileSystemAdapter", "remove");
    await Deno.remove(path, options);
  }

  async makeTempDir(prefix: string): Promise<string> {
    assertDenoRuntime("DenoFileSystemAdapter", "makeTempDir");
    return Deno.makeTempDir({ prefix });
  }

  watch(paths: string | string[], options?: WatchOptions): FileWatcher {
    assertDenoRuntime("DenoFileSystemAdapter", "watch");

    const pathArray = Array.isArray(paths) ? paths : [paths];
    const recursive = options?.recursive ?? true;
    const signal = options?.signal;
    const pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;

    let closed = false;
    const eventQueue: FileChangeEvent[] = [];
    let resolver: ((value: IteratorResult<FileChangeEvent>) => void) | null = null;

    const iterator = createWatcherIterator(
      eventQueue,
      (r) => {
        resolver = r;
      },
      () => closed,
      () => signal?.aborted ?? false,
    );

    const cleanup = (): void => {
      if (closed) return;
      closed = true;

      resolver?.({ done: true, value: undefined });
      resolver = null;
    };

    const pollLoop = async (): Promise<void> => {
      let snapshot = new Map<string, FileSnapshotEntry>();
      try {
        snapshot = await collectFileSnapshot(pathArray, recursive);
      } catch (error) {
        serverLogger.debug("[Deno] Initial file snapshot failed", { error });
      }

      while (!closed && !signal?.aborted) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        if (closed || signal?.aborted) break;

        let nextSnapshot: Map<string, FileSnapshotEntry>;
        try {
          nextSnapshot = await collectFileSnapshot(pathArray, recursive);
        } catch (error) {
          serverLogger.debug("[Deno] File snapshot failed", { error });
          continue;
        }

        const events = diffSnapshots(snapshot, nextSnapshot);
        snapshot = nextSnapshot;

        for (const event of events) {
          enqueueWatchEvent(
            event,
            eventQueue,
            () => resolver,
            (r) => {
              resolver = r;
            },
          );
        }
      }
    };

    signal?.addEventListener("abort", cleanup);
    void pollLoop();

    return createFileWatcher(iterator, cleanup);
  }
}

class DenoEnvironmentAdapter implements EnvironmentAdapter {
  get(key: string): string | undefined {
    if (typeof Deno === "undefined" || typeof Deno.env === "undefined") return undefined;
    return Deno.env.get(key);
  }

  set(key: string, value: string): void {
    if (typeof Deno === "undefined" || typeof Deno.env === "undefined") {
      throw new Error("DenoEnvironmentAdapter.set() can only be used in Deno runtime");
    }
    Deno.env.set(key, value);
  }

  toObject(): Record<string, string> {
    if (typeof Deno === "undefined" || typeof Deno.env === "undefined") return {};
    return Deno.env.toObject();
  }
}

class DenoServerAdapter implements ServerAdapter {
  upgradeWebSocket(request: Request): WebSocketUpgrade {
    if (typeof Deno === "undefined") {
      throw new Error("DenoServerAdapter.upgradeWebSocket() can only be used in Deno runtime");
    }
    const { socket, response } = Deno.upgradeWebSocket(request);
    return { socket, response };
  }
}

class DenoShellAdapter implements ShellAdapter {
  statSync(path: string): { isFile: boolean; isDirectory: boolean } {
    assertDenoRuntime("DenoShellAdapter", "statSync");
    try {
      const stat = Deno.statSync(path);
      return { isFile: stat.isFile, isDirectory: stat.isDirectory };
    } catch (error) {
      throw toError(
        createError({
          type: "file",
          message: `Failed to stat file: ${error}`,
        }),
      );
    }
  }

  readFileSync(path: string): string {
    assertDenoRuntime("DenoShellAdapter", "readFileSync");
    try {
      return Deno.readTextFileSync(path);
    } catch (error) {
      throw toError(
        createError({
          type: "file",
          message: `Failed to read file: ${error}`,
        }),
      );
    }
  }
}

class DenoServer implements Server {
  constructor(
    private server: Deno.HttpServer,
    private hostname: string,
    private port: number,
    private abortController?: AbortController,
  ) {}

  async stop(): Promise<void> {
    try {
      this.abortController?.abort();
      await this.server.shutdown();
    } catch (error) {
      serverLogger.debug("[Deno] Server shutdown failed", { error });
    }
  }

  get addr(): { hostname: string; port: number } {
    return { hostname: this.hostname, port: this.port };
  }
}

export class DenoAdapter implements RuntimeAdapter {
  readonly id = "deno" as const;
  readonly name = "deno";
  readonly fs = new DenoFileSystemAdapter();
  readonly env = new DenoEnvironmentAdapter();
  readonly server = new DenoServerAdapter();
  readonly shell = new DenoShellAdapter();

  readonly capabilities = {
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

  private activeServer: DenoServer | null = null;

  serve(
    handler: (request: Request) => Promise<Response> | Response,
    options: ServeOptions = {},
  ): Promise<Server> {
    if (typeof Deno === "undefined") {
      throw new Error("DenoAdapter.serve() can only be used in Deno runtime");
    }

    const { port = DEFAULT_PORT, hostname = "localhost", onListen } = options;

    const controller = new AbortController();
    const signal = options.signal ?? controller.signal;

    const envOverlay = getEnvOverlayStorage();
    const envStore = envOverlay?.getStore();

    const wrappedHandler = envOverlay && envStore
      ? (request: Request) => {
        if (envOverlay.run) return envOverlay.run(envStore, () => handler(request));
        envOverlay.enterWith?.(envStore);
        return handler(request);
      }
      : handler;

    const server = Deno.serve({
      port,
      hostname,
      signal,
      handler: async (request) => {
        try {
          return await wrappedHandler(request);
        } catch (error) {
          serverLogger.error("Request handler error:", error);
          return new Response("Internal Server Error", { status: 500 });
        }
      },
      onListen: (params) => {
        onListen?.({ hostname: params.hostname, port: params.port });
      },
    });

    this.activeServer = new DenoServer(
      server,
      hostname,
      port,
      options.signal ? undefined : controller,
    );
    return Promise.resolve(this.activeServer);
  }

  async shutdown(): Promise<void> {
    this.activeServer = await stopManagedServer(this.activeServer);
  }
}

export const denoAdapter = new DenoAdapter();
