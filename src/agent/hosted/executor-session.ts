import {
  createExecutorChannel,
  type ExecutorChannel,
  type ExecutorOperation,
} from "../executor/channel.ts";
import { EXECUTOR_MAX_TIMEOUT_MS } from "../executor/protocol.ts";
import { performanceMonotonicClock } from "../streaming/lifecycle/clock.ts";
import type { MonotonicClock } from "../streaming/lifecycle/types.ts";
import {
  type AbsoluteDeadlineTimer,
  createClockDeadlineTimer,
} from "../streaming/lifecycle/deadlines.ts";
import { awaitAbortable } from "#veryfront/utils/abort.ts";
import type {
  ConnectExecutorTransportOptions,
  ExecutorNodeTransport,
} from "./executor-node-transport.ts";
import {
  getHostedExecutorAllocationRequestSchema,
  getHostedExecutorAllocationSchema,
  getHostedExecutorBindingSchema,
  getHostedExecutorImageSchema,
  type HostedExecutorAllocation,
  type HostedExecutorAllocationRequest,
  type HostedExecutorBinding,
  parseHostedExecutorData,
  readHostedExecutorBinding,
  sameHostedExecutorBinding,
} from "./executor-session-schema.ts";

/** Trusted authenticated client. No HTTP envelopes, service credentials, or endpoint selection. */
export interface HostedExecutorAllocatorClient {
  /** Snapshot channelKey synchronously before awaiting; the session clears its buffer. */
  allocate(
    request: HostedExecutorAllocationRequest,
    bootstrap: { channelKey: Uint8Array },
    signal: AbortSignal,
  ): Promise<unknown>;
  observe(binding: HostedExecutorBinding, signal: AbortSignal): Promise<unknown>;
  renew(binding: HostedExecutorBinding, signal: AbortSignal): Promise<unknown>;
  release(
    binding: HostedExecutorBinding,
    reason: "completed" | "canceled",
    signal: AbortSignal,
  ): Promise<unknown>;
}

export interface HostedExecutorSessionClock extends AbsoluteDeadlineTimer {
  /** UTC epoch milliseconds, nondecreasing for the session lifetime. */
  now(): number;
}

export interface HostedExecutorSessionOptions {
  request: HostedExecutorAllocationRequest;
  /** Authenticated broker Pod UID, independently known by the trusted caller. */
  expectedBrokerInstanceId: string;
  /** Digest-pinned image independently resolved for request.source by the trusted caller. */
  expectedImage: string;
  allocator: HostedExecutorAllocatorClient;
  /** Authenticate one connection. Snapshot the allocation key before awaiting. */
  connectTransport(options: ConnectExecutorTransportOptions): Promise<ExecutorNodeTransport>;
  /** Factory must release its own partial resources if construction throws. */
  createOperations(binding: Readonly<HostedExecutorBinding>, signal: AbortSignal): {
    operations: ReadonlyMap<string, ExecutorOperation>;
    revoke(): void;
  };
  preparationSignal?: AbortSignal;
  /** Service/session ownership that always survives acceptance. */
  ownerSignal?: AbortSignal;
  clock?: HostedExecutorSessionClock;
  /** Default 250 ms, maximum 30 seconds. */
  pollIntervalMs?: number;
  /** Default five seconds, maximum 30 seconds. */
  requestTimeoutMs?: number;
  /** Bounded task retirement and release; default five seconds, maximum 30 seconds. */
  cleanupTimeoutMs?: number;
}

export interface HostedExecutorSessionCloseResult {
  reason: string;
  /** Allocator release acknowledgement; independent of pending broker work in session.settled. */
  release: "not-allocated" | "released" | "reaper-required";
}

export interface HostedExecutorSession {
  /** TLS and invocation-channel readiness, before remote runtime preparation/acceptance. */
  readonly ready: Promise<ExecutorChannel>;
  /** Bounded cleanup notification. It does not release process admission. */
  readonly closed: Promise<HostedExecutorSessionCloseResult>;
  /** Release process admission only after raw client and channel handler/I/O work settles, even beyond close's timeout. */
  readonly settled: Promise<void>;
  readonly signal: AbortSignal;
  readonly binding: Readonly<HostedExecutorBinding> | undefined;
  readonly accepted: boolean;
  /** Call after remote preparation. Execution ownership detaches the preparation request before 202. */
  accept(ownership: { kind: "request" } | { kind: "execution"; signal?: AbortSignal }): void;
  close(reason?: "completed" | "canceled"): Promise<HostedExecutorSessionCloseResult>;
}

