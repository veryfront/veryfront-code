const PRELOAD_PATH = "./tests/bun/preload.ts";

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
