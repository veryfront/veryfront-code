/**
 * Test isolation utilities for cross-runtime execution.
 *
 * Provides default cleanup hooks to reduce cross-test leakage,
 * especially in Bun where module caching and shared globals
 * can cause flakiness.
 *
 * @module
 */

import { runProcessStateResets } from "#veryfront/platform/compat/process/state-reset.ts";
import { AsyncLocalStorage } from "#veryfront/platform/compat/async-local-storage.ts";

/** Cleanup callback run by the shared test-state reset. */
export type CleanupTask = () => void | Promise<void>;
type LabeledCleanupTask = {
  label: string;
  task: CleanupTask;
};

type CleanupFailure = {
  label: string;
  error: unknown;
};

const cleanupTasks: CleanupTask[] = [];
const resetContext = new AsyncLocalStorage<boolean>();
let resetQueue = Promise.resolve();

/** Registers test cleanup. */
export function registerTestCleanup(task: CleanupTask): void {
  if (typeof task !== "function") throw new TypeError("Test cleanup must be a function");
  cleanupTasks.push(task);
}

async function runCleanups(
  cleanups: Iterable<LabeledCleanupTask>,
): Promise<CleanupFailure[]> {
  const failures: CleanupFailure[] = [];
  for (const { label, task } of cleanups) {
    try {
      await task();
    } catch (error) {
      failures.push({ label, error });
    }
  }
  return failures;
}

async function runRegisteredCleanups(): Promise<CleanupFailure[]> {
  const tasks = cleanupTasks.splice(0, cleanupTasks.length);

  return await runCleanups(
    tasks.map((task) => ({
      label: "registered cleanup",
      task,
    })),
  );
}

/**
 * Reset known shared test state across the application.
 *
 * This function clears all known caches and singletons that can cause
 * test isolation issues when running tests in parallel. It should be
 * called at the start and end of each test to ensure clean state.
 *
 * Loaded state owners register their own reset handlers through the platform
 * process-state registry. This keeps ownership with each module and prevents
 * the test layer from importing the application graph solely for cleanup.
 */
async function performResetAllTestState(): Promise<void> {
  const failures = await runRegisteredCleanups();
  failures.push(...await runProcessStateResets());

  if (failures.length > 0) {
    const labels = [...new Set(failures.map(({ label }) => label))].join(", ");
    throw new AggregateError(
      failures.map(({ error }) => error),
      `Test state reset failed in ${failures.length} cleanup step(s): ${labels}`,
    );
  }
}

/** Serialize and run registered and framework-owned test-state cleanup. */
export function resetAllTestState(): Promise<void> {
  if (resetContext.getStore()) {
    return Promise.reject(new Error("Test state reset cannot run recursively from a cleanup"));
  }

  const reset = resetQueue.then(() => resetContext.run(true, () => performResetAllTestState()));
  resetQueue = reset.catch(() => undefined);
  return reset;
}
