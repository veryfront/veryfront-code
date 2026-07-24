/**
 * Killable worker boundary for hosted declarative configuration evaluation.
 *
 * Each request receives a fresh worker. A synchronous parser stall therefore
 * cannot retain a pooled worker generation or block the host event loop.
 *
 * @module
 */

import { isDeno, isNode } from "#veryfront/platform/compat/runtime.ts";
import type { PreparedDeclarativeConfigWorkerPayload } from "./declarative-evaluator.ts";
import type { ConfigSnapshotRecord } from "./snapshot.ts";
import {
  createDeclarativeConfigWorkerInfrastructureError,
  decodeDeclarativeConfigWorkerResponse,
} from "./declarative-evaluator-worker-protocol.ts";

const DEFAULT_WORKER_TIMEOUT_MS = 5_000;
const MAX_WORKER_TIMEOUT_MS = 30_000;
const NODE_WORKER_RESOURCE_LIMITS = Object.freeze({
  maxOldGenerationSizeMb: 128,
  maxYoungGenerationSizeMb: 32,
  stackSizeMb: 4,
});
const monotonicNow = globalThis.performance.now.bind(globalThis.performance);

/**
 * Process-wide admission limits for cold hosted configuration evaluations.
 *
 * Evaluation results are expected to be cached by their source/context
 * identity. A deliberately small worker budget protects aggregate CPU and
 * memory when many unique or uncached sources arrive together.
 */
export const DECLARATIVE_CONFIG_WORKER_ADMISSION_LIMITS = Object.freeze({
  maxActive: 2,
  maxQueued: 16,
});

/** Host-controlled lifecycle policy for one worker evaluation. */
export interface DeclarativeConfigWorkerRunnerOptions {
  /** Wall-clock deadline covering worker startup, parsing, and evaluation. */
  readonly timeoutMs?: number;
  /** Optional cancellation signal owned by the hosted caller. */
  readonly signal?: AbortSignal;
}

interface DeclarativeConfigWorkerEndpointListeners {
  readonly onMessage: (value: unknown) => void;
  readonly onError: () => void;
  readonly onMessageError: () => void;
  readonly onExit?: (code: number) => void;
}

interface DeclarativeConfigWorkerEndpoint {
  postMessage(value: PreparedDeclarativeConfigWorkerPayload): void;
  subscribe(listeners: DeclarativeConfigWorkerEndpointListeners): () => void;
  terminate(): void | Promise<unknown>;
}

type DeclarativeConfigWorkerEndpointFactory = () => Promise<
  DeclarativeConfigWorkerEndpoint
>;

type WorkerOutcome =
  | Readonly<{ kind: "resolve"; value: ConfigSnapshotRecord }>
  | Readonly<{ kind: "reject"; error: unknown }>;

interface WorkerEvaluationOperation {
  /** Caller-visible result, which settles at the configured deadline. */
  readonly result: Promise<ConfigSnapshotRecord>;
  /**
   * Resource lifecycle, which remains pending until late startup has either
   * failed or produced an endpoint that has been terminated.
   */
  readonly drained: Promise<void>;
}

interface PendingAdmission {
  settled: boolean;
  readonly resolve: (release: () => void) => void;
  readonly reject: (error: unknown) => void;
  readonly signal: AbortSignal | undefined;
  readonly onAbort: () => void;
  timeout: ReturnType<typeof setTimeout> | undefined;
}

class DeclarativeConfigWorkerAdmissionController {
  readonly #maxActive: number;
  readonly #maxQueued: number;
  #active = 0;
  readonly #queue: PendingAdmission[] = [];

  constructor(maxActive: number, maxQueued: number) {
    if (
      !Number.isSafeInteger(maxActive) ||
      maxActive < 1 ||
      !Number.isSafeInteger(maxQueued) ||
      maxQueued < 0
    ) {
      throw new TypeError(
        "Declarative config worker admission limits must be non-negative safe integers with at least one active slot",
      );
    }
    this.#maxActive = maxActive;
    this.#maxQueued = maxQueued;
  }

