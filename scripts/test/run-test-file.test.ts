import { fromFileUrl, join } from "#std/path";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildTestFileCommandArgs,
  PROVIDER_EGRESS_DENY_NET,
  TEST_FILE_ENV,
} from "./run-test-file.ts";

describe("test:file task command", () => {
  it("preserves test isolation flags while forwarding source paths and args", () => {
    const args = buildTestFileCommandArgs([
      "src/config/cicd-coverage-workflow.test.ts",
      "--filter",
      "cicd",
      "--allow-net=api.openai.com",
    ]);

    assertEquals(TEST_FILE_ENV.DENO_TESTING, "1");
    assertEquals(args.includes("--preload=src/testing/preload.ts"), true);
    assertEquals(args.includes("--allow-all"), true);
    assertEquals(args.includes(PROVIDER_EGRESS_DENY_NET), true);
    assertEquals(
      args.indexOf(PROVIDER_EGRESS_DENY_NET) > args.indexOf("--allow-all"),
      true,
    );
    assertEquals(args.slice(-4), [
      "src/config/cicd-coverage-workflow.test.ts",
      "--filter",
      "cicd",
      "--allow-net=api.openai.com",
    ]);
  });

  it("uses the scripts config for script tests without dropping forwarded args", () => {
    const args = buildTestFileCommandArgs([
      "scripts/test/coverage-ci.test.ts",
      "--filter",
      "coverage",
    ]);

    assertEquals(args.includes("--config=scripts/test.deno.json"), true);
    assertEquals(args.includes("--preload=src/testing/preload.ts"), false);
    assertEquals(args.includes(PROVIDER_EGRESS_DENY_NET), true);
    assertEquals(args.slice(-3), [
      "scripts/test/coverage-ci.test.ts",
      "--filter",
      "coverage",
    ]);
  });
});

describe("test runner environment", () => {
  it("removes inherited provider credentials before running a test file", async () => {
    const repoRoot = fromFileUrl(new URL("../../", import.meta.url));
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
        cwd: repoRoot,
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

describe("buildTestFileCommandArgs leak tracing", () => {
  it("traces leaks, so the first failure names the source", () => {
    // These leaks are load-dependent and do not reproduce on demand. Without
    // the flag the run reports only "run again with --trace-leaks", advice that
    // cannot be taken for a failure that will not recur.
    assertEquals(
      buildTestFileCommandArgs(["a.test.ts"]).includes("--trace-leaks"),
      true,
    );
  });
});