/** Anchor once to UTC; later wall-clock adjustments cannot move an active session's clock backward. */
export function createHostedExecutorSessionClock(
  epochMs: number,
  elapsed: MonotonicClock = performanceMonotonicClock,
): HostedExecutorSessionClock {
  if (!Number.isSafeInteger(epochMs) || epochMs < 0) {
    throw new TypeError("Invalid executor session epoch");
  }
  const startedAt = elapsed.nowMs();
  return {
    now: () => epochMs + Math.floor(elapsed.nowMs() - startedAt),
    ...createClockDeadlineTimer(elapsed),
  };
}

function positiveLimit(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError("Executor session limit must be a bounded positive integer");
  }
  return value;
}

/** Own one allocation and one authenticated attachment; canonical run state stays with the API. */
export function createHostedExecutorSession(
  options: HostedExecutorSessionOptions,
): HostedExecutorSession {
  return new Session(options);
}

class Session implements HostedExecutorSession {
  readonly #request: HostedExecutorAllocationRequest;
  readonly #expectedBroker: string;
  readonly #expectedImage: string;
  readonly #allocator: HostedExecutorAllocatorClient;
  readonly #connect: HostedExecutorSessionOptions["connectTransport"];
  readonly #createOperations: HostedExecutorSessionOptions["createOperations"];
  readonly #clock: HostedExecutorSessionClock;
  readonly #pollInterval: number;
  readonly #requestTimeout: number;
  readonly #cleanupTimeout: number;
  readonly #controller = new AbortController();
  readonly #ready = Promise.withResolvers<ExecutorChannel>();
  readonly #closed = Promise.withResolvers<HostedExecutorSessionCloseResult>();
  readonly #settled = Promise.withResolvers<void>();
  readonly #timers = new Map<string, unknown>();
  readonly #tasks = new Set<Promise<unknown>>();
  readonly #key: Uint8Array;
  readonly #preparationSignal?: AbortSignal;
  readonly #ownerSignal?: AbortSignal;
  readonly #preparationAbort = () => this.#stop("canceled");
  readonly #ownerAbort = () => this.#stop("canceled");
  #executionSignal?: AbortSignal;
  #binding?: HostedExecutorBinding;
  #endpoint?: NonNullable<HostedExecutorAllocation["endpoint"]>;
  #transport?: ExecutorNodeTransport;
  #channel?: ExecutorChannel;
  #grant?: ReturnType<HostedExecutorSessionOptions["createOperations"]>;
  #lastNow = 0;
  #expiresAt = 0;
  #renewAt = 0;
  #attached = false;
  #isReady = false;
  #accepted = false;
  #stopped = false;
  #allocationAttempted = false;
  #releaseAttempted = false;
  #releaseConfirmed = false;
  #releaseReason: "completed" | "canceled" = "canceled";
  #reason = "canceled";
  #failure?: Error;
  #cleanup?: AbortController;
  #cleanupTimer?: unknown;
  #cleanupFinished = false;

