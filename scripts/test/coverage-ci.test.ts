import { fromFileUrl, join } from "#std/path";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildCoverageCommandArgs,
  buildDenoTestCommandArgs,
} from "./coverage-ci.ts";

/**
 * The `--exclude` values as regexes, the way `deno coverage` reads them. Kept as
 * literal substrings so JavaScript and Rust regex syntax cannot diverge here.
 */
function coverageExcludePatterns(): RegExp[] {
  return buildCoverageCommandArgs(["coverage-shard-1"])
    .filter((arg) => arg.startsWith("--exclude="))
    .map((arg) => new RegExp(arg.slice("--exclude=".length)));
}

const providerDenyNet =
  "--deny-net=api.openai.com,api.anthropic.com,generativelanguage.googleapis.com,api.mistral.ai,api.groq.com,api.deepseek.com,openrouter.ai";

describe("coverage CI command", () => {
  it("denies live provider egress while preserving allow-all for local test fixtures", () => {
    const args = buildDenoTestCommandArgs({
      coverageDir: "coverage-shard-1",
      files: ["src/provider/model-registry.test.ts"],
    });

    assert(args.includes("--allow-all"));
    assertEquals(args.includes(providerDenyNet), true);
    assertEquals(
      args.indexOf(providerDenyNet) > args.indexOf("--allow-all"),
      true,
    );
  });

  it("reports on cli/ as well as src/", () => {
    const args = buildCoverageCommandArgs(["coverage-shard-1"]);

    // The unit suite runs cli/ tests on every shard; before cli/ was included
    // here that coverage was collected and then dropped at report time.
    assert(args.includes("--include=src/"));
    assert(args.includes("--include=cli/"));
  });

  it("keeps published modules whose name contains 'tests'", () => {
    // `deno coverage --exclude` takes a regex over the file URL. A bare `tests`
    // matched this path, so bringing cli/ into the report would otherwise have
    // silently dropped the module behind the `vf_run_tests` MCP tool.
    const published = "file:///repo/cli/mcp/tools/run-tests-tool.ts";

    for (const pattern of coverageExcludePatterns()) {
      assert(
        !pattern.test(published),
        `${pattern.source} must not exclude ${published}`,
      );
    }
  });

  it("keeps both test directories out of the report", () => {
    const excluded = [
      "file:///repo/tests/integration/thing.test.ts",
      "file:///repo/src/html/styles-builder/__tests__/css-processor-setup.ts",
    ];

    for (const path of excluded) {
      assert(
        coverageExcludePatterns().some((pattern) => pattern.test(path)),
        `${path} must be excluded from coverage`,
      );
    }
  });

  it("does not treat a separate threshold value as an LCOV path", async () => {
    const repoRoot = fromFileUrl(new URL("../../", import.meta.url));
    const tempDir = await Deno.makeTempDir();
    try {
      const output = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          `--config=${join(repoRoot, "scripts/test.deno.json")}`,
          "--no-npm",
          "--allow-read",
          "--allow-write",
          join(repoRoot, "scripts/test/coverage-ci.ts"),
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

  it("keeps the merge task loadable with npm disabled", async () => {
    const repoRoot = fromFileUrl(new URL("../../", import.meta.url));
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["task", "coverage:ci:merge"],
      cwd: repoRoot,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stderr = new TextDecoder().decode(output.stderr);

    assertEquals(output.success, false);
    assert(stderr.includes("At least one LCOV file or directory is required."));
    assertEquals(stderr.includes("npm specifiers were requested"), false);
  });
});

describe("buildDenoTestCommandArgs leak tracing", () => {
  it("traces leaks, so the first failure names the source", () => {
    // These leaks are load-dependent and do not reproduce on demand. Without
    // the flag the run reports only "run again with --trace-leaks", advice that
    // cannot be taken for a failure that will not recur.
    assert(
      buildDenoTestCommandArgs({ coverageDir: "cov", files: ["a.test.ts"] })
        .includes("--trace-leaks"),
    );
  });
});
