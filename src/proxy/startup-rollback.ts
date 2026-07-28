import {
  type ProxyShutdownStep,
  type ProxyShutdownStepFailure,
  runProxyShutdownSteps,
  validateProxyShutdownPolicy,
} from "./shutdown.ts";
import { awaitAbortable, throwIfAborted } from "#veryfront/utils/abort.ts";

export interface ProxyStartupRollbackOptions {
  readonly cleanupTimeoutMs: number;
  readonly reportStartupFailure?: (startupError: unknown) => void;
  readonly reportCleanupFailure?: (
    failure: ProxyShutdownStepFailure,
    startupError: unknown,
  ) => void;
}

export interface ProxyStartupRollback {
  /**
   * Register one newly acquired resource.
   *
   * The returned idempotent function relinquishes this cleanup when ownership
   * moves into a later aggregate resource.
   */
  own(name: string, cleanup: () => void | Promise<void>): () => void;

  /** Run one startup stage, rolling back every owned resource if it fails. */
  run<T>(stage: () => T | PromiseLike<T>, abortSignal?: AbortSignal): Promise<T>;

  /**
   * Acquire and own a resource before cancellation can win its producer.
   *
   * Cleanup observes a late successful result even when the producer ignores
   * the abort signal. `release` relinquishes that cleanup after ownership has
   * moved into a later aggregate resource. During rollback, an aggregate
   * cleanup must succeed before it releases any direct owner it replaces.
   */
  acquire<T>(
    name: string,
    stage: () => T | PromiseLike<T>,
    cleanup: (resource: T) => void | Promise<void>,
    abortSignal?: AbortSignal,
  ): Promise<Readonly<{ value: T; release: () => void }>>;

  /**
   * Commit startup and disarm every rollback action.
   *
   * Returns `true` only for the transition that commits the transaction.
   */
  commit(): boolean;
}

interface OwnedStartupResource {
  readonly step: Readonly<ProxyShutdownStep>;
  owned: boolean;
}

function validateOptions(options: ProxyStartupRollbackOptions): void {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Proxy startup rollback options must be an object");
  }
  validateProxyShutdownPolicy([], options.cleanupTimeoutMs);
  if (
    options.reportStartupFailure !== undefined &&
    typeof options.reportStartupFailure !== "function"
  ) {
    throw new TypeError("Proxy startup failure reporter must be a function");
  }
  if (
    options.reportCleanupFailure !== undefined &&
    typeof options.reportCleanupFailure !== "function"
  ) {
    throw new TypeError("Proxy startup cleanup reporter must be a function");
  }
}

/**
 * Track resources acquired during startup and release them in reverse order
 * under the same bounded cleanup policy used by graceful shutdown.
 */
export function createProxyStartupRollback(
  options: ProxyStartupRollbackOptions,
): ProxyStartupRollback {
  validateOptions(options);
  const cleanupTimeoutMs = options.cleanupTimeoutMs;
  const reportStartupFailure = options.reportStartupFailure;
  const reportCleanupFailure = options.reportCleanupFailure;
  const resources: OwnedStartupResource[] = [];
  let rollbackPromise: Promise<never> | null = null;
  let state: "starting" | "rolling-back" | "committed" = "starting";
  const isCommitted = (): boolean => state === "committed";

  const rollback = (startupError: unknown): Promise<never> => {
    if (rollbackPromise) return rollbackPromise;
    if (state === "committed") return Promise.reject(startupError);
    state = "rolling-back";

    const attempt = Promise.resolve().then(async (): Promise<never> => {
      try {
        reportStartupFailure?.(startupError);
      } catch {
        // Diagnostics cannot replace the actionable startup failure.
      }

      // Keep ownership live while reverse cleanup runs. A later aggregate may
      // resolve during rollback and relinquish an earlier direct owner before
      // that earlier step starts.
      const steps = resources
        .slice()
        .reverse()
        .map((resource) =>
          Object.freeze({
            name: resource.step.name,
            run: () => resource.owned ? resource.step.run() : undefined,
          })
        );
      resources.length = 0;

      let failures: readonly ProxyShutdownStepFailure[];
      try {
        failures = await runProxyShutdownSteps(steps, cleanupTimeoutMs);
      } catch (error) {
        failures = [Object.freeze({
          step: "startup-rollback",
          status: "failed",
          error,
        })];
      }

      for (const failure of failures) {
        try {
          reportCleanupFailure?.(failure, startupError);
        } catch {
          // Diagnostics cannot replace the actionable startup failure.
        }
      }

      throw startupError;
    });
    rollbackPromise = attempt;
    return attempt;
  };

  const own = (name: string, cleanup: () => void | Promise<void>): () => void => {
    if (state !== "starting") {
      throw new Error("Proxy startup rollback is no longer accepting resources");
    }
    const step = Object.freeze({ name, run: cleanup });
    validateProxyShutdownPolicy([step], cleanupTimeoutMs);

    const resource: OwnedStartupResource = {
      step,
      owned: true,
    };
    resources.push(resource);
    return () => {
      resource.owned = false;
    };
  };

  const run = async <T>(
    stage: () => T | PromiseLike<T>,
    abortSignal?: AbortSignal,
  ): Promise<T> => {
    if (typeof stage !== "function") {
      throw new TypeError("Proxy startup stage must be a function");
    }
    if (state === "rolling-back") {
      return await rollbackPromise!;
    }
    if (state === "committed") {
      throw new Error("Proxy startup transaction is already committed");
    }
    try {
      throwIfAborted(abortSignal);
      const operation = Promise.resolve().then(() => {
        throwIfAborted(abortSignal);
        return stage();
      });
      return await awaitAbortable(operation, abortSignal);
    } catch (error) {
      if (isCommitted()) throw error;
      return await rollback(error);
    }
  };

  const acquire = async <T>(
    name: string,
    stage: () => T | PromiseLike<T>,
    cleanup: (resource: T) => void | Promise<void>,
    abortSignal?: AbortSignal,
  ): Promise<Readonly<{ value: T; release: () => void }>> => {
    if (typeof stage !== "function") {
      throw new TypeError("Proxy startup acquisition must be a function");
    }
    if (typeof cleanup !== "function") {
      throw new TypeError("Proxy startup acquisition cleanup must be a function");
    }

    return await run(async () => {
      type AcquisitionOutcome =
        | Readonly<{ status: "acquired"; value: T }>
        | Readonly<{ status: "failed"; error: unknown }>;
      const state: { settlement: Promise<AcquisitionOutcome> | null } = {
        settlement: null,
      };
      const release = own(name, async () => {
        const settlement = state.settlement;
        if (!settlement) {
          throw new Error("Proxy startup acquisition cleanup started before its producer");
        }
        const outcome = await settlement;
        if (outcome.status === "acquired") await cleanup(outcome.value);
      });
      state.settlement = Promise.resolve().then(() => stage()).then(
        (value) => Object.freeze({ status: "acquired" as const, value }),
        (error) => Object.freeze({ status: "failed" as const, error }),
      );

      const outcome = await state.settlement;
      if (outcome.status === "failed") throw outcome.error;
      return Object.freeze({ value: outcome.value, release });
    }, abortSignal);
  };

  const commit = (): boolean => {
    if (state !== "starting") return false;
    state = "committed";
    resources.length = 0;
    return true;
  };

  return Object.freeze({ own, run, acquire, commit });
}