  acquire(timeoutMs: number, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      return Promise.reject(
        createDeclarativeConfigWorkerInfrastructureError("worker-aborted"),
      );
    }
    if (this.#active < this.#maxActive) {
      this.#active += 1;
      return Promise.resolve(this.#createRelease());
    }
    if (this.#queue.length >= this.#maxQueued) {
      return Promise.reject(
        createDeclarativeConfigWorkerInfrastructureError("worker-overloaded"),
      );
    }

    return new Promise<() => void>((resolve, reject) => {
      const pending: PendingAdmission = {
        settled: false,
        resolve,
        reject,
        signal,
        onAbort: () => {
          this.#rejectQueued(
            pending,
            createDeclarativeConfigWorkerInfrastructureError(
              "worker-aborted",
            ),
          );
        },
        timeout: undefined,
      };
      pending.timeout = setTimeout(() => {
        this.#rejectQueued(
          pending,
          createDeclarativeConfigWorkerInfrastructureError("worker-timeout"),
        );
      }, timeoutMs);
      this.#queue.push(pending);
      signal?.addEventListener("abort", pending.onAbort, { once: true });
      if (signal?.aborted) pending.onAbort();
    });
  }

  snapshot(): Readonly<{ active: number; queued: number }> {
    return Object.freeze({
      active: this.#active,
      queued: this.#queue.length,
    });
  }

  #createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active -= 1;
      this.#dispatch();
    };
  }

  #cleanupPending(pending: PendingAdmission): void {
    if (pending.timeout !== undefined) {
      clearTimeout(pending.timeout);
      pending.timeout = undefined;
    }
    pending.signal?.removeEventListener("abort", pending.onAbort);
  }

  #removeQueued(pending: PendingAdmission): void {
    const index = this.#queue.indexOf(pending);
    if (index !== -1) this.#queue.splice(index, 1);
  }

  #rejectQueued(pending: PendingAdmission, error: unknown): void {
    if (pending.settled) return;
    pending.settled = true;
    this.#removeQueued(pending);
    this.#cleanupPending(pending);
    pending.reject(error);
  }

  #dispatch(): void {
    while (this.#active < this.#maxActive && this.#queue.length > 0) {
      const pending = this.#queue.shift();
      if (!pending || pending.settled) continue;
      pending.settled = true;
      this.#cleanupPending(pending);
      this.#active += 1;
      pending.resolve(this.#createRelease());
    }
  }
}

const workerAdmissionController = new DeclarativeConfigWorkerAdmissionController(
  DECLARATIVE_CONFIG_WORKER_ADMISSION_LIMITS.maxActive,
  DECLARATIVE_CONFIG_WORKER_ADMISSION_LIMITS.maxQueued,
);

function validateTimeoutMs(value: unknown): number {
  if (value === undefined) return DEFAULT_WORKER_TIMEOUT_MS;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_WORKER_TIMEOUT_MS
  ) {
    throw new TypeError(
      `Declarative config worker timeoutMs must be an integer from 1 to ${MAX_WORKER_TIMEOUT_MS}`,
    );
  }
  return value;
}

function workerEntryUrl(): URL {
  const extension = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
  return new URL(
    `./declarative-evaluator-worker-entry${extension}`,
    import.meta.url,
  );
}

function createDenoWorkerEndpoint(): DeclarativeConfigWorkerEndpoint {
  type PermissionlessWorkerOptions = WorkerOptions & {
    deno: { permissions: "none" };
  };

  const options: PermissionlessWorkerOptions = {
    type: "module",
    deno: { permissions: "none" },
  };
  const worker = new Worker(workerEntryUrl(), options);

  return {
    postMessage(value) {
      worker.postMessage(value);
    },
    subscribe(listeners) {
      const onMessage = (event: MessageEvent<unknown>) => {
        listeners.onMessage(event.data);
      };
      const onError = (event: ErrorEvent) => {
        event.preventDefault();
        listeners.onError();
      };
      const onMessageError = () => {
        listeners.onMessageError();
      };

      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.addEventListener("messageerror", onMessageError);
      return () => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        worker.removeEventListener("messageerror", onMessageError);
      };
    },
    terminate() {
      worker.terminate();
    },
  };
}

async function createNodeWorkerEndpoint(): Promise<
  DeclarativeConfigWorkerEndpoint