  constructor(options: HostedExecutorSessionOptions) {
    const request = parseHostedExecutorData(
      getHostedExecutorAllocationRequestSchema(),
      options.request,
    );
    this.#request = Object.freeze({ ...request, source: Object.freeze(request.source) });
    this.#expectedBroker = options.expectedBrokerInstanceId;
    this.#expectedImage = parseHostedExecutorData(
      getHostedExecutorImageSchema(),
      options.expectedImage,
    );
    parseHostedExecutorData(getHostedExecutorBindingSchema(), {
      allocationId: request.allocationId,
      invocationId: request.invocationId,
      generation: 1,
      projectId: request.projectId,
      source: request.source,
      brokerInstanceId: this.#expectedBroker,
    });
    this.#allocator = {
      allocate: options.allocator.allocate.bind(options.allocator),
      observe: options.allocator.observe.bind(options.allocator),
      renew: options.allocator.renew.bind(options.allocator),
      release: options.allocator.release.bind(options.allocator),
    };
    this.#connect = options.connectTransport;
    this.#createOperations = options.createOperations;
    this.#clock = options.clock ?? createHostedExecutorSessionClock(Date.now());
    this.#pollInterval = positiveLimit(options.pollIntervalMs ?? 250, 30_000);
    this.#requestTimeout = positiveLimit(options.requestTimeoutMs ?? 5000, 30_000);
    this.#cleanupTimeout = positiveLimit(options.cleanupTimeoutMs ?? 5000, 30_000);
    const now = this.#now();
    if (
      request.requestedAt > now || request.prepareDeadlineAt <= now ||
      request.hardDeadlineAt - request.requestedAt > EXECUTOR_MAX_TIMEOUT_MS
    ) {
      throw new TypeError("Executor session deadline is expired or unbounded");
    }
    this.#preparationSignal = options.preparationSignal;
    this.#ownerSignal = options.ownerSignal;
    this.#key = crypto.getRandomValues(new Uint8Array(32));
    void this.ready.catch(() => {});
    this.#schedule("hard", request.hardDeadlineAt - now, () => this.#stop("expired"));
    this.#schedule(
      "preparation",
      request.prepareDeadlineAt - now,
      () => this.#stop("preparation-timeout"),
    );
    options.preparationSignal?.addEventListener("abort", this.#preparationAbort, { once: true });
    options.ownerSignal?.addEventListener("abort", this.#ownerAbort, { once: true });
    if (options.preparationSignal?.aborted || options.ownerSignal?.aborted) this.#stop("canceled");
    else void this.#allocate();
  }

  get ready(): Promise<ExecutorChannel> {
    return this.#ready.promise;
  }
  get closed(): Promise<HostedExecutorSessionCloseResult> {
    return this.#closed.promise;
  }
  get settled(): Promise<void> {
    return this.#settled.promise;
  }
  get signal(): AbortSignal {
    return this.#controller.signal;
  }
  get binding(): Readonly<HostedExecutorBinding> | undefined {
    return this.#binding;
  }
  get accepted(): boolean {
    return this.#accepted;
  }

  accept(ownership: { kind: "request" } | { kind: "execution"; signal?: AbortSignal }): void {
    if (this.#stopped) throw this.#failure;
    if (!this.#isReady || this.#accepted) {
      throw new Error("Executor session cannot accept in its current state");
    }
    this.#assertActive();
    if (ownership.kind !== "request" && ownership.kind !== "execution") {
      throw new TypeError("Invalid executor session ownership");
    }
    if (ownership.kind === "request" && !this.#preparationSignal) {
      throw new TypeError("Executor request ownership requires a preparation signal");
    }
    if (ownership.kind === "execution") {
      if (ownership.signal?.aborted) {
        this.#stop("canceled");
        throw this.#failure;
      }
      this.#preparationSignal?.removeEventListener("abort", this.#preparationAbort);
      this.#executionSignal = ownership.signal;
      ownership.signal?.addEventListener("abort", this.#ownerAbort, { once: true });
    }
    this.#accepted = true;
    this.#cancelTimer("preparation");
  }

  close(reason: "completed" | "canceled" = "canceled"): Promise<HostedExecutorSessionCloseResult> {
    this.#stop(reason);
    return this.closed;
  }

  #now(): number {
    const now = this.#clock.now();
    if (!Number.isSafeInteger(now) || now < this.#lastNow) {
      throw new Error("Executor session invalid clock");
    }
    this.#lastNow = now;
    return now;
  }

  #assertActive(): void {
    if (this.#stopped) throw this.#failure;
    const now = this.#now();
    if (now >= this.#request.hardDeadlineAt || (this.#expiresAt && now >= this.#expiresAt)) {
      this.#stop("expired");
    } else if (!this.#accepted && now >= this.#request.prepareDeadlineAt) {
      this.#stop("preparation-timeout");
    }
    if (this.#stopped) throw this.#failure;
  }

  #schedule(name: string, delay: number, action: () => void): void {
    this.#cancelTimer(name);
    if (this.#stopped) return;
    this.#timers.set(
      name,
      this.#clock.schedule(() => {
        this.#timers.delete(name);
        if (this.#stopped) return;
        try {
          action();
        } catch {
          this.#stop("lifecycle-failed");
        }
      }, delay),
    );
  }

  #cancelTimer(name: string): void {
    if (this.#timers.has(name)) this.#clock.cancel(this.#timers.get(name));
    this.#timers.delete(name);
  }

  #track<T>(operation: () => Promise<T>, observe?: (value: T) => void): Promise<T> {
    const tracked = Promise.withResolvers<T>();
    this.#tasks.add(tracked.promise);
    void tracked.promise.catch(() => {});
    void (async () => {
      try {
        const value = await operation();
        observe?.(value);
        tracked.resolve(value);
      } catch (error) {
        tracked.reject(error);
      } finally {
        this.#tasks.delete(tracked.promise);
        this.#settle();
      }
    })();
    return tracked.promise;
  }

  async #perform<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    observe?: (value: T) => void,
  ): Promise<T> {
    this.#assertActive();
    const controller = new AbortController();
    const abort = () => controller.abort(new Error("Executor session operation canceled"));
    this.signal.addEventListener("abort", abort, { once: true });
    const timer = this.#clock.schedule(abort, this.#requestTimeout);
    try {
      return await awaitAbortable(
        this.#track(() => operation(controller.signal), observe),
        controller.signal,
      );
    } finally {
      this.#clock.cancel(timer);
      this.signal.removeEventListener("abort", abort);
    }
  }

  async #allocate(): Promise<void> {
    try {
      this.#allocationAttempted = true;
      const value = await this.#perform(
        (signal) => this.#allocator.allocate(this.#request, { channelKey: this.#key }, signal),
        (value) => this.#captureBinding(value),
      );
      if (!this.#stopped) this.#applyView(value);
    } catch {
      this.#stop("allocation-failed");
    }
  }

  #captureBinding(value: unknown): void {
    const binding = readHostedExecutorBinding(value);
    const expected = this.#binding ?? {
      allocationId: this.#request.allocationId,
      invocationId: this.#request.invocationId,
      projectId: this.#request.projectId,
      source: this.#request.source,
      brokerInstanceId: this.#expectedBroker,
      generation: binding.generation,
    };
    if (!sameHostedExecutorBinding(binding, expected)) {
      throw new Error("Executor session allocation identity mismatch");
    }
    this.#binding = binding;
    if (this.#stopped) this.#releaseOnce();
  }

  #applyView(value: unknown, renewing = false): void {
    this.#assertActive();
    this.#captureBinding(value);
    const view = parseHostedExecutorData(getHostedExecutorAllocationSchema(), value);
    const now = this.#now();
    if (view.phase === "released" || view.phase === "terminating") {
      this.#stop(view.reason ?? "allocation-unavailable");
      return;
    }
    if (
      view.expiresAt <= now || view.expiresAt > this.#request.hardDeadlineAt ||
      view.expiresAt < this.#expiresAt ||
      (renewing && view.expiresAt === this.#expiresAt &&
        view.expiresAt < this.#request.hardDeadlineAt)
    ) {
      throw new Error("Executor session invalid lease");
    }
    if (
      this.#endpoint && (!view.endpoint || view.phase !== "ready" ||
        view.endpoint.address !== this.#endpoint.address ||
        view.endpoint.podUid !== this.#endpoint.podUid ||
        view.endpoint.nodeName !== this.#endpoint.nodeName ||
        view.endpoint.image !== this.#endpoint.image)
    ) {
      throw new Error("Executor session ready endpoint changed");
    }
    if (view.endpoint && view.endpoint.image !== this.#expectedImage) {
      throw new Error("Executor session image mismatch");
    }
    if (view.expiresAt !== this.#expiresAt) {
      this.#expiresAt = view.expiresAt;
      this.#renewAt = view.expiresAt === this.#request.hardDeadlineAt
        ? Number.POSITIVE_INFINITY
        : now + Math.max(1, Math.floor((view.expiresAt - now) / 2));
    }
    this.#schedule("lease", view.expiresAt - now, () => this.#stop("expired"));
    if (view.phase === "ready" && view.endpoint && !this.#attached) {
      this.#attached = true;
      this.#endpoint = Object.freeze(view.endpoint);
      void this.#attach();
    }
    this.#schedule(
      "monitor",
      Math.min(this.#pollInterval, Math.max(1, this.#renewAt - now)),
      () => {
        void this.#monitor();
      },
    );
  }

  async #monitor(): Promise<void> {
    if (this.#stopped || !this.#binding) return;
    try {
      const renewing = this.#now() >= this.#renewAt;
      const binding = this.#binding;
      const value = await this.#perform((signal) =>
        renewing ? this.#allocator.renew(binding, signal) : this.#allocator.observe(binding, signal)
      );
      if (!this.#stopped) this.#applyView(value, renewing);
    } catch {
      this.#stop("allocation-unavailable");
    }
  }

  async #attach(): Promise<void> {
    try {
      this.#assertActive();
      this.#schedule("attachment", this.#requestTimeout, () => this.#stop("attachment-timeout"));
      const binding = this.#binding!;
      const channelBinding = {
        allocationId: binding.allocationId,
        generation: binding.generation,
        invocationId: binding.invocationId,
      };
      const connection = this.#track(
        () =>
          this.#connect({
            podIp: this.#endpoint!.address,
            port: this.#endpoint!.port,
            binding: channelBinding,
            key: this.#key,
            signal: this.signal,
            timeoutMs: this.#request.hardDeadlineAt - this.#now(),
          }),
        (transport) => {
          if (this.#stopped) transport.close();
          else this.#transport = transport;
        },
      );
      const transport = await awaitAbortable(connection, this.signal);
      this.#assertActive();
      this.#key.fill(0);
      this.#grant = this.#createOperations(binding, this.signal);
      if (this.#stopped) {
        this.#grant.revoke();
        return;
      }
      this.#channel = createExecutorChannel({
        binding: channelBinding,
        transport,
        operations: this.#grant.operations,
        defaultTimeoutMs: Math.max(1, this.#request.hardDeadlineAt - this.#now()),
      });
      this.#track(() => this.#channel!.settled);
      void this.#channel.closed.then(() => this.#stop("channel-closed"));
      await awaitAbortable(this.#channel.ready, this.signal);
      this.#assertActive();
      this.#cancelTimer("attachment");
      this.#isReady = true;
      this.#ready.resolve(this.#channel);
    } catch {
      this.#stop("attachment-failed");
    } finally {
      this.#key.fill(0);
    }
  }

  #stop(reason: string): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#reason = reason;
    this.#releaseReason = reason === "completed" ? "completed" : "canceled";
    this.#failure = new Error(`Executor session ${reason}`);
    this.#ready.reject(this.#failure);
    this.#preparationSignal?.removeEventListener("abort", this.#preparationAbort);
    this.#ownerSignal?.removeEventListener("abort", this.#ownerAbort);
    this.#executionSignal?.removeEventListener("abort", this.#ownerAbort);
    for (const name of this.#timers.keys()) this.#cancelTimer(name);
    try {
      this.#grant?.revoke();
    } catch {
      this.#reason = "operation-revocation-failed";
    }
    this.#channel?.close();
    this.#controller.abort(this.#failure);
    try {
      this.#transport?.close();
    } catch {
      this.#reason = "transport-cleanup-failed";
    }
    this.#key.fill(0);
    this.#cleanup = new AbortController();
    this.#cleanupTimer = this.#clock.schedule(() => this.#cleanup!.abort(), this.#cleanupTimeout);
    this.#releaseOnce();
    void this.#finishCleanup();
  }

  #releaseOnce(): void {
    if (
      this.#releaseAttempted || !this.#binding || !this.#cleanup || this.#cleanup.signal.aborted
    ) return;
    this.#releaseAttempted = true;
    const binding = this.#binding;
    const signal = this.#cleanup.signal;
    void this.#track(
      () =>
        this.#allocator.release(
          binding,
          this.#releaseReason,
          signal,
        ),
      (value) => {
        const released = parseHostedExecutorData(getHostedExecutorAllocationSchema(), value);
        if (
          !sameHostedExecutorBinding(released.binding, binding) ||
          (released.phase !== "released" && released.phase !== "terminating")
        ) throw new Error("Executor session invalid release acknowledgement");
        this.#releaseConfirmed = released.phase === "released";
      },
    ).catch(() => {/* The independent allocator reaper retains responsibility. */});
  }

  async #finishCleanup(): Promise<void> {
    const signal = this.#cleanup!.signal;
    try {
      while (this.#tasks.size) await awaitAbortable(Promise.allSettled([...this.#tasks]), signal);
    } catch {
      /* Notification is bounded even if an injected client ignores cancellation. */
    } finally {
      this.#clock.cancel(this.#cleanupTimer);
      this.#cleanup!.abort();
      this.#closed.resolve({
        reason: this.#reason,
        release: !this.#allocationAttempted
          ? "not-allocated"
          : this.#releaseConfirmed
          ? "released"
          : "reaper-required",
      });
      this.#cleanupFinished = true;
      this.#settle();
    }
  }

  #settle(): void {
    if (this.#cleanupFinished && this.#tasks.size === 0) this.#settled.resolve();
  }
}
