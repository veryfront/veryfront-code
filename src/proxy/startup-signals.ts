import type { ProxyStartupRollback } from "./startup-rollback.ts";

export type ProxySignal = "SIGINT" | "SIGTERM";

export interface ProxySignalHandlers {
  /** Remove every installed handler. Safe to call more than once. */
  readonly dispose: () => void;
}

export class ProxyStartupSignalError extends Error {
  override readonly name = "ProxyStartupSignalError";

  constructor(readonly signal: ProxySignal) {
    super(`Proxy startup interrupted by ${signal}`);
  }
}

export interface ProxyStartupSignalRouter {
  /** Abort boundary observed by every cancellable pre-commit startup stage. */
  readonly startupSignal: AbortSignal;
  /** Route a process signal according to the current startup/runtime phase. */
  readonly handle: (signal: ProxySignal) => void;
  /** Atomically commit the startup transaction and switch to runtime routing. */
  readonly commit: (commitStartup: () => boolean) => boolean;
}

/**
 * Keep process signals fail-closed while startup is still transactional, then
 * route them to the runtime shutdown coordinator after the transaction commits.
 */
export function createProxyStartupSignalRouter(
  handleRuntimeSignal: (signal: ProxySignal) => void,
): Readonly<ProxyStartupSignalRouter> {
  if (typeof handleRuntimeSignal !== "function") {
    throw new TypeError("Proxy runtime signal handler must be a function");
  }

  const startupController = new AbortController();
  let phase: "starting" | "runtime" = "starting";

  return Object.freeze({
    startupSignal: startupController.signal,
    handle(signal: ProxySignal): void {
      if (signal !== "SIGINT" && signal !== "SIGTERM") {
        throw new TypeError("Proxy signal must be SIGINT or SIGTERM");
      }
      if (phase === "runtime") {
        handleRuntimeSignal(signal);
        return;
      }
      if (!startupController.signal.aborted) {
        startupController.abort(new ProxyStartupSignalError(signal));
      }
    },
    commit(commitStartup: () => boolean): boolean {
      if (typeof commitStartup !== "function") {
        throw new TypeError("Proxy startup commit must be a function");
      }
      if (phase !== "starting" || startupController.signal.aborted) return false;
      if (commitStartup() !== true) return false;
      phase = "runtime";
      return true;
    },
  });
}

export interface AcquireProxySignalHandlersOptions {
  readonly startupRollback: Pick<ProxyStartupRollback, "own">;
  readonly registerSignal: (
    signal: ProxySignal,
    handler: () => void,
  ) => () => void;
  readonly handleSignal: (signal: ProxySignal) => void;
}

interface OwnedSignalRegistration {
  readonly dispose: () => void;
  disposed: boolean;
}

function throwDisposalFailures(failures: unknown[]): void {
  if (failures.length === 0) return;
  if (failures.length === 1) throw failures[0];
  throw new AggregateError(failures, "Failed to remove proxy signal handlers");
}

/**
 * Install both proxy shutdown signals as one startup-owned resource.
 *
 * The aggregate cleanup is armed before the first registration so a failure
 * while installing either signal can unwind every earlier acquisition.
 */
export function acquireProxySignalHandlers(
  options: AcquireProxySignalHandlersOptions,
): Readonly<ProxySignalHandlers> {
  const registrations: OwnedSignalRegistration[] = [];
  const dispose = (): void => {
    const failures: unknown[] = [];
    for (let index = registrations.length - 1; index >= 0; index--) {
      const registration = registrations[index]!;
      if (registration.disposed) continue;
      try {
        registration.dispose();
        registration.disposed = true;
      } catch (error) {
        failures.push(error);
      }
    }
    throwDisposalFailures(failures);
  };

  options.startupRollback.own("signal-handlers", dispose);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    registrations.push({
      dispose: options.registerSignal(
        signal,
        () => options.handleSignal(signal),
      ),
      disposed: false,
    });
  }

  return Object.freeze({ dispose });
}
