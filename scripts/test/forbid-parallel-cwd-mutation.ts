import process from "node:process";

export const PARALLEL_CWD_MUTATION_ERROR =
  "Process-global CWD mutation is forbidden in the parallel unit-test lane. " +
  "Refactor the test to use explicit paths, or add it to the reviewed serial-CWD manifest.";

function rejectParallelCwdMutation(): never {
  throw new Error(PARALLEL_CWD_MUTATION_ERROR);
}

for (const target of [Deno, process]) {
  Object.defineProperty(target, "chdir", {
    configurable: false,
    enumerable: true,
    value: rejectParallelCwdMutation,
    // Compatibility shims such as graceful-fs wrap process.chdir by assignment
    // while retaining and delegating to the original function. Keeping the
    // guarded function writable permits that composition; the captured
    // original still rejects every actual mutation.
    writable: true,
  });
}
