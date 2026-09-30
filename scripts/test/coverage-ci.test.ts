import { fromFileUrl } from "#std/path";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildCoverageCommandArgs,
  buildDenoTestCommandArgs,
  LOOPBACK_ALLOW_NET,
  mergeLcovReports,
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
  "--deny-net=api.openai.com,api.anthropic.com,generativelanguage.googleapis.com,api.mistral.ai,api.groq.com,api.deepseek.com,openrouter.ai,mcp.context7.com";

describe("coverage CI command", () => {
  it("runs coverage shards with loopback-only network permission", () => {
    const args = buildDenoTestCommandArgs({
      coverageDir: "coverage-shard-1",
      files: ["src/provider/model-registry.test.ts"],
    });

    assertEquals(args.includes("--allow-all"), false);
    assertEquals(args.includes(providerDenyNet), false);
    assert(args.includes(LOOPBACK_ALLOW_NET));
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

describe("mergeLcovReports", () => {
  it("sums branch hits across reports and preserves uncovered branches", () => {
    const merged = mergeLcovReports([
      "SF:src/task.ts\nDA:10,2\nBRDA:10,0,0,2\nBRDA:10,0,1,-\nBRDA:10,1,0,-\nBRF:3\nBRH:1\nend_of_record",
      "SF:src/task.ts\nDA:10,3\nBRDA:10,0,0,1\nBRDA:10,0,1,3\nBRDA:10,1,0,0\nBRF:3\nBRH:2\nend_of_record",
    ]);
    assertEquals(
      merged,
      [
        "SF:src/task.ts",
        "DA:10,5",
        "LH:1",
        "LF:1",
        "BRDA:10,0,0,3",
        "BRDA:10,0,1,3",
        "BRDA:10,1,0,0",
        "BRF:3",
        "BRH:2",
        "end_of_record",
      ].join("\n"),
    );
  });

  it("merges the same condition when Deno assigns different block ids", () => {
    const merged = mergeLcovReports([
      "SF:src/nested.ts\nDA:6,1\nBRDA:6,3,0,1\nBRDA:6,3,1,-\nend_of_record",
      "SF:src/nested.ts\nDA:6,1\nBRDA:6,2,0,-\nBRDA:6,2,1,1\nend_of_record",
    ]);

    assertEquals(
      merged,
      [
        "SF:src/nested.ts",
        "DA:6,2",
        "LH:1",
        "LF:1",
        "BRDA:6,0,0,1",
        "BRDA:6,0,1,1",
        "BRF:2",
        "BRH:2",
        "end_of_record",
      ].join("\n"),
    );
  });

  it("keeps line-only reports unchanged and isolates files", () => {
    assertEquals(
      mergeLcovReports([
        "SF:b.ts\nDA:2,0\nDA:1,2\nend_of_record\nSF:a.ts\nDA:1,1\nend_of_record",
        "SF:b.ts\nDA:1,3\nend_of_record",
      ]),
      [
        "SF:a.ts",
        "DA:1,1",
        "LH:1",
        "LF:1",
        "end_of_record",
        "SF:b.ts",
        "DA:1,5",
        "DA:2,0",
        "LH:1",
        "LF:2",
        "end_of_record",
      ].join("\n"),
    );
  });

  it("keeps branch totals when only some reports carry branch data", () => {
    assertEquals(
      mergeLcovReports([
        "SF:src/task.ts\nDA:118,1\nBRDA:118,0,0,1\nBRDA:118,0,1,-\nend_of_record",
        "SF:src/task.ts\nDA:118,2\nend_of_record",
        "SF:src/task.ts\nDA:118,0\nBRDA:118,0,1,4\nend_of_record",
      ]),
      [
        "SF:src/task.ts",
        "DA:118,3",
        "LH:1",
        "LF:1",
        "BRDA:118,0,0,1",
        "BRDA:118,0,1,4",
        "BRF:2",
        "BRH:2",
        "end_of_record",
      ].join("\n"),
    );
  });

  it("orders branches numerically by line, block, then branch", () => {
    assertEquals(
      mergeLcovReports([
        "SF:a.ts\nBRDA:10,2,0,1\nBRDA:9,10,0,1\nBRDA:9,2,1,0\nBRDA:9,2,0,1\nend_of_record",
      ]),
      [
        "SF:a.ts",
        "LH:0",
        "LF:0",
        "BRDA:9,2,0,1",
        "BRDA:9,2,1,0",
        "BRDA:9,10,0,1",
        "BRDA:10,2,0,1",
        "BRF:4",
        "BRH:3",
        "end_of_record",
      ].join("\n"),
    );
  });

  it("ignores records between end_of_record and the next SF", () => {
    assertEquals(
      mergeLcovReports([
        "SF:a.ts\nDA:1,1\nend_of_record\nDA:2,1\nBRDA:2,0,0,1\nSF:b.ts\nDA:1,0\nend_of_record",
      ]),
      [
        "SF:a.ts",
        "DA:1,1",
        "LH:1",
        "LF:1",
        "end_of_record",
        "SF:b.ts",
        "DA:1,0",
        "LH:0",
        "LF:1",
        "end_of_record",
      ].join("\n"),
    );
  });
});
