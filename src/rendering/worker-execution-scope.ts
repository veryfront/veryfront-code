import { evictWorkerScopeIfPresent } from "#veryfront/security/sandbox/worker-pool.ts";

const MAX_WORKER_EXECUTION_SCOPE_ID_LENGTH = 1024;

interface WorkerExecutionScopeGeneration {
  readonly id: string;
  activeLeases: number;
  retired: boolean;
  evictionRequested: boolean;
}

export interface WorkerExecutionScopeLease {
  readonly scopeId: string;
  release(): void;
}

export interface WorkerExecutionScopeOwnerOptions {
  initialScopeId?: string;
  createScopeId?: () => string;
  evictScope?: (scopeId: string) => void;
}

function validateWorkerExecutionScopeId(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_WORKER_EXECUTION_SCOPE_ID_LENGTH ||
    value.trim() !== value
  ) {
    throw new TypeError(
      "Worker execution scope ID must be a non-empty trimmed string of at most 1024 characters",
    );
  }
  return value;
}

export function createWorkerExecutionScopeId(): string {
  return `data-${crypto.randomUUID()}`;
}

/**
 * Owns generations of a reusable data-worker scope.
 *
 * Rotation publishes the replacement before retiring the previous generation.
 * Existing leases can therefore finish on their immutable scope while new
 * leases immediately use the replacement. A retired scope is evicted only
 * after its final lease ends, preventing both stale reuse and worker leaks.
 */
export class WorkerExecutionScopeOwner {
  readonly #createScopeId: () => string;
  readonly #evictScope: (scopeId: string) => void;
  #current: WorkerExecutionScopeGeneration;
  #closed = false;

  constructor(options: WorkerExecutionScopeOwnerOptions = {}) {
    this.#createScopeId = options.createScopeId ?? createWorkerExecutionScopeId;
    this.#evictScope = options.evictScope ?? evictWorkerScopeIfPresent;
    this.#current = this.#createGeneration(
      options.initialScopeId ?? this.#createScopeId(),
    );
  }

  get currentScopeId(): string {
    return this.#current.id;
  }

  acquire(): WorkerExecutionScopeLease {
    if (this.#closed) {
      throw new Error("Worker execution scope owner has been closed");
    }

    const generation = this.#current;
    generation.activeLeases++;
    let released = false;

    return Object.freeze({
      scopeId: generation.id,
      release: () => {
        if (released) return;
        released = true;
        generation.activeLeases--;
        this.#evictRetiredGenerationIfIdle(generation);
      },
    });
  }

  rotate(nextScopeId?: string): string {
    if (this.#closed) {
      throw new Error("Worker execution scope owner has been closed");
    }

    const replacement = this.#createGeneration(
      nextScopeId ?? this.#createScopeId(),
    );
    if (replacement.id === this.#current.id) {
      throw new TypeError(
        "Worker execution scope rotation requires a different scope ID",
      );
    }

    const previous = this.#current;
    this.#current = replacement;
    this.#retire(previous);
    return replacement.id;
  }

  /**
   * Prevent future leases. Owners retire their current generation; borrowers
   * leave it to the enclosing owner while still draining any earlier rotation.
   */
  close(retireCurrent: boolean): void {
    if (this.#closed) return;
    this.#closed = true;
    if (retireCurrent) this.#retire(this.#current);
  }

  #createGeneration(scopeId: string): WorkerExecutionScopeGeneration {
    return {
      id: validateWorkerExecutionScopeId(scopeId),
      activeLeases: 0,
      retired: false,
      evictionRequested: false,
    };
  }

  #retire(generation: WorkerExecutionScopeGeneration): void {
    if (generation.retired) return;
    generation.retired = true;
    this.#evictRetiredGenerationIfIdle(generation);
  }

  #evictRetiredGenerationIfIdle(
    generation: WorkerExecutionScopeGeneration,
  ): void {
    if (
      !generation.retired ||
      generation.activeLeases !== 0 ||
      generation.evictionRequested
    ) {
      return;
    }
    generation.evictionRequested = true;
    this.#evictScope(generation.id);
  }
}
