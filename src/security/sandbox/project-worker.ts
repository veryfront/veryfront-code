/**
 * Project Worker
 *
 * Wraps a single Deno Worker for one project. Manages the Worker lifecycle,
 * sends/receives structured messages, enforces per-request timeouts,
 * and serializes errors across the Worker boundary.
 *
 * @module security/sandbox/project-worker
 */

import { serverLogger } from "#veryfront/utils";
import { isCompiledBinary } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { INVALID_ARGUMENT, TIMEOUT_ERROR, UNKNOWN_ERROR } from "#veryfront/errors";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import {
  isInternalEgressOverrideEnabled,
  type ResolveWorkerHost,
  startWorkerEgressBroker,
  WORKER_INTERNAL_EGRESS_OVERRIDE_ENV,
  type WorkerEgressBroker,
} from "./worker-egress-guard.ts";
import type { WorkerPermissions } from "./worker-permissions.ts";
import type {
  WorkerRequest,
  WorkerResponse,
  WorkerStreamChunk,
  WorkerStreamEnd,
} from "./worker-types.ts";

const logger = serverLogger.component("project-worker");
const textEncoder = new TextEncoder();
const NativeMessageChannel = MessageChannel;
const apply = Reflect.apply;
const eventTargetAddEventListener = EventTarget.prototype.addEventListener;
const messagePortClose = MessagePort.prototype.close;
const messagePortPostMessage = MessagePort.prototype.postMessage;
const messagePortStart = MessagePort.prototype.start;
const workerPostMessage = Worker.prototype.postMessage;
const arrayIncludes = Array.prototype.includes;

// Intersection with the DOM `WorkerOptions` so the value is assignable to the
// `Worker` constructor without suppression — Deno reads the extra `deno` field
// at runtime even though the DOM lib type doesn't declare it.
type ScopedWorkerPermissions = Omit<WorkerPermissions, "net"> & {
  net: string[] | boolean;
};
type ExtendedWorkerOptions = WorkerOptions & {
  deno?: { permissions: ScopedWorkerPermissions };
};

export interface ProjectWorkerOptions {
  projectId: string;
  permissions: WorkerPermissions;
  requestTimeoutMs: number;
  workerScriptUrl?: string;
  /** Override for deterministic egress resolution tests. */
  egressResolveHost?: ResolveWorkerHost;
}

interface PendingRequest {
  resolve: (value: WorkerResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  expectedTypes: readonly string[];
}

interface StreamHandler {
  onChunk: (chunk: Uint8Array) => void;
  onEnd: () => void;
  onError: (error: Error) => void;
}

/**
 * Status of a project worker.
 */
export type WorkerStatus = "idle" | "busy" | "crashed" | "terminated";

function expectedResponseTypes(request: WorkerRequest): readonly string[] {
  switch (request.type) {
    case "execute-app-route":
    case "execute-pages-route":
      return ["result", "prepared-module-capacity", "error"];
    case "inspect-api-route-methods":
      return ["api-route-methods", "prepared-module-capacity", "error"];
    case "fetch-data":
      return ["data-result", "error"];
    case "render-ssr":
      return ["ssr-result", "error"];
    default:
      // Runtime callers can still cross the TypeScript boundary. The worker
      // owns validation and reports unknown request kinds as a typed error.
      return ["error"];
  }
}

export class ProjectWorker {
  readonly projectId: string;

  private worker: Worker | null = null;
  private controlPort: MessagePort | null = null;
  private pending = new Map<string, PendingRequest>();
  private streamHandlers = new Map<string, StreamHandler>();
  private idleListeners = new Set<() => void>();
  private suppressIdleNotifications = false;
  private requestTimeoutMs: number;
  private permissions: WorkerPermissions;
  private workerScriptUrl?: string;
  private egressResolveHost?: ResolveWorkerHost;
  private egressBroker: WorkerEgressBroker | null = null;
  private _requestCount = 0;
  private _lastActivityAt = Date.now();
  private _status: WorkerStatus = "idle";

  constructor(options: ProjectWorkerOptions) {
    this.projectId = options.projectId;
    this.permissions = options.permissions;
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.workerScriptUrl = options.workerScriptUrl;
    this.egressResolveHost = options.egressResolveHost;
  }

  get status(): WorkerStatus {
    return this._status;
  }

  get requestCount(): number {
    return this._requestCount;
  }

  get lastActivityAt(): number {
    return this._lastActivityAt;
  }

  get hasPendingRequests(): boolean {
    return this.pending.size > 0 || this.streamHandlers.size > 0;
  }

  /** Subscribe to the transition where all worker protocol work has settled. */
  onIdle(listener: () => void): () => void {
    this.idleListeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.idleListeners.delete(listener);
    };
  }

