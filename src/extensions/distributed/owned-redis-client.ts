import { INITIALIZATION_ERROR } from "#veryfront/errors";
import { ensureRedisRuntimeProvider } from "./defaults.ts";
import type {
  RedisClient,
  RedisClientHandle,
  RedisClientOptions,
} from "./redis-runtime-provider.ts";

export interface OwnedRedisClientLifecycle {
  onError?(error: unknown): void;
  onEnd?(): void;
  onCloseError?(error: unknown): void;
}

function connectionCancelledError(): Error {
  return INITIALIZATION_ERROR.create({
    detail: "Redis client connection was superseded while it was opening",
  });
}

function aggregateCloseFailures(failures: unknown[]): void {
  if (failures.length === 0) return;
  if (failures.length === 1) throw failures[0];
  throw new AggregateError(failures, "Redis client connection close failed");
}

/**
 * Own one extension-provided Redis connection for a core feature.
 *
 * Connections are single-flighted, retired before replacement, and retained
 * for a later cleanup retry when close fails.
 */
export class OwnedRedisClientConnection {
  readonly #options: Readonly<RedisClientOptions>;
  readonly #lifecycle: Readonly<OwnedRedisClientLifecycle>;
  readonly #retiringHandles = new Set<Readonly<RedisClientHandle>>();
  readonly #handleClosePromises = new WeakMap<object, Promise<void>>();
  #activeHandle: Readonly<RedisClientHandle> | null = null;
  #clientPromise: Promise<RedisClient> | null = null;
  #openingAbortController: AbortController | null = null;
  #closePromise: Promise<void> | null = null;
  #generation = 0;

  constructor(
    options: RedisClientOptions = {},
    lifecycle: OwnedRedisClientLifecycle = {},
  ) {
    this.#options = Object.freeze({ ...options });
    this.#lifecycle = Object.freeze({ ...lifecycle });
  }

  getClient(): Promise<RedisClient> {
    if (this.#activeHandle) return Promise.resolve(this.#activeHandle.client);
    if (this.#clientPromise) return this.#clientPromise;
    if (this.#closePromise) {
      return this.#closePromise.then(() => this.getClient());
    }

    const generation = this.#generation;
    const abortController = new AbortController();
    this.#openingAbortController = abortController;
    const pending = this.#openClient(generation, abortController.signal);
    this.#clientPromise = pending;
    void pending.then(
      () => {
        if (this.#clientPromise === pending) this.#clientPromise = null;
        if (this.#openingAbortController === abortController) {
          this.#openingAbortController = null;
        }
      },
      () => {
        if (this.#clientPromise === pending) this.#clientPromise = null;
        if (this.#openingAbortController === abortController) {
          this.#openingAbortController = null;
        }
      },
    );
    return pending;
  }

  async #openClient(generation: number, signal: AbortSignal): Promise<RedisClient> {
    await this.#drainRetiringHandles();
    if (generation !== this.#generation) throw connectionCancelledError();

    const provider = await ensureRedisRuntimeProvider();
    if (generation !== this.#generation) throw connectionCancelledError();
    const handle = await provider.openClient(this.#options, signal);
    if (generation !== this.#generation) {
      this.#retiringHandles.add(handle);
      await this.#closeHandle(handle);
      throw connectionCancelledError();
    }

    this.#activeHandle = handle;
    try {
      this.#attachLifecycleHandlers(handle);
    } catch (error) {
      if (this.#activeHandle === handle) this.#activeHandle = null;
      this.#retiringHandles.add(handle);
      try {
        await this.#closeHandle(handle);
      } catch (closeError) {
        throw new AggregateError(
          [error, closeError],
          "Redis client lifecycle setup and cleanup failed",
        );
      }
      throw error;
    }
    if (this.#activeHandle !== handle) throw connectionCancelledError();
    return handle.client;
  }

  #attachLifecycleHandlers(handle: Readonly<RedisClientHandle>): void {
    handle.client.on?.("error", (error: unknown) => {
      if (!this.#retireActiveHandle(handle)) return;
      this.#notify(() => this.#lifecycle.onError?.(error));
    });
    handle.client.on?.("end", () => {
      if (!this.#retireActiveHandle(handle)) return;
      this.#notify(() => this.#lifecycle.onEnd?.());
    });
  }

  #retireActiveHandle(handle: Readonly<RedisClientHandle>): boolean {
    if (this.#activeHandle !== handle) return false;
    this.#activeHandle = null;
    this.#generation++;
    this.#retiringHandles.add(handle);
    void this.#closeHandle(handle).catch((error) => {
      this.#notify(() => this.#lifecycle.onCloseError?.(error));
    });
    return true;
  }

  #notify(callback: () => void): void {
    try {
      callback();
    } catch {
      // Diagnostics must not interrupt connection retirement.
    }
  }

  #closeHandle(handle: Readonly<RedisClientHandle>): Promise<void> {
    const existing = this.#handleClosePromises.get(handle);
    if (existing) return existing;

    const pending = Promise.resolve()
      .then(() => handle.close())
      .then(() => {
        this.#retiringHandles.delete(handle);
      });
    const tracked = pending.finally(() => {
      if (this.#handleClosePromises.get(handle) === tracked) {
        this.#handleClosePromises.delete(handle);
      }
    });
    this.#handleClosePromises.set(handle, tracked);
    return tracked;
  }

  async #drainRetiringHandles(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.#retiringHandles].map((handle) => this.#closeHandle(handle)),
    );
    aggregateCloseFailures(
      results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason),
    );
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;

    this.#generation++;
    this.#openingAbortController?.abort(connectionCancelledError());
    const activeHandle = this.#activeHandle;
    this.#activeHandle = null;
    if (activeHandle) this.#retiringHandles.add(activeHandle);
    const opening = this.#clientPromise;
    this.#clientPromise = null;

    const closing = (async () => {
      if (opening) await Promise.allSettled([opening]);
      await this.#drainRetiringHandles();
    })();
    const tracked = closing.finally(() => {
      if (this.#closePromise === tracked) this.#closePromise = null;
    });
    this.#closePromise = tracked;
    return tracked;
  }
}
