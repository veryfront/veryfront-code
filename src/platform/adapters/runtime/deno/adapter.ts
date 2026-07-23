import { INVALID_ARGUMENT, NOT_SUPPORTED } from "#veryfront/errors/error-registry/general.ts";
import { PORT_IN_USE, SERVER_START_ERROR } from "#veryfront/errors/error-registry/server.ts";
import { join } from "#veryfront/compat/path";
import { isWebSocketUpgradeResponse } from "../../base.ts";
import type {
  DirEntry,
  EnvironmentAdapter,
  FileChangeEvent,
  FileInfo,
  FileSystemAdapter,
  FileWatcher,
  RuntimeAdapter,
  RuntimeRequestHandler,
  ServeOptions,
  Server,
  ServerAdapter,
  ShellAdapter,
  WatchOptions,
  WebSocketConnection,
  WebSocketUpgrade,
  WebSocketUpgradeOptions,
} from "../../base.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import {
  env as getEnvObject,
  getEnv,
  getEnvOverlayStorage,
  setEnv,
} from "../../../compat/process.ts";
import { createManagedFileWatcher, normalizeWatchPaths } from "../shared/shared-watcher.ts";
import { createServerLifecycle } from "../shared/server-lifecycle.ts";
import {
  createFileOperationError,
  getSystemErrorCode,
  isFileNotFoundError,
} from "../shared/filesystem-errors.ts";
import {
  getNativeDeno,
  getNativeResponse,
  toNativeResponse,
} from "../../../compat/http/native-response.ts";
import { resolveDenoUpgradeWebSocketOptions } from "../../../compat/http/websocket.ts";
import { validateTempDirectoryPrefix } from "../../../compat/temp-dir.ts";

const logger = serverLogger.component("deno");

/** Default server port. Defined locally to keep adapters module isolated. */
const DEFAULT_PORT = 3000;
const DEFAULT_POLL_INTERVAL_MS = 200;

type FileSnapshotEntry = {
  mtimeMs: number;
  size: number;
};

function assertDenoRuntime(adapterName: string, method: string): void {
  if (typeof Deno === "undefined") {
    throw NOT_SUPPORTED.create({
      detail: `${adapterName}.${method}() can only be used in Deno runtime`,
    });
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
  } catch (error) {
    if (isFileNotFoundError(error)) return;
    throw error;
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
      } catch (error) {
        if (!isFileNotFoundError(error)) throw error;
      }
    }
  } catch (error) {
    if (!isFileNotFoundError(error)) throw error;
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
    assertDenoRuntime("DenoFileSystemAdapter", "exists");
    try {
      await Deno.stat(path);
      return true;
    } catch (error) {
      if (isFileNotFoundError(error)) return false;
      throw error;
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

  async lstat(path: string): Promise<FileInfo> {
    assertDenoRuntime("DenoFileSystemAdapter", "lstat");
    const stat = await Deno.lstat(path);
    return {
      size: stat.size,
      isFile: stat.isFile,
      isDirectory: stat.isDirectory,
      isSymlink: stat.isSymlink,
      mtime: stat.mtime,
    };
  }

  async realPath(path: string): Promise<string> {
    assertDenoRuntime("DenoFileSystemAdapter", "realPath");
    return await Deno.realPath(path);
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
    validateTempDirectoryPrefix(prefix);
    return Deno.makeTempDir({ prefix });
  }

  watch(paths: string | string[], options?: WatchOptions): FileWatcher {
    assertDenoRuntime("DenoFileSystemAdapter", "watch");

    const pathArray = normalizeWatchPaths(paths);
    const recursive = options?.recursive ?? true;
    const signal = options?.signal;
    const pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
    let wakePoll: (() => void) | null = null;

    const waitForNextPoll = (): Promise<void> => {
      return new Promise((resolve) => {
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          if (wakePoll === finish) wakePoll = null;
          resolve();
        };
        const timeoutId = setTimeout(finish, pollIntervalMs);
        wakePoll = finish;
      });
    };

    return createManagedFileWatcher({
      signal,
      overflowPaths: pathArray,
      setup: async ({ queue, isClosed }) => {
        if (isClosed()) return;
        let snapshot = await collectFileSnapshot(pathArray, recursive);

        while (!isClosed()) {
          await waitForNextPoll();
          if (isClosed()) break;

          let nextSnapshot: Map<string, FileSnapshotEntry>;
          try {
            nextSnapshot = await collectFileSnapshot(pathArray, recursive);
          } catch (error) {
            logger.debug("File snapshot failed", { code: getSystemErrorCode(error) });
            continue;
          }

          const events = diffSnapshots(snapshot, nextSnapshot);
          snapshot = nextSnapshot;
          for (const event of events) queue.enqueue(event);
        }
      },
      closeResources: () => {
        wakePoll?.();
        wakePoll = null;
      },
      onError: (error) => {
        logger.error("File watcher failed", { code: getSystemErrorCode(error) });
      },
    });
  }
}

