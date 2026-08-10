const PRELOAD_PATH = "./tests/bun/preload.ts";
const TERMINATION_SIGNALS = ["SIGINT", "SIGTERM"];

export function registerBunWorkspaceCleanup(cleanup, runtimeProcess = process) {
  let cleaned = false;
  const cleanupOnce = () => {
    if (cleaned) return;
    cleaned = true;
    cleanup();
  };

  runtimeProcess.once("exit", cleanupOnce);
  for (const signal of TERMINATION_SIGNALS) {
    runtimeProcess.once(signal, () => {
      try {
        cleanupOnce();
      } finally {
        runtimeProcess.kill(runtimeProcess.pid, signal);
      }
    });
  }
}

export function buildBunTestArgs(files, concurrency) {
  return [
    "--no-env-file",
    "test",
    "--preload",
    PRELOAD_PATH,
    "--max-concurrency",
    String(concurrency),
    ...files,
  ];
}

export function buildIsolatedBunTestRuns(files) {
  return files.map((file) => buildBunTestArgs([file], 1));
}