  /**
   * Start the worker. Idempotent — safe to call if already running.
   */
  start(): void {
    if (this.worker) return;
    if (this.workerScriptUrl && this.permissions.net) {
      throw INVALID_ARGUMENT.create({
        message: "Custom project worker scripts cannot use unrestricted network permissions",
      });
    }

    const allowInternalEgress = isInternalEgressOverrideEnabled(
      getHostEnv(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV),
    );
    let workerPermissions: ScopedWorkerPermissions = this.permissions;
    if (this.permissions.net === true) {
      this.egressBroker = startWorkerEgressBroker({
        allowInternalEgress,
        resolveHost: this.egressResolveHost,
      });
      workerPermissions = {
        ...this.permissions,
        net: this.egressBroker.config.netAllowlist,
      };
    }

    try {
      const workerUrl = this.getWorkerScriptUrl();
      const workerOptions: ExtendedWorkerOptions = {
        type: "module",
        name: `project-worker-${this.projectId}`,
        deno: { permissions: workerPermissions },
      };

      this.worker = new Worker(workerUrl, workerOptions);
      const startedWorker = this.worker;
      this._status = "idle";

      if (this.workerScriptUrl) {
        startedWorker.onmessage = (event: MessageEvent) => {
          if (this.worker !== startedWorker) return;
          this.handleMessage(event.data);
        };
        apply(eventTargetAddEventListener, startedWorker, [
          "messageerror",
          () => {
            if (this.worker !== startedWorker) return;
            this.failWorker("crashed", "Worker message could not be deserialized");
          },
        ]);
      } else {
        const channel = new NativeMessageChannel();
        this.controlPort = channel.port1;
        const controlPort = this.controlPort;
        apply(eventTargetAddEventListener, controlPort, [
          "message",
          (event: MessageEvent) => {
            if (this.controlPort !== controlPort || this.worker !== startedWorker) return;
            this.handleMessage(event.data);
          },
        ]);
        apply(eventTargetAddEventListener, controlPort, [
          "messageerror",
          () => {
            if (this.controlPort !== controlPort || this.worker !== startedWorker) return;
            this.failWorker("crashed", "Worker control message could not be deserialized");
          },
        ]);
        apply(messagePortStart, controlPort, []);

        apply(workerPostMessage, startedWorker, [
          {
            type: "initialize-egress",
            options: {
              allowInternalEgress,
              socksProxy: this.egressBroker?.config.socksProxy,
              httpBroker: this.egressBroker?.config.httpBroker,
            },
            controlPort: channel.port2,
          },
          [channel.port2],
        ]);
      }

      startedWorker.onerror = (event) => {
        if (this.worker !== startedWorker) return;
        logger.error("Worker error", {
          projectId: this.projectId,
          error: event.message ?? String(event),
        });
        this.failWorker("crashed", "Worker crashed");
      };
    } catch (error) {
      try {
        this.worker?.terminate();
      } catch {
        // Preserve the startup error while still closing the egress broker.
      }
      this.worker = null;
      this.closeControlPort();
      this.egressBroker?.close();
      this.egressBroker = null;
      this._status = "terminated";
      throw error;
    }

    logger.debug("Worker started", { projectId: this.projectId });
  }

