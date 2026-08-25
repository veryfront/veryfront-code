// @veryfront-test runtime-guarded-deno
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runCommand } from "#veryfront/platform/compat/process.ts";
import { isBun, isDeno } from "#veryfront/platform/compat/runtime.ts";

/**
 * `runCommand` reports a missing executable in three different shapes, one per
 * host, because each host's spawn primitive reports ENOENT differently:
 *
 *   - Deno: `Command.spawn()` throws, so the call rejects with
 *     `Deno.errors.NotFound`.
 *   - Bun: `Bun.spawn()` throws, so the call rejects with an ENOENT `Error`.
 *   - Node: `child_process.spawn` reports ENOENT asynchronously on the `error`
 *     event, so the call resolves a failure result whose stderr carries
 *     `Spawn error: ...` -- see the comment on that handler in
 *     src/platform/compat/process/command.ts.
 *
 * None of that is assertable from src/platform/compat/process.test.ts: that
 * file reads `Deno.*` unguarded, so `isDenoDependentTestSource` drops it from
 * both runtime planners and any non-Deno branch written there is dead code.
 * This file carries the runtime-guarded header and is named by
 * RUNTIME_PATTERNS in scripts/test/run-suite.ts, so every branch below runs in
 * a configured lane.
 */
describe("integration/runtime/compat/spawn-missing-executable", () => {
  const missingExecutable = "__nonexistent_command_12345__";

  it("surfaces a missing executable instead of reporting success", async () => {
    if (isDeno) {
      await assertRejects(
        () => runCommand(missingExecutable, { capture: true }),
        Deno.errors.NotFound,
        undefined,
        "the Deno lane must reject a missing executable with NotFound, not report success",
      );
      return;
    }

    if (isBun) {
      const error = await assertRejects(
        () => runCommand(missingExecutable, { capture: true }),
        Error,
        undefined,
        "the Bun lane must reject a missing executable, not report success",
      );
      assertEquals(
        (error as { code?: unknown }).code,
        "ENOENT",
        "the Bun rejection must keep the underlying errno so callers can tell ENOENT from EACCES",
      );
      return;
    }

    const result = await runCommand(missingExecutable, { capture: true });
    assertEquals(result.success, false, "a missing executable must report failure");
    assertEquals(result.code, 1, "a failed spawn must report exit code 1, not 0");
    assertStringIncludes(
      result.stderr ?? "",
      "Spawn error",
      "the spawn failure must reach the caller in stderr",
    );
    assertStringIncludes(
      result.stderr ?? "",
      "ENOENT",
      "the Node stderr must keep the underlying errno so callers can tell ENOENT from EACCES",
    );
  });

  it("reports a missing executable the same way when capture is off", async () => {
    if (isDeno || isBun) {
      await assertRejects(
        () => runCommand(missingExecutable),
        Error,
        undefined,
        "a throwing spawn primitive rejects before any capture decision is reached",
      );
      return;
    }

    const result = await runCommand(missingExecutable);
    assertEquals(result.success, false, "an uncaptured missing executable still reports failure");
    assertEquals(result.code, 1, "an uncaptured failed spawn must report exit code 1");
    assertEquals(
      result.stderr,
      undefined,
      "stderr must stay undefined when the caller did not ask to capture",
    );
  });
});
