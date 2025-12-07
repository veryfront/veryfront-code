import { createError, toError } from "../../core/errors/veryfront-error.ts";
import type {
  DirEntry,
  EnvironmentAdapter,
  FileChangeEvent,
  FileChangeKind,
  FileInfo,
  FileSystemAdapter,
  FileWatcher,
  RuntimeAdapter,
  RuntimeFeatures,
  ServeOptions,
  Server,
  ServerAdapter,
  ShellAdapter,
  WatchOptions,
  WebSocketUpgrade,
} from "./base.ts";
import { DEFAULT_PORT } from "@veryfront/config";
import { serverLogger } from "@veryfront/utils";

class DenoFileSystemAdapter implements FileSystemAdapter {
  async readFile(path: string): Promise<string> {
    return await Deno.readTextFile(path);
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    return await Deno.readFile(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    await Deno.writeTextFile(path, content);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await Deno.stat(path);
      return true;
    } catch (_error) {
      return false;
    }
  }

  async *readDir(path: string): AsyncIterable<DirEntry> {
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
    await Deno.mkdir(path, options);
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    await Deno.remove(path, options);
  }

  async makeTempDir(prefix: string): Promise<string> {
    return await Deno.makeTempDir({ prefix });
  }

  watch(paths: string | string[], options?: WatchOptions): FileWatcher {
    const pathArray = Array.isArray(paths) ? paths : [paths];
    const recursive = options?.recursive ?? true;
    const signal = options?.signal;

    const watcher = Deno.watchFs(pathArray, { recursive });
    let closed = false;

    const denoIterator = watcher[Symbol.asyncIterator]();

    const mapEventKind = (kind: string): FileChangeKind => {
      switch (kind) {
        case "create":
          return "create";
        case "modify":
          return "modify";
        case "remove":
          return "delete";
        default:
          return "any";
      }
    };

    const iterator: AsyncIterator<FileChangeEvent> = {
      async next(): Promise<IteratorResult<FileChangeEvent>> {
        if (closed || signal?.aborted) {
          return { done: true, value: undefined };
        }

        try {
          const result = await denoIterator.next();
          if (result.done) {
            return { done: true, value: undefined };
          }

          return {
            done: false,
            value: {
              kind: mapEventKind(result.value.kind),
              paths: result.value.paths,
            },
          };
        } catch (error) {
          if (closed || signal?.aborted) {
            return { done: true, value: undefined };
          }
          throw error;
        }
      },

      async return(): Promise<IteratorResult<FileChangeEvent>> {
        closed = true;
        if (denoIterator.return) {
          await denoIterator.return();
        }
        return { done: true, value: undefined };
      },
    };

    const cleanup = () => {
      if (closed) return;
      closed = true;
      try {
        if ("close" in watcher && typeof watcher.close === "function") {
          watcher.close();
        }
      } catch (error) {
        serverLogger.debug("[Deno] Filesystem watcher cleanup failed", { error });
      }
    };

    if (signal) {
      signal.addEventListener("abort", cleanup);
    }

    return {
      [Symbol.asyncIterator]() {
        return iterator;
      },
      close: cleanup,
    };
  }
}

class DenoEnvironmentAdapter implements EnvironmentAdapter {
  get(key: string): string | undefined {
    return Deno.env.get(key);
  }

  set(key: string, value: string): void {
    Deno.env.set(key, value);
  }

  toObject(): Record<string, string> {
    return Deno.env.toObject();
  }
}

class DenoServerAdapter implements ServerAdapter {
  upgradeWebSocket(request: Request): WebSocketUpgrade {
    const { socket, response } = Deno.upgradeWebSocket(request);
    return { socket, response };
  }
}

class DenoShellAdapter implements ShellAdapter {
  statSync(path: string): { isFile: boolean; isDirectory: boolean } {
    try {
      const stat = Deno.statSync(path);
      return {
        isFile: stat.isFile,
        isDirectory: stat.isDirectory,
      };
    } catch (error) {
      throw toError(createError({
        type: "file",
        message: `Failed to stat file: ${error}`,
      }));
    }
  }

  readFileSync(path: string): string {
    try {
      return Deno.readTextFileSync(path);
    } catch (error) {
      throw toError(createError({
        type: "file",
        message: `Failed to read file: ${error}`,
      }));
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
      if (this.abortController) {
        this.abortController.abort();
      }

      await this.server.shutdown();
    } catch (error) {
      serverLogger.debug("[Deno] Server shutdown failed", { error });
    }
  }

  get addr() {
    return { hostname: this.hostname, port: this.port };
  }
}

export class DenoAdapter implements RuntimeAdapter {
  readonly id = "deno" as const;
  readonly name = "deno";
  /** @deprecated Use `id` instead */
  readonly platform = "deno" as const;

  fs = new DenoFileSystemAdapter();
  env = new DenoEnvironmentAdapter();
  server = new DenoServerAdapter();
  shell = new DenoShellAdapter();

  readonly capabilities = {
    typescript: true,
    jsx: true,
    http2: true,
    websocket: true,
    workers: true,
    fileWatching: true,
    shell: true,
    kvStore: true, // Deno KV available
    writableFs: true,
  };

  /** @deprecated Use `capabilities` instead */
  readonly features: RuntimeFeatures = {
    websocket: true,
    http2: true,
    workers: true,
    jsx: true,
    typescript: true,
  };

  serve(
    handler: (request: Request) => Promise<Response> | Response,
    options: ServeOptions = {},
  ): Promise<Server> {
    const { port = DEFAULT_PORT, hostname = "localhost", onListen } = options;

    const controller = new AbortController();
    const signal = options.signal || controller.signal;

    const server = Deno.serve({
      port,
      hostname,
      signal,
      handler: async (request, _info) => {
        try {
          return await handler(request);
        } catch (error) {
          const { serverLogger } = await import("@veryfront/utils");
          serverLogger.error("Request handler error:", error);
          return new Response("Internal Server Error", { status: 500 });
        }
      },
      onListen: (params) => {
        onListen?.({ hostname: params.hostname, port: params.port });
      },
    });

    const controllerToPass = options.signal ? undefined : controller;
    return Promise.resolve(new DenoServer(server, hostname, port, controllerToPass));
  }
}

export const denoAdapter = new DenoAdapter();