class DenoEnvironmentAdapter implements EnvironmentAdapter {
  get(key: string): string | undefined {
    return getEnv(key);
  }

  set(key: string, value: string): void {
    setEnv(key, value);
  }

  toObject(): Record<string, string> {
    return getEnvObject();
  }
}

const denoServerByRequest = new WeakMap<Request, DenoServer>();

async function runWithDenoServerRequest<T>(
  request: Request,
  server: DenoServer,
  operation: () => Promise<T> | T,
): Promise<T> {
  denoServerByRequest.set(request, server);
  try {
    return await operation();
  } finally {
    denoServerByRequest.delete(request);
  }
}

function hasHeaders(headers: HeadersInit | undefined): boolean {
  if (!headers) return false;
  return !new Headers(headers).keys().next().done;
}

function validateDenoWebSocketOptions(
  request: Request,
  options: WebSocketUpgradeOptions | undefined,
): void {
  if (hasHeaders(options?.headers)) {
    throw NOT_SUPPORTED.create({
      message: "Deno does not support custom WebSocket upgrade headers",
    });
  }
  if (
    options?.idleTimeout !== undefined &&
    (!Number.isFinite(options.idleTimeout) || options.idleTimeout < 0)
  ) {
    throw INVALID_ARGUMENT.create({ message: "WebSocket idle timeout must be non-negative" });
  }
  if (options?.protocol) {
    const requestedProtocols = (request.headers.get("sec-websocket-protocol") ?? "")
      .split(",")
      .map((protocol) => protocol.trim())
      .filter(Boolean);
    if (!requestedProtocols.includes(options.protocol)) {
      throw INVALID_ARGUMENT.create({
        message: "The selected WebSocket protocol was not requested by the client",
      });
    }
  }
}

class DenoServerAdapter implements ServerAdapter {
  upgradeWebSocket(request: Request, options?: WebSocketUpgradeOptions): WebSocketUpgrade {
    validateDenoWebSocketOptions(request, options);
    // Access native Deno via `self` to bypass dnt shim transform.
    // dnt rewrites `globalThis.Deno` to @deno/shim-deno, which lacks upgradeWebSocket.
    const nativeDeno = getNativeDeno();
    if (typeof nativeDeno?.upgradeWebSocket !== "function") {
      throw NOT_SUPPORTED.create({
        detail: "DenoServerAdapter.upgradeWebSocket() can only be used in Deno runtime",
      });
    }
    const { socket, response } = nativeDeno.upgradeWebSocket(
      request,
      resolveDenoUpgradeWebSocketOptions(options),
    );
    denoServerByRequest.get(request)?.trackWebSocket(socket);
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
      throw createFileOperationError(error, "stat");
    }
  }

  readFileSync(path: string): string {
    assertDenoRuntime("DenoShellAdapter", "readFileSync");
    try {
      return Deno.readTextFileSync(path);
    } catch (error) {
      throw createFileOperationError(error, "read");
    }
  }
}

class DenoServer implements Server {
  private readonly webSockets = new Set<WebSocketConnection>();
  private stopPromise: Promise<void> | null = null;

  constructor(
    private readonly server: Deno.HttpServer,
    private readonly hostname: string,
    private readonly port: number,
  ) {}

  trackWebSocket(socket: WebSocketConnection): void {
    this.webSockets.add(socket);
    socket.addEventListener("close", () => this.webSockets.delete(socket), { once: true });
  }

  stop(): Promise<void> {
    if (!this.stopPromise) {
      for (const socket of this.webSockets) {
        try {
          socket.close(1001, "Server shutting down");
        } catch {
          logger.warn("Failed to close a WebSocket during shutdown");
        }
      }
      this.webSockets.clear();
      const pending = this.server.shutdown();
      const retryable = pending.catch((error) => {
        if (this.stopPromise === retryable) this.stopPromise = null;
        throw error;
      });
      this.stopPromise = retryable;
    }
    return this.stopPromise;
  }

