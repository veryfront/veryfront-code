/** Join the executor runtime and channel retirement branches. */
export async function awaitExecutorCleanup(tasks: readonly Promise<unknown>[]): Promise<void> {
  const results = await Promise.allSettled(tasks);
  if (results.some((result) => result.status === "rejected")) {
    throw new Error("Executor cleanup failed");
  }
}
