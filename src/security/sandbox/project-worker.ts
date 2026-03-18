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
import { TIMEOUT_ERROR, UNKNOWN_ERROR } from "#veryfront/errors";
import type { WorkerPermissions } from "./worker-permissions.ts";
import type {
  WorkerRequest,
  WorkerResponse,
} from "./worker-types.ts";

const logger = serverLogger.component("project-worker");

type ExtendedWorkerOptions = {
  type: "module";
  name?: string;
  deno?: { permissions: WorkerPermissions };
};

export interface ProjectWorkerOptions {
  projectId: string;
  permissions: WorkerPermissions;
  requestTimeoutMs: number;
}

interface PendingRequest {
  resolve: (value: WorkerResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Status of a project worker.
 */
export type WorkerStatus = "idle" | "busy" | "crashed" | "terminated";

export class ProjectWorker {
  readonly projectId: string;

  private worker: Worker | null = null;
  private pending = new Map<string, PendingRequest>();
  private requestTimeoutMs: number;
  private permissions: WorkerPermissions;
  private _requestCount = 0;
  private _lastActivityAt = Date.now();
  private _status: WorkerStatus = "idle";

  constructor(options: ProjectWorkerOptions) {
    this.projectId = options.projectId;
    this.permissions = options.permissions;
    this.requestTimeoutMs = options.requestTimeoutMs;
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
    return this.pending.size > 0;
  }

  /**
   * Start the worker. Idempotent — safe to call if already running.
   */
  start(): void {
    if (this.worker) return;

    const workerUrl = this.getWorkerScriptUrl();

    const workerOptions: ExtendedWorkerOptions = {
      type: "module",
      name: `project-worker-${this.projectId}`,
      deno: { permissions: this.permissions },
    };

    // @ts-ignore - Deno Worker accepts extended options
    this.worker = new Worker(workerUrl, workerOptions);
    this._status = "idle";

    this.worker.onmessage = (event: MessageEvent) => {
      this.handleMessage(event.data);
    };

    this.worker.onerror = (event) => {
      logger.error("Worker error", {
        projectId: this.projectId,
        error: event.message ?? String(event),
      });
      this._status = "crashed";
      this.rejectAllPending("Worker crashed");
    };

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

        this._requestCount++;
        this._lastActivityAt = Date.now();
        this._status = "busy";

        return new Promise<WorkerResponse>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.pending.delete(request.id);
            this.updateIdleStatus();
            reject(
              TIMEOUT_ERROR.create({
                detail: `Worker request timed out after ${this.requestTimeoutMs}ms`,
              }),
            );
          }, this.requestTimeoutMs);

          this.pending.set(request.id, { resolve, reject, timer });
          this.worker!.postMessage(request);
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
      });

      this.worker!.postMessage({ type: "ping", id });
    });
  }

  /**
   * Terminate the worker. Rejects all pending requests.
   */
  terminate(): void {
    if (!this.worker) return;

    this._status = "terminated";
    this.rejectAllPending("Worker terminated");

    try {
      this.worker.terminate();
    } catch (error) {
      logger.debug("Worker terminate failed", {
        projectId: this.projectId,
        error,
      });
    }

    this.worker = null;
    logger.debug("Worker terminated", { projectId: this.projectId });
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private getWorkerScriptUrl(): string {
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

  private handleMessage(data: WorkerResponse | { type: "pong"; id: string }): void {
    if (data.type === "pong") {
      const pending = this.pending.get((data as { id: string }).id);
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(data as unknown as WorkerResponse);
        this.pending.delete((data as { id: string }).id);
      }
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

    clearTimeout(pending.timer);
    this.pending.delete(response.id);
    this.updateIdleStatus();

    pending.resolve(response);
  }

  private updateIdleStatus(): void {
    if (this.pending.size === 0 && this._status === "busy") {
      this._status = "idle";
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(UNKNOWN_ERROR.create({ detail: reason }));
      this.pending.delete(id);
    }
  }
}
