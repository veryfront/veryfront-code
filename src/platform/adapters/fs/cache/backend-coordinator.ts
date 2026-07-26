import type { CacheBackend } from "#veryfront/cache/backend.ts";

export interface FileCacheBackendCoordinatorOptions {
  createBackend: () => Promise<CacheBackend>;
  now?: () => number;
  retryMilliseconds: number;
}

/**
 * Owns the process-wide distributed file-cache backend lifecycle.
 *
 * The coordinator deliberately retains only distributed backends. A memory
 * backend returned by the factory is a per-attempt degradation signal, so a
 * later call may retry after the cooldown instead of permanently pinning the
 * process to fallback mode.
 */
export class FileCacheBackendCoordinator {
  readonly #createBackend: () => Promise<CacheBackend>;
  readonly #now: () => number;
  readonly #retryMilliseconds: number;
  #backend: CacheBackend | null = null;
  #initialization: Promise<boolean> | null = null;
  #lastFailureTime: number | undefined;
  #lastFailureError: unknown;

  constructor(options: FileCacheBackendCoordinatorOptions) {
    if (
      !Number.isFinite(options.retryMilliseconds) ||
      options.retryMilliseconds < 0
    ) {
      throw new RangeError("retryMilliseconds must be a finite non-negative number");
    }
    this.#createBackend = options.createBackend;
    this.#now = options.now ?? Date.now;
    this.#retryMilliseconds = options.retryMilliseconds;
  }

  get backend(): CacheBackend | null {
    return this.#backend;
  }

  get lastFailureError(): unknown {
    return this.#lastFailureError;
  }

  isDistributedEnabled(): boolean {
    return this.#backend !== null;
  }

  initialize(): Promise<boolean> {
    if (this.#backend) return Promise.resolve(true);

    if (this.#lastFailureTime !== undefined) {
      const elapsed = this.#now() - this.#lastFailureTime;
      if (elapsed >= 0 && elapsed < this.#retryMilliseconds) {
        return Promise.resolve(false);
      }
    }

    if (this.#initialization) return this.#initialization;

    const initialization = this.#initializeOnce();
    this.#initialization = initialization;
    const clearInitialization = (): void => {
      if (this.#initialization === initialization) this.#initialization = null;
    };
    void initialization.then(clearInitialization, clearInitialization);
    return initialization;
  }

  async #initializeOnce(): Promise<boolean> {
    try {
      const candidate: unknown = await this.#createBackend();
      if (
        !candidate ||
        typeof candidate !== "object" ||
        typeof Reflect.get(candidate, "type") !== "string" ||
        typeof Reflect.get(candidate, "get") !== "function" ||
        typeof Reflect.get(candidate, "set") !== "function" ||
        typeof Reflect.get(candidate, "del") !== "function"
      ) {
        throw new TypeError("File cache backend factory returned an invalid backend");
      }

      const backend = candidate as CacheBackend;
      if (backend.type === "memory") {
        this.#recordFailure(undefined);
        return false;
      }

      this.#backend = backend;
      this.#lastFailureTime = undefined;
      this.#lastFailureError = undefined;
      return true;
    } catch (error) {
      this.#recordFailure(error);
      return false;
    }
  }

  #recordFailure(error: unknown): void {
    this.#backend = null;
    this.#lastFailureTime = this.#now();
    this.#lastFailureError = error;
  }
}
