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
import { FRAMEWORK_WORKER_ENV_ALLOWLIST, type WorkerPermissions } from "./worker-permissions.ts";
import type { WorkerRequest, WorkerResponse } from "./worker-types.ts";

const logger = serverLogger.component("project-worker");
const textEncoder = new TextEncoder();
const WORKER_RESPONSE_TYPES = new Set<WorkerResponse["type"]>([
  "result",
  "data-result",
  "ssr-result",
  "openapi-result",
  "project-run-result",
  "error",
]);

function isMessageRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

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
}

interface StreamHandler {
  onChunk: (chunk: Uint8Array) => void;
  onEnd: () => void;
  onError: (error: Error) => void;
}

export interface ProtocolSessionHandler {
  onMessage(data: unknown): void;
  onClose(error: Error): void;
}

/** Exclusive private-channel session used by long-lived Worker protocols. */
export interface ProjectWorkerProtocolSession {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  close(): void;
}

/**
 * Status of a project worker.
 */
export type WorkerStatus = "idle" | "busy" | "crashed" | "terminated";

export class ProjectWorker {
  readonly projectId: string;

  private worker: Worker | null = null;
  private responsePort: MessagePort | null = null;
  private pending = new Map<string, PendingRequest>();
  private streamHandlers = new Map<string, StreamHandler>();
  private protocolSession: ProtocolSessionHandler | null = null;
  private requestTimeoutMs: number;
  private permissions: WorkerPermissions;
  private projectEnvKeys: string[];
  private workerScriptUrl?: string;
  private egressResolveHost?: ResolveWorkerHost;
  private egressBroker: WorkerEgressBroker | null = null;
  private _requestCount = 0;
  private _lastActivityAt = Date.now();
  private _status: WorkerStatus = "idle";

  constructor(options: ProjectWorkerOptions) {
    if (!Number.isSafeInteger(options.requestTimeoutMs) || options.requestTimeoutMs <= 0) {
      throw new TypeError("requestTimeoutMs must be a positive safe integer");
    }
    this.projectId = options.projectId;
    this.permissions = options.permissions;
    const frameworkEnvKeys = new Set<string>(FRAMEWORK_WORKER_ENV_ALLOWLIST);
    this.projectEnvKeys = Array.isArray(options.permissions.env)
      ? options.permissions.env.filter((key) => !frameworkEnvKeys.has(key))
      : [];
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
    return this.pending.size > 0 || this.protocolSession !== null;
  }

  /**
   * Start the worker. Idempotent — safe to call if already running.
   */
  start(): void {
    if (this.worker) return;
    if (this._status === "crashed" || this._status === "terminated") {
      throw new Error("A crashed or terminated project worker cannot be restarted");
    }
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
        name: `project-worker-${crypto.randomUUID()}`,
        deno: { permissions: workerPermissions },
      };

      this.worker = new Worker(workerUrl, workerOptions);
      this._status = "idle";

      let workerResponsePort: MessagePort | undefined;
      if (this.workerScriptUrl) {
        this.worker.onmessage = (event: MessageEvent) => {
          this.handleMessage(event.data);
        };
      } else {
        const responseChannel = new MessageChannel();
        this.responsePort = responseChannel.port1;
        workerResponsePort = responseChannel.port2;
        this.responsePort.onmessage = (event: MessageEvent) => {
          this.handleMessage(event.data);
        };
        this.responsePort.onmessageerror = () => {
          logger.warn("Project worker response channel failed");
          this.terminate();
        };
        this.responsePort.start();
        this.worker.onmessage = () => {
          logger.warn("Project worker used the untrusted public response channel");
          this.terminate();
        };
      }

      this.worker.onerror = (event) => {
        event.preventDefault();
        logger.error("Project worker crashed");
        const crashedWorker = this.worker;
        this.worker = null;
        this._status = "crashed";
        try {
          crashedWorker?.terminate();
        } catch {
          // The worker may already have terminated after dispatching the error.
        }
        this.egressBroker?.close();
        this.egressBroker = null;
        this.rejectAllPending("Worker crashed");
      };

