/**
 * Protected worker lifecycle functions.
 *
 * The host notification is best effort, but it must never prevent the native
 * worker close/exit operation from running.
 *
 * @module security/sandbox/worker-exit-controls
 */

export interface WorkerExitControlsOptions {
  notifyExit: () => void;
  closeWorker: () => void;
  exitWorker?: (code?: number) => never;
}

export interface WorkerExitControls {
  close: () => void;
  exit?: (code?: number) => never;
}

/** Build close/exit wrappers that preserve native worker termination. */
export function createWorkerExitControls(
  options: WorkerExitControlsOptions,
): WorkerExitControls {
  const exitWorker = options.exitWorker;
  const close = () => {
    try {
      options.notifyExit();
    } finally {
      options.closeWorker();
    }
  };

  const exit = exitWorker === undefined ? undefined : (code?: number): never => {
    try {
      options.notifyExit();
    } catch {
      // Preserve the native, uncatchable exit if notification fails.
    }
    return exitWorker(code);
  };

  return { close, exit };
}
