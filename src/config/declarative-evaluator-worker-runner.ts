/**
 * Killable worker boundary for hosted declarative configuration evaluation.
 *
 * Each request receives a fresh worker. A synchronous parser stall therefore
 * cannot retain a pooled worker generation or block the host event loop.
 *
 * @module
 */

import { isBun, isDeno, isNode } from "#veryfront/platform/compat/runtime.ts";
import {
  DeclarativeConfigEvaluationError,
  type PreparedDeclarativeConfigWorkerPayload,
} from "./declarative-evaluator.ts";
import type { ConfigSnapshotRecord } from "./snapshot.ts";
import {
  createDeclarativeConfigWorkerInfrastructureError,
  decodeDeclarativeConfigWorkerResponse,
} from "./declarative-evaluator-worker-protocol.ts";

// Capture lifecycle-critical primordials before arbitrary trusted project code
// can mutate the shared host realm. Hosted configuration may run later in the
// same process; admission, cancellation, and cleanup must retain their original
// semantics even if ambient prototypes have been replaced.
const IntrinsicPromise = Promise;
const ArrayPrototypeIndexOf = Array.prototype.indexOf;
const ArrayPrototypePush = Array.prototype.push;
const ArrayPrototypeShift = Array.prototype.shift;
const ArrayPrototypeSplice = Array.prototype.splice;
const EventTargetPrototypeAddEventListener = EventTarget.prototype.addEventListener;
const EventTargetPrototypeRemoveEventListener = EventTarget.prototype.removeEventListener;
const MathCeil = Math.ceil;
const NumberIsSafeInteger = Number.isSafeInteger;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const PromisePrototypeThen = Promise.prototype.then;
const PromiseReject = Promise.reject;
const PromiseResolve = Promise.resolve;
const ReflectApply = Reflect.apply;
const abortSignalAbortedGetter = ObjectGetOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)?.get;
const scheduleTimeout = globalThis.setTimeout;
const cancelTimeout = globalThis.clearTimeout;

if (typeof abortSignalAbortedGetter !== "function") {
  throw new TypeError("AbortSignal intrinsics are unavailable");
}
const intrinsicAbortSignalAbortedGetter = abortSignalAbortedGetter as () => boolean;

function freezeObject<T>(value: T): T {
  return ReflectApply(ObjectFreeze, Object, [value]) as T;
}

function isSignalAborted(signal: AbortSignal): boolean {
  return ReflectApply(intrinsicAbortSignalAbortedGetter, signal, []) as boolean;
}

function addAbortListener(signal: AbortSignal, listener: () => void): void {
  ReflectApply(EventTargetPrototypeAddEventListener, signal, [
    "abort",
    listener,
    { once: true },
  ]);
}

function removeAbortListener(signal: AbortSignal, listener: () => void): void {
  ReflectApply(EventTargetPrototypeRemoveEventListener, signal, [
    "abort",
    listener,
  ]);
}

function addEventTargetListener(
  target: EventTarget,
  type: string,
  listener: EventListener,
): void {
  ReflectApply(EventTargetPrototypeAddEventListener, target, [
    type,
    listener,
  ]);
}

function removeEventTargetListener(
  target: EventTarget,
  type: string,
  listener: EventListener,
): void {
  ReflectApply(EventTargetPrototypeRemoveEventListener, target, [
    type,
    listener,
  ]);
}

function arrayPush<T>(array: T[], value: T): void {
  ReflectApply(ArrayPrototypePush, array, [value]);
}

function arrayShift<T>(array: T[]): T | undefined {
  return ReflectApply(ArrayPrototypeShift, array, []) as T | undefined;
}

function arrayIndexOf<T>(array: T[], value: T): number {
  return ReflectApply(ArrayPrototypeIndexOf, array, [value]) as number;
}

function arraySpliceOne<T>(array: T[], index: number): void {
  ReflectApply(ArrayPrototypeSplice, array, [index, 1]);
}

function promiseResolve<T>(value: T | PromiseLike<T>): Promise<Awaited<T>> {
  return ReflectApply(PromiseResolve, IntrinsicPromise, [value]) as Promise<Awaited<T>>;
}

