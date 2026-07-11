export interface BrowserModuleBuildCoordinatorOptions {
  maxEntries?: number;
  maxBytes?: number;
  globalLimit?: number;
  perProjectLimit?: number;
}

export interface BrowserModuleBuildRequest<T> {
  cacheKey: string;
  projectKey: string;
  build: () => Promise<T>;
  validate: (value: T) => Promise<boolean>;
  sizeOf: (value: T) => number;
}

export interface BrowserModuleBuildResult<T> {
  value: T;
  status: "hit" | "miss" | "shared";
}

interface CacheEntry<T> {
  value: T;
  size: number;
}

const DEFAULT_MAX_ENTRIES = 64;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_GLOBAL_LIMIT = 8;
const DEFAULT_PER_PROJECT_LIMIT = 2;

export class BrowserModuleCapacityError extends Error {
  override readonly name = "BrowserModuleCapacityError";

  constructor() {
    super("Browser module build capacity is exhausted");
  }
}

/**
 * Coordinates expensive browser-module builds without an unbounded wait queue.
 * Map insertion order provides deterministic least-recently-used eviction.
 */
export class BrowserModuleBuildCoordinator<T> {
  readonly #maxEntries: number;
  readonly #maxBytes: number;
  readonly #globalLimit: number;
  readonly #perProjectLimit: number;
  readonly #cache = new Map<string, CacheEntry<T>>();
  readonly #inFlight = new Map<string, Promise<BrowserModuleBuildResult<T>>>();
  readonly #activeByProject = new Map<string, number>();
  #cacheBytes = 0;
  #activeGlobal = 0;
  #generation = 0;

  constructor(options: BrowserModuleBuildCoordinatorOptions = {}) {
    this.#maxEntries = positiveInteger(options.maxEntries, DEFAULT_MAX_ENTRIES);
    this.#maxBytes = positiveInteger(options.maxBytes, DEFAULT_MAX_BYTES);
    this.#globalLimit = positiveInteger(options.globalLimit, DEFAULT_GLOBAL_LIMIT);
    this.#perProjectLimit = positiveInteger(
      options.perProjectLimit,
      DEFAULT_PER_PROJECT_LIMIT,
    );
  }

  async getOrBuild(
    request: BrowserModuleBuildRequest<T>,
  ): Promise<BrowserModuleBuildResult<T>> {
    const existingOperation = this.#inFlight.get(request.cacheKey);
    if (existingOperation) {
      return { value: (await existingOperation).value, status: "shared" };
    }

    const projectActive = this.#activeByProject.get(request.projectKey) ?? 0;
    if (
      this.#activeGlobal >= this.#globalLimit ||
      projectActive >= this.#perProjectLimit
    ) {
      throw new BrowserModuleCapacityError();
    }

    this.#activeGlobal++;
    this.#activeByProject.set(request.projectKey, projectActive + 1);
    const generation = this.#generation;
    const operation = this.#validateOrBuild(request, generation);
    this.#inFlight.set(request.cacheKey, operation);

    try {
      return await operation;
    } finally {
      if (Object.is(this.#inFlight.get(request.cacheKey), operation)) {
        this.#inFlight.delete(request.cacheKey);
      }
      if (generation === this.#generation) {
        this.#activeGlobal = Math.max(0, this.#activeGlobal - 1);
        const remaining = (this.#activeByProject.get(request.projectKey) ?? 1) - 1;
        if (remaining > 0) this.#activeByProject.set(request.projectKey, remaining);
        else this.#activeByProject.delete(request.projectKey);
      }
    }
  }

  async #validateOrBuild(
    request: BrowserModuleBuildRequest<T>,
    generation: number,
  ): Promise<BrowserModuleBuildResult<T>> {
    while (generation === this.#generation) {
      const cached = this.#cache.get(request.cacheKey);
      if (!cached) break;

      let valid = false;
      try {
        valid = await request.validate(cached.value);
      } catch {
        valid = false;
      }

      if (generation !== this.#generation) {
        return this.getOrBuild(request);
      }
      if (this.#cache.get(request.cacheKey) !== cached) {
        continue;
      }

      if (valid) {
        this.#cache.delete(request.cacheKey);
        this.#cache.set(request.cacheKey, cached);
        return { value: cached.value, status: "hit" };
      }
      this.#removeCached(request.cacheKey);
      break;
    }

    if (generation !== this.#generation) {
      return this.getOrBuild(request);
    }

    const value = await request.build();
    if (generation === this.#generation) {
      this.#store(request.cacheKey, value, request.sizeOf(value));
    }
    return { value, status: "miss" };
  }

  resetForTesting(): void {
    this.#generation++;
    this.#cache.clear();
    this.#inFlight.clear();
    this.#activeByProject.clear();
    this.#cacheBytes = 0;
    this.#activeGlobal = 0;
  }

  getStatsForTesting(): {
    cacheEntries: number;
    cacheBytes: number;
    inFlight: number;
    activeGlobal: number;
  } {
    return {
      cacheEntries: this.#cache.size,
      cacheBytes: this.#cacheBytes,
      inFlight: this.#inFlight.size,
      activeGlobal: this.#activeGlobal,
    };
  }

  #store(cacheKey: string, value: T, rawSize: number): void {
    const size = Number.isFinite(rawSize) ? Math.max(0, Math.ceil(rawSize)) : Infinity;
    this.#removeCached(cacheKey);
    if (size > this.#maxBytes) return;

    this.#cache.set(cacheKey, { value, size });
    this.#cacheBytes += size;
    while (
      this.#cache.size > this.#maxEntries ||
      this.#cacheBytes > this.#maxBytes
    ) {
      const oldestKey = this.#cache.keys().next().value;
      if (oldestKey === undefined) break;
      this.#removeCached(oldestKey);
    }
  }

  #removeCached(cacheKey: string): void {
    const existing = this.#cache.get(cacheKey);
    if (!existing) return;
    this.#cache.delete(cacheKey);
    this.#cacheBytes = Math.max(0, this.#cacheBytes - existing.size);
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value! : fallback;
}
