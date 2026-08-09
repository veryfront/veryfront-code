/**
 * Serialized access to the process working directory in tests.
 *
 * `Deno.chdir` mutates state shared by every test in the process, and the CLI
 * suite has several files that need it -- each one resolving a relative path
 * the way the command under test would. Run two of them at once and the second
 * `chdir` lands while the first is still awaiting, so the first resolves its
 * path against the wrong directory. That is a race by construction: it depends
 * on which files a shard happens to group, so it fails rarely, somewhere
 * unrelated to whatever change is being tested.
 *
 * Every caller queues here instead, so at most one has the working directory at
 * a time and each is restored before the next begins.
 *
 * ## Why the lock is on disk
 *
 * Under `deno test --parallel` each test *file* runs in its own isolate, and
 * those isolates share neither module state nor `globalThis` -- but they do
 * share one OS process, and therefore one working directory. A module-level
 * queue is consequently per-file: it orders the callers inside a file and does
 * nothing about the file next door, which is the race that actually bites. The
 * only mutex those isolates can both see is one the operating system holds, so
 * the cross-file turn is taken by creating a directory (`Deno.mkdir` fails with
 * `AlreadyExists` atomically) and released by removing it.
 *
 * The lock is keyed on `Deno.pid` because the thing it protects is per-process:
 * two concurrent `deno test` runs have independent working directories and have
 * no reason to wait for each other. That also means a lock can never be left
 * behind by an earlier run for this one to trip over.
 *
 * The in-isolate queue is kept in front of the disk lock so that callers within
 * a file still take their turn in arrival order; polling alone would decide
 * that arbitrarily.
 *
 * @module testing/cwd
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NESTED_CWD_SCOPE, TIMEOUT_ERROR } from "#veryfront/errors";

/**
 * Where callers are returned to when they are done.
 *
 * Deliberately derived from this module's URL rather than read from
 * `Deno.cwd()`: the whole premise here is that a sibling file may own the
 * working directory at any moment, so the value `Deno.cwd()` reports is not
 * reliably ours to restore. It can be a foreign temp directory, and if that
 * directory has since been removed the call throws `NotFound` outright.
 */
const ANCHOR = new URL("../../", import.meta.url);

/** Cross-isolate turn-holder. Present on disk exactly while someone holds it. */
const LOCK_PATH = join(tmpdir(), `veryfront-test-cwd-${Deno.pid}.lock`);

/** How long to wait between attempts at the lock. */
const POLL_MS = 5;

/**
 * How long to wait for the lock before giving up.
 *
 * Generous, because a callback may bundle or transpile before it yields. It
 * exists only so a lost release fails loudly instead of hanging the suite.
 */
const ACQUIRE_TIMEOUT_MS = 120_000;

/** Tail of the queue. Each caller awaits the previous one before it chdirs. */
let queue: Promise<void> = Promise.resolve();

/**
 * Marks the execution context of a running callback.
 *
 * A global "someone holds it" flag cannot tell a nested call from an
 * independent one that simply arrived while a callback was awaiting -- and
 * rejecting the latter is worse than the deadlock it was meant to prevent,
 * because queueing is exactly what an independent caller should do. Async
 * context distinguishes them: only code running inside a callback sees the
 * store.
 */
const insideCallback = new AsyncLocalStorage<true>();

/** Take the cross-isolate turn, waiting for whoever holds it to finish. */
async function acquireLock(): Promise<void> {
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
  for (;;) {
    try {
      await Deno.mkdir(LOCK_PATH);
      return;
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
      if (Date.now() >= deadline) {
        throw TIMEOUT_ERROR.create({
          detail:
            `Timed out waiting ${ACQUIRE_TIMEOUT_MS}ms for the test working-directory lock. ` +
            `If no test run is active, remove ${LOCK_PATH} and retry.`,
          context: { lockPath: LOCK_PATH, timeoutMs: ACQUIRE_TIMEOUT_MS },
        });
      }
      // Jittered so that isolates released together do not collide again.
      await new Promise((resolve) => setTimeout(resolve, POLL_MS + Math.random() * POLL_MS));
    }
  }
}

/** Hand the cross-isolate turn to whoever is polling for it next. */
async function releaseLock(): Promise<void> {
  try {
    await Deno.remove(LOCK_PATH);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

/**
 * Run `fn` with the process working directory set to `dir`.
 *
 * Waits for any other caller to finish first -- in this file and in every other
 * test file sharing the process -- and returns to the repository root
 * afterwards even if `fn` throws.
 *
 * @param dir directory to enter
 * @param fn work to run inside it
 * @returns whatever `fn` returns
 */
export function withCwd<T>(dir: string, fn: () => Promise<T> | T): Promise<T> {
  // Fail fast rather than enqueue: a nested call would wait for the queue,
  // which waits for the outer call, which waits for this one. Reentrancy is
  // not the answer either -- the inner chdir would move the directory out from
  // under the outer caller, which is the exact hazard this exists to prevent.
  if (insideCallback.getStore()) {
    return Promise.reject(
      NESTED_CWD_SCOPE.create({
        detail:
          "withCwd cannot be nested: the inner call would move the directory the outer call is using.",
        context: { dir },
      }),
    );
  }

  const run = queue.then(async () => {
    await acquireLock();
    try {
      Deno.chdir(dir);
      return await insideCallback.run(true, fn);
    } finally {
      try {
        Deno.chdir(ANCHOR);
      } finally {
        await releaseLock();
      }
    }
  });

  // The queue advances whether or not this caller succeeded, so one failure
  // does not strand everyone behind it.
  queue = run.then(() => {}, () => {});
  return run;
}
