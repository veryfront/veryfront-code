/** Internal worker modules must enter DNT's graph without becoming public APIs. */
export const NPM_WORKER_ENTRYPOINT = {
  name: "./__build/declarative-worker",
  path: "./src/config/declarative-evaluator-worker-entry.ts",
};

export async function finalizeNpmWorkerEntrypoints(
  outputRoot: string,
  pkg: { exports?: Record<string, unknown>; dependencies?: Record<string, string> },
): Promise<void> {
  const worker = await Deno.stat(
    `${outputRoot}/esm/src/config/declarative-evaluator-worker-entry.js`,
  );
  if (!worker.isFile) {
    throw new Error("Compiled declarative worker entry missing");
  }
  if (pkg.exports) delete pkg.exports[NPM_WORKER_ENTRYPOINT.name];
  // First-party dependencies are added after their local packages are built.
  // Installing an unpublished RC parser during DNT postBuild would fail.
  if (pkg.dependencies) delete pkg.dependencies["@veryfront/ext-parser-babel"];
}
