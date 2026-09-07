import { SERVICE_OVERLOADED } from "#veryfront/errors";
import {
  snapshotWorkerGenerationIdentity,
  type WorkerGenerationIdentity,
} from "#veryfront/security/sandbox/worker-generation.ts";
import type { RenderGeneration } from "./render-generation.ts";

export interface RenderGenerationPoolOptions {
  /** Counts constructing, running, and draining owners until cleanup succeeds. */
  maxGenerations: number;
  /** Counts requests across every generation, including pending startup. */
  maxConcurrentRenders: number;
}

export type RenderGenerationFactory = (
  identity: Readonly<WorkerGenerationIdentity>,
) => RenderGeneration;

interface Entry {
  readonly identity: Readonly<WorkerGenerationIdentity>;
  readonly ready: Promise<RenderGeneration>;
  retiring: boolean;
  closing?: Promise<void>;
}

function requireIdentity(identity: WorkerGenerationIdentity): Readonly<WorkerGenerationIdentity> {
  const snapshot = snapshotWorkerGenerationIdentity(identity.scopeId, identity.generationId);
  if (!snapshot) throw new TypeError("Render generation identity is required");
  return snapshot;
}

/**
 * Bound replica-local generation ownership and request admission together.
 *
 * Callers supply trusted scope/generation identities that include every input
 * affecting execution. This pool does not derive authority from requests or
 * artifact hashes, select deployment versions, or distribute local state.
 *
 * A factory returns its owner synchronously, before starting resource-producing
 * work. Lazy startup belongs to the owner's executor; stop() must also quiesce
 * pending startup. Per-generation artifact and executor limits remain required.
 *
 * Capacity exhaustion rejects without a queue or automatic eviction. Retirement
 * drains one local owner, not a logical release: after successful cleanup, an
 * explicitly admitted request may construct that same identity again.
 */
export class RenderGenerationPool {
  readonly #scopes = new Map<string, Map<string, Entry>>();
  readonly #maxGenerations: number;
  readonly #maxConcurrentRenders: number;
  #generationCount = 0;
  #requestCount = 0;
  #accepting = true;
  #closing?: Promise<void>;

  constructor(options: RenderGenerationPoolOptions) {
    const { maxGenerations, maxConcurrentRenders } = options;
    for (const value of [maxGenerations, maxConcurrentRenders]) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new RangeError("Render generation pool limits must be positive safe integers");
      }
    }
    this.#maxGenerations = maxGenerations;
    this.#maxConcurrentRenders = maxConcurrentRenders;
  }

  async render(
    request: Request,
    identity: WorkerGenerationIdentity,
    create: RenderGenerationFactory,
  ): Promise<Response> {
    request.signal.throwIfAborted();
    const snapshot = requireIdentity(identity);
    this.#assertOpen();
    if (this.#requestCount >= this.#maxConcurrentRenders) {
      throw SERVICE_OVERLOADED.create({
        detail: "Render generation pool request capacity is exhausted",
      });
    }
    this.#requestCount++;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      this.#requestCount--;
    };
    try {
      const entry = this.#getOrCreate(snapshot, create);
      const generation = await entry.ready;
      request.signal.throwIfAborted();
      this.#assertOpen();
      if (entry.retiring) {
        throw SERVICE_OVERLOADED.create({ detail: "Render generation is draining" });
      }
      return await generation.render(request, finish);
    } catch (error) {
      finish();
      throw error;
    }
  }

  /** Stop new admission to one owner immediately and retain it until cleanup succeeds. */
  retire(identity: WorkerGenerationIdentity): Promise<void> {
    const snapshot = requireIdentity(identity);
    const entry = this.#scopes.get(snapshot.scopeId)?.get(snapshot.generationId);
    return entry ? this.#closeEntry(entry) : Promise.resolve();
  }

  /** Terminal admission shutdown. Repeated calls retry failed owner cleanup. */
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#accepting = false;
    const entries = [...this.#scopes.values()].flatMap((scope) => [...scope.values()]);
    this.#closing = Promise.allSettled(entries.map((entry) => this.#closeEntry(entry)))
      .then((results) => {
        const errors = results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : []
        );
        if (errors.length) {
          throw new AggregateError(errors, "Render generation pool cleanup failed");
        }
      })
      .catch((error) => {
        this.#closing = undefined;
        throw error;
      });
    return this.#closing;
  }

  #assertOpen(): void {
    if (!this.#accepting) {
      throw SERVICE_OVERLOADED.create({ detail: "Render generation pool is closed" });
    }
  }

  #getOrCreate(
    identity: Readonly<WorkerGenerationIdentity>,
    create: RenderGenerationFactory,
  ): Entry {
    let scope = this.#scopes.get(identity.scopeId);
    const existing = scope?.get(identity.generationId);
    if (existing) return existing;
    if (this.#generationCount >= this.#maxGenerations) {
      throw SERVICE_OVERLOADED.create({ detail: "Render generation capacity is exhausted" });
    }
    const entry: Entry = {
      identity,
      retiring: false,
      ready: Promise.resolve().then(() => {
        this.#assertOpen();
        if (entry.retiring) {
          throw SERVICE_OVERLOADED.create({ detail: "Render generation is draining" });
        }
        return create(identity);
      }).catch((error) => {
        this.#remove(entry);
        throw error;
      }),
    };
    if (!scope) {
      scope = new Map();
      this.#scopes.set(identity.scopeId, scope);
    }
    scope.set(identity.generationId, entry);
    this.#generationCount++;
    return entry;
  }

  #closeEntry(entry: Entry): Promise<void> {
    entry.retiring = true;
    if (entry.closing) return entry.closing;
    entry.closing = entry.ready.then(
      (generation) => generation.close(),
      () => {}, // A failed constructor produced no resource owner.
    ).then(() => this.#remove(entry)).catch((error) => {
      entry.closing = undefined;
      throw error;
    });
    return entry.closing;
  }

  #remove(entry: Entry): void {
    const { scopeId, generationId } = entry.identity;
    const scope = this.#scopes.get(scopeId);
    if (scope?.get(generationId) !== entry) return;
    scope.delete(generationId);
    if (scope.size === 0) this.#scopes.delete(scopeId);
    this.#generationCount--;
  }
}
