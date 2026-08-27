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

import { runtimeProcess } from "#veryfront/platform/compat/process/runtime-process.ts";
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

interface GuardProcessTarget {
  on(type: "unhandledRejection", listener: (reason: unknown) => void): void;
  off(type: "unhandledRejection", listener: (reason: unknown) => void): void;
}

type GuardTarget = GuardEventTarget | GuardProcessTarget;

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
   * True while this handle holds a lease on an active guard. False only when the
   * target cannot receive listeners at all.
   */
  readonly installed: boolean;
  /**
   * Rejections contained on this target so far, across every holder. This is a
   * process-level metric: export it and alert on its rate.
   */
  getRejectionCount(): number;
  /**
   * Release this handle's lease. The listener is removed once the last holder
   * releases it. Safe to call more than once.
   */
  dispose(): void;
}

const EVENT_TARGET_TYPE = "unhandledrejection";
const PROCESS_EVENT_TYPE = "unhandledRejection";

/**
 * One listener per target, shared by every holder.
 *
 * Leases rather than a single owner: with two servers in one process, ownership
 * by whoever installed it meant the first server to stop removed the only
 * listener and left the survivor unguarded.
 */
interface GuardLease {
  listener: (event: unknown) => void;
  holders: number;
  rejectionCount: number;
}

const guardedTargets = new WeakMap<GuardTarget, GuardLease>();

function describeReason(reason: unknown): { error: string; stack?: string } {
  if (reason instanceof Error) {
    return {
      error: reason.message,
      ...(reason.stack === undefined ? {} : { stack: reason.stack }),
    };
  }
  return { error: String(reason) };
}

function isEventTarget(target: GuardTarget): target is GuardEventTarget {
  const candidate = target as Partial<GuardEventTarget>;
  return typeof candidate.addEventListener === "function" &&
    typeof candidate.removeEventListener === "function";
}

function resolveDefaultTarget(): GuardTarget | undefined {
  const globalTarget = globalThis as Partial<GuardEventTarget>;
  if (
    typeof globalTarget.addEventListener === "function" &&
    typeof globalTarget.removeEventListener === "function"
  ) {
    return globalTarget as GuardEventTarget;
  }

  // Node and Bun expose the fatal rejection hook through process events, not
  // global EventTarget methods.
  if (runtimeProcess) return runtimeProcess;
}

function subscribe(target: GuardTarget, listener: (event: unknown) => void): void {
  if (isEventTarget(target)) {
    target.addEventListener(EVENT_TARGET_TYPE, listener);
    return;
  }
  target.on(PROCESS_EVENT_TYPE, listener);
}

function unsubscribe(target: GuardTarget, listener: (event: unknown) => void): void {
  if (isEventTarget(target)) {
    target.removeEventListener(EVENT_TARGET_TYPE, listener);
    return;
  }
  target.off(PROCESS_EVENT_TYPE, listener);
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
  const target: GuardTarget | undefined = options.target ?? resolveDefaultTarget();
  if (!target) return disposedHandle;

  const logger = options.logger ?? guardLog;
  let lease = guardedTargets.get(target);

  if (lease) {
    lease.holders++;
  } else {
    const created: GuardLease = {
      holders: 1,
      rejectionCount: 0,
      listener: (event: unknown): void => {
        const rejection = isEventTarget(target) ? event as UnhandledRejectionEventLike : undefined;
        // Suppress first. Deno terminates the process unless the default is
        // prevented, and a reason with a throwing toString, or a logger that
        // fails, must not be able to cost the process its containment.
        try {
          rejection?.preventDefault?.();
        } catch {
          // A target that cannot suppress leaves nothing to salvage; still
          // report below so the rejection is not silent.
        }
        created.rejectionCount++;
        try {
          logger.error("Contained an unhandled promise rejection", {
            ...describeReason(rejection ? rejection.reason : event),
            rejectionCount: created.rejectionCount,
          });
        } catch {
          // Diagnostics are best effort. The rejection is already contained and
          // counted, and throwing here would resurface as another rejection.
        }
      },
    };
    subscribe(target, created.listener);
    guardedTargets.set(target, created);
    lease = created;
  }

  const held = lease;
  let released = false;

  return {
    installed: true,
    getRejectionCount: () => held.rejectionCount,
    dispose: () => {
      if (released) return;
      released = true;
      held.holders--;
      if (held.holders > 0) return;
      unsubscribe(target, held.listener);
      if (guardedTargets.get(target) === held) guardedTargets.delete(target);
    },
  };
}

const guardLog: GuardLogger = serverLogger.component("unhandled-rejection");