  get addr(): { hostname: string; port: number } {
    return { hostname: this.hostname, port: this.port };
  }
}

function getErrorName(error: unknown): string | undefined {
  if ((typeof error !== "object" && typeof error !== "function") || error === null) {
    return undefined;
  }
  try {
    const name = Reflect.get(error, "name");
    return typeof name === "string" && name.length <= 64 ? name : undefined;
  } catch {
    return undefined;
  }
}

function createDenoStartupError(error: unknown): Error {
  if (getErrorName(error) === "AddrInUse" || getSystemErrorCode(error) === "EADDRINUSE") {
    return PORT_IN_USE.create({ message: "The server port is already in use", cause: error });
  }
  return SERVER_START_ERROR.create({ message: "Unable to start the Deno server", cause: error });
}

async function createDenoServer(
  handler: RuntimeRequestHandler,
  options: ServeOptions = {},
): Promise<Server> {
  if (typeof Deno === "undefined") {
    throw NOT_SUPPORTED.create({
      message: "Deno server APIs are unavailable in this runtime",
    });
  }

  const nativeDeno = getNativeDeno();
  if (!nativeDeno) {
    throw NOT_SUPPORTED.create({
      message: "Deno server APIs are unavailable in this runtime",
    });
  }

  const { port = DEFAULT_PORT, hostname = "localhost", onListen } = options;
  const envOverlay = getEnvOverlayStorage();
  const envStore = envOverlay?.getStore();
  const wrappedHandler = envOverlay && envStore
    ? (request: Request) => {
      if (envOverlay.run) return envOverlay.run(envStore, () => handler(request));
      envOverlay.enterWith?.(envStore);
      return handler(request);
    }
    : handler;
  const NativeResponse = getNativeResponse();
  const serverReference: { current?: DenoServer } = {};
  let listenAddress: { hostname: string; port: number } | undefined;
  let nativeServer: Deno.HttpServer;

  try {
    nativeServer = nativeDeno.serve({
      port,
      hostname,
      handler: async (request) => {
        try {
          const response = serverReference.current
            ? await runWithDenoServerRequest(
              request,
              serverReference.current,
              () => wrappedHandler(request),
            )
            : await wrappedHandler(request);
          if (isWebSocketUpgradeResponse(response)) {
            throw new TypeError("Deno WebSocket upgrades must return the native response");
          }
          return toNativeResponse(response, NativeResponse);
        } catch {
          logger.error("Request handler failed");
          return new NativeResponse("Internal Server Error", { status: 500 });
        }
      },
      onListen: (address) => {
        listenAddress = { hostname: address.hostname, port: address.port };
      },
    });
  } catch (error) {
    throw createDenoStartupError(error);
  }

  const nativeAddress = nativeServer.addr;
  const address = listenAddress ?? (
    "hostname" in nativeAddress && "port" in nativeAddress
      ? { hostname: nativeAddress.hostname, port: nativeAddress.port }
      : undefined
  );
  if (
    !address || typeof address.hostname !== "string" || address.hostname.length === 0 ||
    !Number.isInteger(address.port) || address.port <= 0 || address.port > 65_535
  ) {
    await nativeServer.shutdown();
    throw SERVER_START_ERROR.create({
      message: "Deno did not report a valid server address",
    });
  }

  const managedServer = new DenoServer(nativeServer, address.hostname, address.port);
  serverReference.current = managedServer;
  try {
    onListen?.(managedServer.addr);
  } catch (error) {
    try {
      await managedServer.stop();
    } catch {
      logger.error("Failed to stop the server after onListen failed");
    }
    throw error;
  }
  return managedServer;
}

export class DenoAdapter implements RuntimeAdapter {
  readonly id = "deno" as const;
  readonly name = "deno";
  readonly fs = new DenoFileSystemAdapter();
  readonly env = new DenoEnvironmentAdapter();
  readonly server = new DenoServerAdapter();
  readonly shell = new DenoShellAdapter();

  readonly capabilities = Object.freeze({
    typescript: true,
    jsx: true,
    http2: true,
    websocket: true,
    workers: true,
    fileWatching: true,
    shell: true,
    kvStore: false,
    writableFs: true,
  });

  private readonly serverLifecycle = createServerLifecycle(createDenoServer);
  readonly serve = this.serverLifecycle.serve;

  shutdown(): Promise<void> {
    return this.serverLifecycle.shutdown();
  }
}

export const denoAdapter = new DenoAdapter();
