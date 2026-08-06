/**
 * Keep one tenant's dropped promise from terminating a shared server.
 *
 * The production server runs many projects in one process. An unhandled
 * rejection anywhere in it is fatal to all of them, and a project only needs an
 * unresolvable stylesheet import to produce one:
 *
 *   error: Uncaught (in promise) VeryfrontError:
 *     ext-css-tailwind cannot resolve stylesheet import "tw-animate-css"
 *
 * That killed `veryfront-server` pods repeatedly, exit code 1, well inside their
 * memory limit, because one project's CSS import could not resolve. Every other
 * project on the pod lost its process with it.
 *
 * The guard reports the rejection at error level with its stack and keeps the
 * process alive. It does not hide the defect: an error log plus a rejection
 * count is a louder signal than a restarted pod, and losing the process is
 * strictly worse than losing the one request that dropped the promise. Report
 * these to an error tracker and alert on the count rather than treating a
 * quiet process as healthy.
 *
 * This is containment, not a fix. Each rejection it reports is a promise some
 * caller should have awaited or caught, and the log is the evidence needed to
 * find it.
 *
 * @module server/unhandled-rejection-guard
 */

import { serverLogger } from "#veryfront/utils";

/** Minimal view of the rejection event both Deno and browsers dispatch. */
interface UnhandledRejectionEventLike {
  readonly reason?: unknown;
  preventDefault?: () => void;
}

interface GuardEventTarget {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

interface GuardLogger {
  error(message: string, context?: Record<string, unknown>): void;
}

export interface UnhandledRejectionGuardOptions {
  /** Defaults to the global process event target. */
  target?: GuardEventTarget;
  /** Defaults to the server logger. */
  logger?: GuardLogger;
}

export interface UnhandledRejectionGuardHandle {
  /**
   * False when another guard already owns this target. A process needs one
   * reporter, so a second server instance must not double-report.
   */
  readonly installed: boolean;
  /** Rejections contained so far. Export as a metric and alert on its rate. */
  getRejectionCount(): number;
  /** Remove the listener. Safe to call more than once. */
  dispose(): void;
}

const EVENT_TYPE = "unhandledrejection";

/** One owner per target, so two server instances cannot both report. */
const guardedTargets = new WeakSet<GuardEventTarget>();

function describeReason(reason: unknown): { error: string; stack?: string } {
  if (reason instanceof Error) {
    return {
      error: reason.message,
      ...(reason.stack === undefined ? {} : { stack: reason.stack }),
    };
  }
  return { error: String(reason) };
}

function resolveDefaultTarget(): GuardEventTarget | undefined {
  const candidate = globalThis as unknown as Partial<GuardEventTarget>;
  return typeof candidate.addEventListener === "function" &&
      typeof candidate.removeEventListener === "function"
    ? candidate as GuardEventTarget
    : undefined;
}

const disposedHandle: UnhandledRejectionGuardHandle = Object.freeze({
  installed: false,
  getRejectionCount: () => 0,
  dispose: () => {},
});

/**
 * Install the process-wide guard.
 *
 * Returns a handle whose `installed` is false when the target already has an
 * owner or cannot receive listeners.
 */
export function installUnhandledRejectionGuard(
  options: UnhandledRejectionGuardOptions = {},
): UnhandledRejectionGuardHandle {
  const target = options.target ?? resolveDefaultTarget();
  if (!target || guardedTargets.has(target)) return disposedHandle;

  const logger = options.logger ?? guardLog;
  let rejectionCount = 0;
  let disposed = false;

  const listener = (event: unknown): void => {
    const rejection = event as UnhandledRejectionEventLike;
    rejectionCount++;
    logger.error("Contained an unhandled promise rejection", {
      ...describeReason(rejection?.reason),
      rejectionCount,
    });
    // Deno terminates the process unless the default is prevented.
    rejection?.preventDefault?.();
  };

  target.addEventListener(EVENT_TYPE, listener);
  guardedTargets.add(target);

  return {
    installed: true,
    getRejectionCount: () => rejectionCount,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      target.removeEventListener(EVENT_TYPE, listener);
      guardedTargets.delete(target);
    },
  };
}

const guardLog: GuardLogger = serverLogger.component("unhandled-rejection");
