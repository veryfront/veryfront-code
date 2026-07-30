import type { CacheBackend } from "#veryfront/cache/backend.ts";

export interface FileCacheBackendCoordinatorOptions {
  createBackend: () => Promise<CacheBackend>;
}

/**
 * Owns the process-wide distributed file-cache backend lifecycle.
 *
 * The coordinator deliberately retains only shared backends. A memory backend
 * is a valid local-only selection and is not retained as a distributed backend.
 * Construction failures propagate to the caller and a later explicit call may
 * retry; there is no hidden cooldown or fail-open state transition.
 */
export class FileCacheBackendCoordinator {
  readonly #createBackend: () => Promise<CacheBackend>;
  #backend: CacheBackend | null = null;
  #initialization: Promise<boolean> | null = null;
  #lastFailureError: unknown;

  constructor(options: FileCacheBackendCoordinatorOptions) {
    this.#createBackend = options.createBackend;
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
        this.#backend = null;
        this.#lastFailureError = undefined;
        return false;
      }

      this.#backend = backend;
      this.#lastFailureError = undefined;
      return true;
    } catch (error) {
      this.#recordFailure(error);
      throw error;
    }
  }

  #recordFailure(error: unknown): void {
    this.#backend = null;
    this.#lastFailureError = error;
  }
}
