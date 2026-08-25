/**
 * Integration test for the coverage CI runner's effectful half: the merge
 * subcommand's argument parsing proven from a real subprocess run against a
 * throwaway working directory. It spawns Deno and writes to disk, so it lives
 * at the integration boundary; the pure command-building functions are
 * unit-tested next to the runner in scripts/test/coverage-ci.test.ts.
 */

import { fromFileUrl, join } from "#std/path";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";

const REPOSITORY_ROOT = fromFileUrl(new URL("../../../../../", import.meta.url));

describe("coverage CI runner", () => {
  it("does not treat a separate threshold value as an LCOV path", async () => {
    const tempDir = await makeTempDir();
    try {
      const output = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          `--config=${join(REPOSITORY_ROOT, "scripts/test.deno.json")}`,
          "--no-npm",
          "--allow-read",
          "--allow-write",
          join(REPOSITORY_ROOT, "scripts/test/coverage-ci.ts"),
          "merge",
          "--threshold",
          "85",
          "missing-lcov",
        ],
        cwd: tempDir,
        stdout: "piped",
        stderr: "piped",
      }).output();
      const stderr = new TextDecoder().decode(output.stderr);

      assertEquals(output.success, false);
      assert(
        stderr.includes("missing-lcov"),
        `expected the positional LCOV path in the failure, got: ${stderr}`,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });
});
