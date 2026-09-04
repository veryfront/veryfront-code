/**
 * Integration test for the build smokes' deadline-bounded subprocess runner.
 * It spawns real child processes, so it lives at the integration boundary
 * rather than colocated with scripts/build/bounded-command.ts.
 */

import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runBoundedCommand } from "../../../../../scripts/build/bounded-command.ts";

describe("bounded build subprocess", () => {
  it("returns the output of a command that finishes inside its deadline", async () => {
    const result = await runBoundedCommand({
      command: Deno.execPath(),
      args: ["eval", "console.log('finished')"],
      timeoutMs: 60_000,
    });

    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "finished");
  });

  it("kills a stalled command and names it in the failure", async () => {
    const error = await assertRejects(
      () =>
        runBoundedCommand({
          command: Deno.execPath(),
          // A pending timer keeps the event loop alive, so this child really
          // blocks until the runner kills it.
          args: ["eval", "await new Promise((resolve) => setTimeout(resolve, 600000));"],
          timeoutMs: 500,
        }),
      Error,
    );

    assertInstanceOf(error, Error);
    // The message must identify which command stalled: a job-level cancel names
    // nothing, which is exactly what made the CI stalls unattributable.
    assertStringIncludes(error.message, "timed out after 500ms");
    assertStringIncludes(error.message, "eval");
  });
});