> {
  const { Worker: NodeWorker } = await import("node:worker_threads");
  const worker = new NodeWorker(workerEntryUrl(), {
    argv: [],
    env: {},
    execArgv: [],
    resourceLimits: NODE_WORKER_RESOURCE_LIMITS,
  });

  return {
    postMessage(value) {
      worker.postMessage(value);
    },
    subscribe(listeners) {
      const onMessage = (value: unknown) => listeners.onMessage(value);
      const onError = () => listeners.onError();
      const onMessageError = () => listeners.onMessageError();
      const onExit = (code: number) => listeners.onExit?.(code);

      worker.on("message", onMessage);
      worker.on("error", onError);
      worker.on("messageerror", onMessageError);
      worker.on("exit", onExit);
      return () => {
        worker.off("message", onMessage);
        worker.off("error", onError);
        worker.off("messageerror", onMessageError);
        worker.off("exit", onExit);
      };
    },
    terminate() {
      return worker.terminate();
    },
  };
}

async function createRuntimeWorkerEndpoint(): Promise<
  DeclarativeConfigWorkerEndpoint
> {
  if (isDeno) return createDenoWorkerEndpoint();
  if (isNode) return await createNodeWorkerEndpoint();
  throw createDeclarativeConfigWorkerInfrastructureError("worker-unavailable");
}

function beginEvaluationWithEndpointFactory(
  payload: PreparedDeclarativeConfigWorkerPayload,
  options: DeclarativeConfigWorkerRunnerOptions,
  endpointFactory: DeclarativeConfigWorkerEndpointFactory,
): WorkerEvaluationOperation {
  const timeoutMs = validateTimeoutMs(options.timeoutMs);
  const signal = options.signal;
  if (signal?.aborted) {
    return {
      result: Promise.reject(
        createDeclarativeConfigWorkerInfrastructureError("worker-aborted"),
      ),
      drained: Promise.resolve(),
    };
  }

  let resolveDrained: (() => void) | undefined;
  const drained = new Promise<void>((resolve) => {
    resolveDrained = resolve;
  });
  let factorySettled = false;
  let endpointTerminated = true;
  let lifecycleDrained = false;

  const result = new Promise<ConfigSnapshotRecord>((resolve, reject) => {
    let endpoint: DeclarativeConfigWorkerEndpoint | undefined;
    let unsubscribe: (() => void) | undefined;
    let settled = false;
    let terminationRequested = false;
    let terminatedEndpoint: DeclarativeConfigWorkerEndpoint | undefined;
    let endpointTermination: Promise<void> | undefined;

    const drainLifecycleIfComplete = (): void => {
      if (
        lifecycleDrained ||
        !settled ||
        !factorySettled ||
        !endpointTerminated
      ) {
        return;
      }
      lifecycleDrained = true;
      resolveDrained?.();
      resolveDrained = undefined;
    };

    const terminate = async (
      candidate: DeclarativeConfigWorkerEndpoint | undefined = endpoint,
    ): Promise<void> => {
      terminationRequested = true;
      if (!candidate) {
        drainLifecycleIfComplete();
        return;
      }
      if (terminatedEndpoint === candidate) {
        await endpointTermination;
        return;
      }
      terminatedEndpoint = candidate;
      endpointTermination = (async () => {
        try {
          await candidate.terminate();
        } catch {
          // The request is already terminal. Termination failures must not
          // replace the stable worker outcome or expose runtime diagnostics.
        } finally {
          endpointTerminated = true;
          drainLifecycleIfComplete();
        }
      })();
      await endpointTermination;
    };

    const cleanup = () => {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener("abort", onAbort);
      const release = unsubscribe;
      unsubscribe = undefined;
      try {
        release?.();
      } catch {
        // Listener cleanup is best-effort after the endpoint is terminal.
      }
    };

    const settle = async (outcome: WorkerOutcome): Promise<void> => {
      if (settled) return;
      settled = true;
      cleanup();
      await terminate();
      if (outcome.kind === "resolve") resolve(outcome.value);
      else reject(outcome.error);
    };

    const rejectInfrastructure = (
      reason:
        | "worker-aborted"
        | "worker-protocol"
        | "worker-timeout"
        | "worker-unavailable",
    ) => {
      void settle({
        kind: "reject",
        error: createDeclarativeConfigWorkerInfrastructureError(reason),
      });
    };

    const onAbort = () => {
      rejectInfrastructure("worker-aborted");
    };

    const timeout = setTimeout(() => {
      rejectInfrastructure("worker-timeout");
    }, timeoutMs);

    signal?.addEventListener("abort", onAbort, { once: true });

    void (async () => {
      let createdEndpoint: DeclarativeConfigWorkerEndpoint;
      try {
        createdEndpoint = await endpointFactory();
      } catch {
        factorySettled = true;
        rejectInfrastructure("worker-unavailable");
        drainLifecycleIfComplete();
        return;
      }

      factorySettled = true;
      endpoint = createdEndpoint;
      endpointTerminated = false;
      if (settled || terminationRequested) {
        await terminate(createdEndpoint);
        return;
      }

      try {
        const release = createdEndpoint.subscribe({
          onMessage(value) {
            if (settled) return;
            try {
              const decoded = decodeDeclarativeConfigWorkerResponse(
                value,
                payload.evaluationOptions.source.length,
              );
              void settle({ kind: "resolve", value: decoded.snapshot });
            } catch (error) {
              void settle({ kind: "reject", error });
            }
          },
          onError() {
            rejectInfrastructure("worker-unavailable");
          },
          onMessageError() {
            rejectInfrastructure("worker-protocol");
          },
          onExit() {
            rejectInfrastructure("worker-unavailable");
          },
        });
        if (settled) {
          try {
            release();
          } catch {
            // A synchronous terminal event won the subscription race.
          }
          return;
        }
        unsubscribe = release;
        createdEndpoint.postMessage(payload);
      } catch {
        rejectInfrastructure("worker-unavailable");
      }
    })();
  });

  return { result, drained };
}

