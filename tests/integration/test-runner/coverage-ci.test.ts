import { fromFileUrl } from "#veryfront/compat/path";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

const REPOSITORY_ROOT = fromFileUrl(new URL("../../../", import.meta.url));

describe("coverage CI runner", () => {
  it("does not treat a separate threshold value as an LCOV path", async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const output = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          `--config=${REPOSITORY_ROOT}/scripts/test.deno.json`,
          "--no-npm",
          "--allow-read",
          "--allow-write",
          `${REPOSITORY_ROOT}/scripts/test/coverage-ci.ts`,
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
