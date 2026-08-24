import { fromFileUrl, join } from "#veryfront/compat/path";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

const REPOSITORY_ROOT = fromFileUrl(new URL("../../../", import.meta.url));

describe("test runner environment", () => {
  it("removes inherited provider credentials before running a test file", async () => {
    const tempDir = await Deno.makeTempDir();
    const testPath = join(tempDir, "environment-probe.test.ts");
    try {
      await Deno.writeTextFile(
        testPath,
        `Deno.test("receives a sanitized environment", () => {
  if (Deno.env.get("OPENAI_API_KEY") !== undefined) {
    throw new Error("provider credential reached the test process");
  }
  if (Deno.env.get("RUNNER_PASSTHROUGH_MARKER") !== "visible") {
    throw new Error("benign parent environment did not reach the test process");
  }
});\n`,
      );

      const output = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--allow-run=deno",
          "--allow-env",
          "scripts/test/run-test-file.ts",
          testPath,
        ],
        cwd: REPOSITORY_ROOT,
        env: {
          OPENAI_API_KEY: "test-only-provider-key",
          RUNNER_PASSTHROUGH_MARKER: "visible",
        },
        stdout: "piped",
        stderr: "piped",
      }).output();

      assertEquals(
        output.success,
        true,
        new TextDecoder().decode(output.stderr),
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });
});