  /**
   * Execute a request in this worker. Returns a typed response.
   */
  execute(request: WorkerRequest): Promise<WorkerResponse> {
    return withSpan(
      "worker.execute",
      () => {
        if (!this.worker || this._status === "crashed" || this._status === "terminated") {
          return Promise.reject(
            UNKNOWN_ERROR.create({ detail: `Worker not available (status: ${this._status})` }),
          );
        }
        if (this.pending.has(request.id)) {
          return Promise.reject(UNKNOWN_ERROR.create({ detail: "Duplicate worker request id" }));
        }

        this._requestCount++;
        this._lastActivityAt = Date.now();
        this._status = "busy";

        return new Promise<WorkerResponse>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.pending.delete(request.id);
            const timeoutError = TIMEOUT_ERROR.create({
              detail: `Worker request timed out after ${this.requestTimeoutMs}ms`,
            });
            this.terminate();
            reject(timeoutError);
          }, this.requestTimeoutMs);

          this.pending.set(request.id, {
            resolve,
            reject,
            timer,
            expectedTypes: expectedResponseTypes(request),
          });
          try {
            this.postToWorker(request);
          } catch {
            clearTimeout(timer);
            this.pending.delete(request.id);
            const sendError = UNKNOWN_ERROR.create({
              detail: "Worker request could not be sent",
            });
            this.failWorker("crashed", "Worker control channel failed");
            reject(sendError);
          }
        });
      },
      {
        "worker.projectId": this.projectId,
        "worker.requestType": request.type,
        "worker.requestId": request.id,
      },
    );
  }

  /**
   * Execute a streaming request. Returns a ReadableStream that yields
   * chunks as they arrive from the Worker via postMessage.
   *
   * Used for streaming SSR where the Worker sends chunks progressively.
   * Falls back to a single-chunk stream if the Worker returns a non-streaming
   * response (ssr-result with full HTML).
   */
  executeStream(request: WorkerRequest): ReadableStream<Uint8Array> {
    if (!this.worker || this._status === "crashed" || this._status === "terminated") {
      throw UNKNOWN_ERROR.create({ detail: `Worker not available (status: ${this._status})` });
    }

    if (this.pending.has(request.id) || this.streamHandlers.has(request.id)) {
      throw UNKNOWN_ERROR.create({ detail: "Duplicate worker request id" });
    }

    this._requestCount++;
    this._lastActivityAt = Date.now();
    this._status = "busy";

    const requestId = request.id;
    let cancelRequest: (() => void) | undefined;

    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout>;

        const clearRegistration = () => {
          clearTimeout(timer);
          this.streamHandlers.delete(requestId);
          this.pending.delete(requestId);
        };
        const handleTimeout = () => {
          if (settled) return;
          settled = true;
          clearRegistration();
          const timeoutError = TIMEOUT_ERROR.create({
            detail: `Worker stream timed out after ${this.requestTimeoutMs}ms`,
          });
          this.terminate();
          controller.error(timeoutError);
        };

        timer = setTimeout(handleTimeout, this.requestTimeoutMs);

        const resetTimer = () => {
          clearTimeout(timer);
          timer = setTimeout(handleTimeout, this.requestTimeoutMs);
        };

        cancelRequest = () => {
          if (settled) return;
          settled = true;
          clearRegistration();
          // No worker-side cancel RPC exists. Retiring the worker is the only
          // boundary that guarantees project rendering stops when the
          // downstream consumer disconnects.
          this.terminate();
        };

        // Register a stream handler for this request
        this.streamHandlers.set(requestId, {
          onChunk: (chunk: Uint8Array) => {
            if (settled) return;
            resetTimer();
            controller.enqueue(chunk);
          },
          onEnd: () => {
            if (settled) return;
            settled = true;
            clearRegistration();
            this.updateIdleStatus();
            controller.close();
          },
          onError: (error: Error) => {
            if (settled) return;
            settled = true;
            clearRegistration();
            this.updateIdleStatus();
            controller.error(error);
          },
        });

        // Also register in pending for non-streaming responses (fallback)
        this.pending.set(requestId, {
          resolve: (response) => {
            if (settled) return;
            settled = true;
            clearRegistration();
            this.updateIdleStatus();

            // If we get an ssr-result, emit it as a single chunk
            if (response.type === "ssr-result") {
              controller.enqueue(textEncoder.encode(response.html));
              controller.close();
            } else if (response.type === "error") {
              const err = new Error(response.error.message);
              err.name = response.error.name;
              controller.error(err);
            } else {
              controller.close();
            }
          },
          reject: (error) => {
            if (settled) return;
            settled = true;
            clearRegistration();
            this.updateIdleStatus();
            controller.error(error);
          },
          timer,
          expectedTypes: expectedResponseTypes(request),
        });

        try {
          this.postToWorker(request);
        } catch {
          settled = true;
          clearRegistration();
          const sendError = UNKNOWN_ERROR.create({
            detail: "Worker stream request could not be sent",
          });
          this.failWorker("crashed", "Worker control channel failed");
          controller.error(sendError);
        }
      },
      cancel: () => {
        cancelRequest?.();
      },
    });
  }

  /**
   * Health check — send a ping and wait for pong.
   */
  async isHealthy(timeoutMs = 5_000): Promise<boolean> {
    if (!this.worker || this._status === "crashed" || this._status === "terminated") {
      return false;
    }

    const id = crypto.randomUUID();

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(false);
      }, timeoutMs);

      this.pending.set(id, {
        resolve: () => {
          clearTimeout(timer);
          this.pending.delete(id);
          resolve(true);
        },
        reject: () => {
          clearTimeout(timer);
          this.pending.delete(id);
          resolve(false);
        },
        timer,
        expectedTypes: ["pong"],
      });

      try {
        this.postToWorker({ type: "ping", id });
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        this.failWorker("crashed", "Worker health message could not be sent");
        resolve(false);
      }
    });
  }

  /**
   * Clear the worker's module cache. Used for dev mode hot reload.
   */
  clearModuleCache(): void {
    if (!this.worker || this._status === "crashed" || this._status === "terminated") return;
    // ESM imports cannot be evicted from an existing worker isolate. Retiring
    // the worker is the only honest invalidation boundary for file-based data
    // and SSR modules.
    this.terminate();
  }

  /**
   * Terminate the worker. Rejects all pending requests.
   */
  terminate(): void {
    this.failWorker("terminated", "Worker terminated");
    logger.debug("Worker terminated", { projectId: this.projectId });
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private postToWorker(message: unknown): void {
    if (this.controlPort) {
      apply(messagePortPostMessage, this.controlPort, [message]);
      return;
    }
    if (!this.worker) {
      throw UNKNOWN_ERROR.create({ detail: "Worker not available" });
    }
    apply(workerPostMessage, this.worker, [message]);
  }

  private failWorker(status: "crashed" | "terminated", reason: string): void {
    const worker = this.worker;
    this.worker = null;
    this._status = status;

    this.suppressIdleNotifications = true;
    try {
      this.rejectAllPending(reason);
    } finally {
      this.suppressIdleNotifications = false;
    }

    if (worker) {
      try {
        worker.terminate();
      } catch (error) {
        logger.debug("Worker terminate failed", {
          projectId: this.projectId,
          error,
        });
      }
    }

    this.closeControlPort();
    this.egressBroker?.close();
    this.egressBroker = null;
    this.notifyIdleListeners();
  }

  private closeControlPort(): void {
    if (!this.controlPort) return;
    try {
      apply(messagePortClose, this.controlPort, []);
    } catch {
      // Worker termination still closes the underlying transport.
    }
    this.controlPort = null;
  }

  private getWorkerScriptUrl(): string {
    if (this.workerScriptUrl) return this.workerScriptUrl;

    // In compiled binary mode, use a data URL because blob URLs don't work
    // See: deno-sandbox.ts for the same pattern
    if (isCompiledBinary()) {
      // For compiled binaries, we'd need to inline the worker script.
      // For now, fall through to the import.meta.resolve path which works
      // in development and standard Deno execution.
    }

    // Use import.meta.resolve to get the absolute URL of the worker script.
    // This works in both `deno run` and `deno compile` contexts.
    return import.meta.resolve("./worker-script.ts");
  }

  private handleMessage(
    data:
      | WorkerResponse
      | WorkerStreamChunk
      | WorkerStreamEnd
      | { type: "worker-exit" }
      | { type: "pong"; id: string },
  ): void {
    if (typeof data !== "object" || data === null || typeof data.type !== "string") {
      this.failWorker("crashed", "Worker returned an invalid control message");
      return;
    }

    if (data.type === "worker-exit") {
      this.terminate();
      return;
    }

    if (data.type === "pong") {
      const pending = this.pending.get((data as { id: string }).id);
      if (pending) {
        if (!apply(arrayIncludes, pending.expectedTypes, ["pong"])) {
          this.failWorker("crashed", "Worker returned a response for the wrong request type");
          return;
        }
        clearTimeout(pending.timer);
        pending.resolve(data as unknown as WorkerResponse);
        this.pending.delete((data as { id: string }).id);
      }
      return;
    }

    // Handle streaming SSR chunks
    if (data.type === "stream-chunk") {
      const handler = this.streamHandlers.get(data.id);
      if (!handler) {
        this.failWorker("crashed", "Worker returned an unexpected stream chunk");
        return;
      }
      handler.onChunk(data.chunk);
      return;
    }

    if (data.type === "stream-end") {
      const handler = this.streamHandlers.get(data.id);
      if (!handler) {
        this.failWorker("crashed", "Worker returned an unexpected stream end");
        return;
      }
      handler.onEnd();
      return;
    }

    const response = data as WorkerResponse;
    const pending = this.pending.get(response.id);
    if (!pending) {
      logger.warn("Received response for unknown request", {
        projectId: this.projectId,
        id: response.id,
      });
      return;
    }
    if (!apply(arrayIncludes, pending.expectedTypes, [response.type])) {
      this.failWorker("crashed", "Worker returned a response for the wrong request type");
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(response.id);
    this.updateIdleStatus();

    pending.resolve(response);
  }

  private updateIdleStatus(): void {
    if (this.pending.size !== 0 || this.streamHandlers.size !== 0) return;
    if (this._status === "busy") this._status = "idle";
    this.notifyIdleListeners();
  }

  private notifyIdleListeners(): void {
    if (
      this.suppressIdleNotifications ||
      this.pending.size !== 0 ||
      this.streamHandlers.size !== 0
    ) {
      return;
    }
    for (const listener of [...this.idleListeners]) {
      try {
        listener();
      } catch {
        // Lifecycle observers cannot interfere with worker cleanup.
      }
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(UNKNOWN_ERROR.create({ detail: reason }));
      this.pending.delete(id);
    }

    // Clean up stream handlers
    for (const [id, handler] of this.streamHandlers) {
      handler.onError(UNKNOWN_ERROR.create({ detail: reason }));
      this.streamHandlers.delete(id);
    }
  }
}