async function evaluateWithEndpointFactory(
  payload: PreparedDeclarativeConfigWorkerPayload,
  options: DeclarativeConfigWorkerRunnerOptions,
  endpointFactory: DeclarativeConfigWorkerEndpointFactory,
): Promise<ConfigSnapshotRecord> {
  return await beginEvaluationWithEndpointFactory(
    payload,
    options,
    endpointFactory,
  ).result;
}

async function evaluateWithAdmissionController(
  payload: PreparedDeclarativeConfigWorkerPayload,
  options: DeclarativeConfigWorkerRunnerOptions,
  endpointFactory: DeclarativeConfigWorkerEndpointFactory,
  admissionController: DeclarativeConfigWorkerAdmissionController,
): Promise<ConfigSnapshotRecord> {
  const timeoutMs = validateTimeoutMs(options.timeoutMs);
  const startedAt = monotonicNow();
  const release = await admissionController.acquire(
    timeoutMs,
    options.signal,
  );

  let operation: WorkerEvaluationOperation;
  try {
    const remainingMs = Math.ceil(
      timeoutMs - (monotonicNow() - startedAt),
    );
    if (remainingMs < 1) {
      throw createDeclarativeConfigWorkerInfrastructureError(
        "worker-timeout",
      );
    }
    operation = beginEvaluationWithEndpointFactory(
      payload,
      {
        signal: options.signal,
        timeoutMs: remainingMs,
      },
      endpointFactory,
    );
  } catch (error) {
    release();
    throw error;
  }

  // A caller deadline must not return the resource permit while asynchronous
  // startup can still construct a worker. The result may reject promptly, but
  // admission remains occupied until that late endpoint has been terminated.
  void operation.drained.then(release);
  return await operation.result;
}

/**
 * Evaluate one prepared hosted configuration in a fresh, bounded worker.
 *
 * The returned snapshot is decoded, recanonicalized, and deeply frozen by the
 * host before it crosses back into trusted application code.
 */
export async function evaluatePreparedDeclarativeConfigInWorker(
  payload: PreparedDeclarativeConfigWorkerPayload,
  options: DeclarativeConfigWorkerRunnerOptions = {},
): Promise<ConfigSnapshotRecord> {
  return await evaluateWithAdmissionController(
    payload,
    options,
    createRuntimeWorkerEndpoint,
    workerAdmissionController,
  );
}

/** @internal Test seam for deterministic lifecycle and protocol tests. */
export const declarativeConfigWorkerRunnerInternals = Object.freeze({
  createAdmissionController(
    maxActive: number,
    maxQueued: number,
  ): DeclarativeConfigWorkerAdmissionController {
    return new DeclarativeConfigWorkerAdmissionController(
      maxActive,
      maxQueued,
    );
  },
  evaluateWithAdmissionController,
  evaluateWithEndpointFactory,
});
