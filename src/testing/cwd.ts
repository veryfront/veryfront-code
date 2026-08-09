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
 * @module testing/cwd
 */

/** Tail of the queue. Each caller awaits the previous one before it chdirs. */
let queue: Promise<void> = Promise.resolve();

/**
 * Run `fn` with the process working directory set to `dir`.
 *
 * Waits for any other caller to finish first, and restores the previous
 * directory afterwards even if `fn` throws.
 *
 * @param dir directory to enter
 * @param fn work to run inside it
 * @returns whatever `fn` returns
 */
export function withCwd<T>(dir: string, fn: () => Promise<T> | T): Promise<T> {
  const run = queue.then(async () => {
    const previous = Deno.cwd();
    try {
      Deno.chdir(dir);
      return await fn();
    } finally {
      Deno.chdir(previous);
    }
  });

  // The queue advances whether or not this caller succeeded, so one failure
  // does not strand everyone behind it.
  queue = run.then(() => {}, () => {});
  return run;
}