      if (!this.workerScriptUrl) {
        this.worker.postMessage({
          type: "initialize-egress",
          options: {
            allowInternalEgress,
            socksProxy: this.egressBroker?.config.socksProxy,
            httpBroker: this.egressBroker?.config.httpBroker,
          },
          projectEnvKeys: this.projectEnvKeys,
          responsePort: workerResponsePort,
        }, { transfer: workerResponsePort ? [workerResponsePort] : [] });
      }
    } catch (error) {
      try {
        this.worker?.terminate();
      } catch {
        // Preserve the startup error while still closing the egress broker.
      }
      this.worker = null;
      this.responsePort?.close();
      this.responsePort = null;
      this.egressBroker?.close();
      this.egressBroker = null;
      this._status = "terminated";
      throw error;
    }

    logger.debug("Project worker started");
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
        if (this.hasInFlightRequest(request.id)) {
          return Promise.reject(
            INVALID_ARGUMENT.create({ message: "Request ID is already in flight" }),
          );
        }

        this._requestCount++;
        this._lastActivityAt = Date.now();
        this._status = "busy";

        return new Promise<WorkerResponse>((resolve, reject) => {
          const timer = setTimeout(() => {
            const pending = this.pending.get(request.id);
            if (!pending) return;
            this.pending.delete(request.id);
            pending.reject(
              TIMEOUT_ERROR.create({
                detail: `Worker request timed out after ${this.requestTimeoutMs}ms`,
              }),
            );
            // A timed-out request can still be executing untrusted code. The
            // worker must be terminated before it can be considered reusable.
            this.terminate();
          }, this.requestTimeoutMs);

          this.pending.set(request.id, { resolve, reject, timer });
          try {
            this.postToWorker(request);
          } catch (error) {
            clearTimeout(timer);
            this.pending.delete(request.id);
            this.updateIdleStatus();
            reject(
              error instanceof Error ? error : UNKNOWN_ERROR.create({ detail: String(error) }),
            );
          }
        });
      },
      {
        "worker.requestType": request.type,
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

    const requestId = request.id;
    if (this.hasInFlightRequest(requestId)) {
      throw INVALID_ARGUMENT.create({ message: "Request ID is already in flight" });
    }

    this._requestCount++;
    this._lastActivityAt = Date.now();
    this._status = "busy";

    let cancelRequest = (): void => {};

    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        let settled = false;
        let timer = setTimeout(() => {
          fail(
            TIMEOUT_ERROR.create({
              detail: `Worker stream timed out after ${this.requestTimeoutMs}ms`,
            }),
            true,
          );
        }, this.requestTimeoutMs);

        const cleanup = () => {
          clearTimeout(timer);
          this.streamHandlers.delete(requestId);
          this.pending.delete(requestId);
          this.updateIdleStatus();
        };

        const fail = (error: Error, terminateWorker = false) => {
          if (settled) return;
          settled = true;
          cleanup();
          controller.error(error);
          if (terminateWorker) this.terminate();
        };

        cancelRequest = () => {
          if (settled) return;
          settled = true;
          cleanup();
          // There is no reliable in-worker cancellation primitive. Terminating
          // prevents canceled untrusted computation from running in the
          // background while the worker appears idle.
          this.terminate();
        };

        const resetTimer = () => {
          if (settled) return;
          clearTimeout(timer);
          timer = setTimeout(() => {
            fail(
              TIMEOUT_ERROR.create({
                detail: `Worker stream timed out after ${this.requestTimeoutMs}ms`,
              }),
              true,
            );
          }, this.requestTimeoutMs);
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
            cleanup();
            controller.close();
          },
          onError: (error: Error) => fail(error),
        });

        // Also register in pending for non-streaming responses (fallback)
        this.pending.set(requestId, {
          resolve: (response) => {
            if (settled) return;
            settled = true;
            cleanup();

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
          reject: (error) => fail(error),
          timer,
        });

        try {
          this.postToWorker(request);
        } catch (error) {
          fail(error instanceof Error ? error : UNKNOWN_ERROR.create({ detail: String(error) }));
        }
      },
      cancel: () => cancelRequest(),
    });
  }

  /**
   * Health check — send a ping and wait for pong.
   */
  async isHealthy(timeoutMs = 5_000): Promise<boolean> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError("Health-check timeout must be a positive safe integer");
    }
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
      });

      this.postToWorker({ type: "ping", id });
    });
  }

  /**
   * Clear the worker's module cache. Used for dev mode hot reload.
   */
  clearModuleCache(): void {
    if (!this.worker || this._status === "crashed" || this._status === "terminated") return;
    this.postToWorker({ type: "clear-cache" });
  }

  /**
   * Reserve the Worker's private transport for one long-lived protocol.
   * Generic request execution is intentionally unavailable until the session closes.
   */
  openProtocolSession(handler: ProtocolSessionHandler): ProjectWorkerProtocolSession {
    if (!this.worker || this._status === "crashed" || this._status === "terminated") {
      throw UNKNOWN_ERROR.create({ detail: `Worker not available (status: ${this._status})` });
    }
    if (this.workerScriptUrl || !this.responsePort) {
      throw INVALID_ARGUMENT.create({
        message: "Private Worker protocol sessions require the framework Worker script",
      });
    }
    if (this.protocolSession || this.pending.size > 0 || this.streamHandlers.size > 0) {
      throw INVALID_ARGUMENT.create({ message: "Worker transport is already in use" });
    }
    this.protocolSession = handler;
    this._status = "busy";
    let open = true;
    return {
      postMessage: (message, transfer = []) => {
        if (!open || this.protocolSession !== handler) {
          throw UNKNOWN_ERROR.create({ detail: "Worker protocol session is closed" });
        }
        this.postToWorker(message, transfer);
      },
      close: () => {
        if (!open) return;
        open = false;
        if (this.protocolSession === handler) this.protocolSession = null;
        this.updateIdleStatus();
      },
    };
  }

  /**
   * Terminate the worker. Rejects all pending requests.
   */
  terminate(): void {
    if (this._status === "terminated") return;
    const worker = this.worker;
    this.worker = null;
    const responsePort = this.responsePort;
    this.responsePort = null;
    this._status = "terminated";
    this.rejectAllPending("Worker terminated");

    try {
      worker?.terminate();
    } catch {
      logger.debug("Project worker termination failed");
    }
    responsePort?.close();

    this.egressBroker?.close();
    this.egressBroker = null;
    logger.debug("Project worker terminated");
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private getWorkerScriptUrl(): string {
    if (this.workerScriptUrl) return this.workerScriptUrl;

    // The binary compiler includes this module explicitly, so the same URL is
    // available in standard and compiled Deno execution.
    return import.meta.resolve("./worker-script.ts");
  }

  private postToWorker(message: unknown, transfer: Transferable[] = []): void {
    if (!this.worker) {
      throw UNKNOWN_ERROR.create({ detail: `Worker not available (status: ${this._status})` });
    }
    if (this.responsePort) {
      this.responsePort.postMessage(message, transfer.length > 0 ? { transfer } : undefined);
      return;
    }
    this.worker.postMessage(message, transfer.length > 0 ? { transfer } : undefined);
  }

  private handleMessage(data: unknown): void {
    if (this.protocolSession) {
      this.protocolSession.onMessage(data);
      return;
    }
    if (!isMessageRecord(data) || typeof data.type !== "string") {
      logger.warn("Ignored malformed project worker message");
      return;
    }

    if (data.type === "worker-exit") {
      this.terminate();
      return;
    }

    if (typeof data.id !== "string" || data.id.length === 0 || data.id.length > 4_096) {
      logger.warn("Ignored project worker message with an invalid request ID");
      return;
    }

    if (data.type === "pong") {
      const pending = this.pending.get(data.id);
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(data as unknown as WorkerResponse);
        this.pending.delete(data.id);
      }
      return;
    }

    // Handle streaming SSR chunks
    if (data.type === "stream-chunk") {
      if (!(data.chunk instanceof Uint8Array)) {
        logger.warn("Ignored malformed project worker stream chunk");
        return;
      }
      const handler = this.streamHandlers.get(data.id);
      if (handler) handler.onChunk(data.chunk);
      return;
    }

    if (data.type === "stream-end") {
      const handler = this.streamHandlers.get(data.id);
      if (handler) handler.onEnd();
      return;
    }

    if (!WORKER_RESPONSE_TYPES.has(data.type as WorkerResponse["type"])) {
      logger.warn("Ignored project worker message with an unknown response type");
      return;
    }

    const response = data as unknown as WorkerResponse;
    const pending = this.pending.get(response.id);
    if (!pending) {
      logger.warn("Received project worker response for an unknown request");
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(response.id);
    this.updateIdleStatus();

    pending.resolve(response);
  }

  private updateIdleStatus(): void {
    if (
      this.pending.size === 0 && this.streamHandlers.size === 0 &&
      this.protocolSession === null && this._status === "busy"
    ) {
      this._status = "idle";
    }
  }

  private hasInFlightRequest(id: string): boolean {
    return this.pending.has(id) || this.streamHandlers.has(id);
  }

  private rejectAllPending(reason: string): void {
    const protocolSession = this.protocolSession;
    this.protocolSession = null;
    protocolSession?.onClose(UNKNOWN_ERROR.create({ detail: reason }));

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