function promiseResolveVoid(): Promise<void> {
  return ReflectApply(PromiseResolve, IntrinsicPromise, []) as Promise<void>;
}

function promiseReject<T = never>(error: unknown): Promise<T> {
  return ReflectApply(PromiseReject, IntrinsicPromise, [error]) as Promise<T>;
}

function thenPromise<T, TResult1 = T, TResult2 = never>(
  promise: Promise<T>,
  onFulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
  onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
): Promise<TResult1 | TResult2> {
  return ReflectApply(PromisePrototypeThen, promise, [
    onFulfilled,
    onRejected,
  ]) as Promise<TResult1 | TResult2>;
}

const DEFAULT_WORKER_TIMEOUT_MS = 5_000;
const MAX_WORKER_TIMEOUT_MS = 30_000;
const DEFAULT_WORKER_TERMINATION_DRAIN_TIMEOUT_MS = 1_000;
const MAX_WORKER_TERMINATION_DRAIN_TIMEOUT_MS = 5_000;
const NODE_WORKER_RESOURCE_LIMITS = freezeObject({
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
export const DECLARATIVE_CONFIG_WORKER_ADMISSION_LIMITS = freezeObject({
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
   * Ordinary evaluation lifecycle. This drains after caller settlement and
   * bounded termination of any endpoint that is already known.
   */
  readonly drained: Promise<void>;
  /**
   * Underlying endpoint-factory lifecycle. A never-settling factory remains
   * counted here after ordinary capacity is released, so repeated calls cannot
   * create an unbounded number of orphan startup attempts.
   */
  readonly startupDrained: Promise<void>;
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
      !NumberIsSafeInteger(maxActive) ||
      maxActive < 1 ||
      !NumberIsSafeInteger(maxQueued) ||
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
    if (signal && isSignalAborted(signal)) {
      return promiseReject(
        createDeclarativeConfigWorkerInfrastructureError("worker-aborted"),
      );
    }
    if (this.#active < this.#maxActive) {
      this.#active += 1;
      return promiseResolve(this.#createRelease());
    }
    if (this.#queue.length >= this.#maxQueued) {
      return promiseReject(
        createDeclarativeConfigWorkerInfrastructureError("worker-overloaded"),
      );
    }

    return new IntrinsicPromise<() => void>((resolve, reject) => {
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
      pending.timeout = scheduleTimeout(() => {
        this.#rejectQueued(
          pending,
          createDeclarativeConfigWorkerInfrastructureError("worker-timeout"),
        );
      }, timeoutMs);
      arrayPush(this.#queue, pending);
      if (signal) {
        addAbortListener(signal, pending.onAbort);
        if (isSignalAborted(signal)) pending.onAbort();
      }
    });
  }

  snapshot(): Readonly<{ active: number; queued: number }> {
    return freezeObject({
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
      cancelTimeout(pending.timeout);
      pending.timeout = undefined;
    }
    if (pending.signal) removeAbortListener(pending.signal, pending.onAbort);
  }

  #removeQueued(pending: PendingAdmission): void {
    const index = arrayIndexOf(this.#queue, pending);
    if (index !== -1) arraySpliceOne(this.#queue, index);
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
      const pending = arrayShift(this.#queue);
      if (!pending || pending.settled) continue;
      pending.settled = true;
      this.#cleanupPending(pending);
      this.#active += 1;
      pending.resolve(this.#createRelease());
    }
  }
}

class DeclarativeConfigWorkerStartupController {
  readonly #maxPending: number;
  #pending = 0;

  constructor(maxPending: number) {
    if (!NumberIsSafeInteger(maxPending) || maxPending < 1) {
      throw new TypeError(
        "Declarative config worker startup limit must be a positive safe integer",
      );
    }
    this.#maxPending = maxPending;
  }

  acquire(): () => void {
    if (this.#pending >= this.#maxPending) {
      throw createDeclarativeConfigWorkerInfrastructureError(
        "worker-overloaded",
      );
    }
    this.#pending += 1;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#pending -= 1;
    };
  }

  snapshot(): Readonly<{ pending: number; maxPending: number }> {
    return freezeObject({
      pending: this.#pending,
      maxPending: this.#maxPending,
    });
  }
}

const workerAdmissionController = new DeclarativeConfigWorkerAdmissionController(
  DECLARATIVE_CONFIG_WORKER_ADMISSION_LIMITS.maxActive,
  DECLARATIVE_CONFIG_WORKER_ADMISSION_LIMITS.maxQueued,
);
const workerStartupController = new DeclarativeConfigWorkerStartupController(
  DECLARATIVE_CONFIG_WORKER_ADMISSION_LIMITS.maxActive,
);

function validateTimeoutMs(value: unknown): number {
  if (value === undefined) return DEFAULT_WORKER_TIMEOUT_MS;
  if (
    typeof value !== "number" ||
    !NumberIsSafeInteger(value) ||
    value < 1 ||
    value > MAX_WORKER_TIMEOUT_MS
  ) {
    throw new TypeError(
      `Declarative config worker timeoutMs must be an integer from 1 to ${MAX_WORKER_TIMEOUT_MS}`,
    );
  }
  return value;
}

function validateTerminationDrainTimeoutMs(value: unknown): number {
  if (
    typeof value !== "number" ||
    !NumberIsSafeInteger(value) ||
    value < 1 ||
    value > MAX_WORKER_TERMINATION_DRAIN_TIMEOUT_MS
  ) {
    throw new TypeError(
      `Declarative config worker termination drain timeout must be an integer from 1 to ${MAX_WORKER_TERMINATION_DRAIN_TIMEOUT_MS}`,
    );
  }
  return value;
}

/**
 * Invoke endpoint termination exactly once and contain every completion mode.
 *
 * Native worker implementations normally terminate promptly, but a runtime
 * shim must not keep caller settlement or process-wide admission occupied
 * forever. The rejection handler remains attached after the bounded drain
 * completes, so a late failure cannot become an unhandled rejection.
 */
function drainEndpointTermination(
  endpoint: DeclarativeConfigWorkerEndpoint,
  timeoutMs: number,
): Promise<void> {
  let termination: Promise<unknown>;
  try {
    termination = promiseResolve(endpoint.terminate());
  } catch {
    return promiseResolveVoid();
  }

  return new IntrinsicPromise<void>((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) {
        cancelTimeout(timeout);
        timeout = undefined;
      }
      resolve();
    };

    timeout = scheduleTimeout(finish, timeoutMs);
    void thenPromise(termination, finish, finish);
  });
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

      addEventTargetListener(worker, "message", onMessage as EventListener);
      addEventTargetListener(worker, "error", onError as EventListener);
      addEventTargetListener(worker, "messageerror", onMessageError);
      return () => {
        removeEventTargetListener(worker, "message", onMessage as EventListener);
        removeEventTargetListener(worker, "error", onError as EventListener);
        removeEventTargetListener(worker, "messageerror", onMessageError);
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
    // Source workers need the parent's registered TypeScript and import-map
    // loader. Built JavaScript workers still start without host execution hooks.
    ...(import.meta.url.endsWith(".ts") ? {} : { execArgv: [] }),
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
  if (isBun) {
    throw createDeclarativeConfigWorkerInfrastructureError(
      "worker-memory-limit-unavailable",
    );
  }
  if (isNode) return await createNodeWorkerEndpoint();
  throw createDeclarativeConfigWorkerInfrastructureError("worker-unavailable");
}

function beginEvaluationWithEndpointFactory(
  payload: PreparedDeclarativeConfigWorkerPayload,
  options: DeclarativeConfigWorkerRunnerOptions,
  endpointFactory: DeclarativeConfigWorkerEndpointFactory,
  terminationDrainTimeoutMs = DEFAULT_WORKER_TERMINATION_DRAIN_TIMEOUT_MS,
): WorkerEvaluationOperation {
  const timeoutMs = validateTimeoutMs(options.timeoutMs);
  const validatedTerminationDrainTimeoutMs = validateTerminationDrainTimeoutMs(
    terminationDrainTimeoutMs,
  );
  const signal = options.signal;
  if (signal && isSignalAborted(signal)) {
    return {
      result: promiseReject(
        createDeclarativeConfigWorkerInfrastructureError("worker-aborted"),
      ),
      drained: promiseResolveVoid(),
      startupDrained: promiseResolveVoid(),
    };
  }

  let resolveDrained: (() => void) | undefined;
  const drained = new IntrinsicPromise<void>((resolve) => {
    resolveDrained = resolve;
  });
  let resolveStartupDrained: (() => void) | undefined;
  const startupDrained = new IntrinsicPromise<void>((resolve) => {
    resolveStartupDrained = resolve;
  });
  let startupLifecycleDrained = false;
  let endpointTerminated = true;
  let lifecycleDrained = false;

  const result = new IntrinsicPromise<ConfigSnapshotRecord>((resolve, reject) => {
    let endpoint: DeclarativeConfigWorkerEndpoint | undefined;
    let unsubscribe: (() => void) | undefined;
    let settled = false;
    let terminationRequested = false;
    let terminatedEndpoint: DeclarativeConfigWorkerEndpoint | undefined;
    let endpointTermination: Promise<void> | undefined;

    const drainLifecycleIfComplete = (): void => {
      if (lifecycleDrained || !settled || !endpointTerminated) {
        return;
      }
      lifecycleDrained = true;
      resolveDrained?.();
      resolveDrained = undefined;
    };

    const drainStartupLifecycle = (): void => {
      if (startupLifecycleDrained) return;
      startupLifecycleDrained = true;
      resolveStartupDrained?.();
      resolveStartupDrained = undefined;
    };

    const terminate = (
      candidate: DeclarativeConfigWorkerEndpoint | undefined = endpoint,
    ): Promise<void> => {
      terminationRequested = true;
      if (!candidate) {
        drainLifecycleIfComplete();
        return promiseResolveVoid();
      }
      if (terminatedEndpoint === candidate) {
        return endpointTermination ?? promiseResolveVoid();
      }
      terminatedEndpoint = candidate;
      endpointTermination = drainEndpointTermination(
        candidate,
        validatedTerminationDrainTimeoutMs,
      );
      void thenPromise(endpointTermination, () => {
        if (terminatedEndpoint === candidate) {
          endpointTerminated = true;
          drainLifecycleIfComplete();
        }
      });
      return endpointTermination;
    };

    const cleanup = () => {
      cancelTimeout(timeout);
      if (signal) removeAbortListener(signal, onAbort);
      const release = unsubscribe;
      unsubscribe = undefined;
      try {
        release?.();
      } catch {
        // Listener cleanup is best-effort after the endpoint is terminal.
      }
    };

    const settle = (outcome: WorkerOutcome): void => {
      if (settled) return;
      settled = true;
      cleanup();
      void terminate();
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
      settle({
        kind: "reject",
        error: createDeclarativeConfigWorkerInfrastructureError(reason),
      });
    };

    const onAbort = () => {
      rejectInfrastructure("worker-aborted");
    };

    const timeout = scheduleTimeout(() => {
      rejectInfrastructure("worker-timeout");
    }, timeoutMs);

    if (signal) addAbortListener(signal, onAbort);

    void (async () => {
      let createdEndpoint: DeclarativeConfigWorkerEndpoint;
      try {
        createdEndpoint = await endpointFactory();
      } catch (error) {
        drainStartupLifecycle();
        if (
          error instanceof DeclarativeConfigEvaluationError &&
          error.phase === "worker"
        ) {
          settle({ kind: "reject", error });
        } else {
          rejectInfrastructure("worker-unavailable");
        }
        drainLifecycleIfComplete();
        return;
      }

      endpoint = createdEndpoint;
      endpointTerminated = false;
      if (settled || terminationRequested) {
        await terminate(createdEndpoint);
        drainStartupLifecycle();
        return;
      }
      // The ordinary active slot now owns the live endpoint, so unresolved
      // startup capacity can be returned before evaluation completes.
      drainStartupLifecycle();

      try {
        const release = createdEndpoint.subscribe({
          onMessage(value) {
            if (settled) return;
            try {
              const decoded = decodeDeclarativeConfigWorkerResponse(
                value,
                payload.evaluationOptions.source.length,
                payload.evaluationOptions.fileName,
              );
              settle({ kind: "resolve", value: decoded.snapshot });
            } catch (error) {
              settle({ kind: "reject", error });
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

  return { result, drained, startupDrained };
}

async function evaluateWithEndpointFactory(
  payload: PreparedDeclarativeConfigWorkerPayload,
  options: DeclarativeConfigWorkerRunnerOptions,
  endpointFactory: DeclarativeConfigWorkerEndpointFactory,
  terminationDrainTimeoutMs = DEFAULT_WORKER_TERMINATION_DRAIN_TIMEOUT_MS,
): Promise<ConfigSnapshotRecord> {
  return await beginEvaluationWithEndpointFactory(
    payload,
    options,
    endpointFactory,
    terminationDrainTimeoutMs,
  ).result;
}

async function evaluateWithAdmissionController(
  payload: PreparedDeclarativeConfigWorkerPayload,
  options: DeclarativeConfigWorkerRunnerOptions,
  endpointFactory: DeclarativeConfigWorkerEndpointFactory,
  admissionController: DeclarativeConfigWorkerAdmissionController,
  terminationDrainTimeoutMs = DEFAULT_WORKER_TERMINATION_DRAIN_TIMEOUT_MS,
  startupController: DeclarativeConfigWorkerStartupController = workerStartupController,
  /**
   * Monotonic clock used to charge admission wait time against the caller
   * deadline. Seamed so a test can hold it still: the budget check below
   * otherwise races real time spent inside `acquire`, and a starved worker can
   * exhaust a short deadline before the startup permit is ever taken. Both
   * outcomes report `worker-timeout`, but only one leaves the orphan accounted
   * for, so a test asserting that accounting cannot depend on wall time.
   */
  now: () => number = monotonicNow,
): Promise<ConfigSnapshotRecord> {
  const timeoutMs = validateTimeoutMs(options.timeoutMs);
  const startedAt = now();
  const release = await admissionController.acquire(
    timeoutMs,
    options.signal,
  );
  let releaseStartup: (() => void) | undefined;

  let operation: WorkerEvaluationOperation;
  try {
    const remainingMs = MathCeil(
      timeoutMs - (now() - startedAt),
    );
    if (remainingMs < 1) {
      throw createDeclarativeConfigWorkerInfrastructureError(
        "worker-timeout",
      );
    }
    releaseStartup = startupController.acquire();
    operation = beginEvaluationWithEndpointFactory(
      payload,
      {
        signal: options.signal,
        timeoutMs: remainingMs,
      },
      endpointFactory,
      terminationDrainTimeoutMs,
    );
  } catch (error) {
    releaseStartup?.();
    release();
    throw error;
  }

  // Ordinary evaluation capacity is returned at the caller deadline even when
  // endpoint creation never settles. The independent startup controller keeps
  // that orphan attempt counted and rejects additional factory calls once its
  // explicit bound is reached. A late factory result is terminated before its
  // startup permit is returned.
  void thenPromise(operation.drained, release);
  void thenPromise(operation.startupDrained, releaseStartup);
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
export const declarativeConfigWorkerRunnerInternals = freezeObject({
  createAdmissionController(
    maxActive: number,
    maxQueued: number,
  ): DeclarativeConfigWorkerAdmissionController {
    return new DeclarativeConfigWorkerAdmissionController(
      maxActive,
      maxQueued,
    );
  },
  createStartupController(
    maxPending: number,
  ): DeclarativeConfigWorkerStartupController {
    return new DeclarativeConfigWorkerStartupController(maxPending);
  },
  getGlobalLifecycleState(): Readonly<{
    admission: Readonly<{ active: number; queued: number }>;
    startup: Readonly<{ pending: number; maxPending: number }>;
  }> {
    return freezeObject({
      admission: workerAdmissionController.snapshot(),
      startup: workerStartupController.snapshot(),
    });
  },
  evaluateWithAdmissionController,
  evaluateWithEndpointFactory,
});
