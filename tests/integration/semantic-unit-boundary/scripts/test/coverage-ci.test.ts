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

import { buildCoverageCommandArgs } from "../../../../../scripts/test/coverage-ci.ts";

const REPOSITORY_ROOT = fromFileUrl(
  new URL("../../../../../", import.meta.url),
);

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

describe("coverage checkout paths", () => {
  async function mergeFixture(sourcePath: string) {
    const directory = await Deno.realPath(await makeTempDir());
    try {
      await Deno.mkdir(join(directory, "src"));
      await Deno.writeTextFile(
        join(directory, "src/task.ts"),
        "export const value = 1;\n",
      );
      await Deno.writeTextFile(
        join(directory, "input.info"),
        `SF:${sourcePath}\nDA:1,3\nBRDA:1,0,0,2\nend_of_record\n`,
      );
      const output = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          `--config=${join(REPOSITORY_ROOT, "scripts/test.deno.json")}`,
          "--no-npm",
          "--allow-read",
          "--allow-write",
          "--allow-run",
          "--allow-env",
          join(REPOSITORY_ROOT, "scripts/test/coverage-ci.ts"),
          "merge",
          "--threshold=0",
          "input.info",
        ],
        cwd: directory,
        stdout: "piped",
        stderr: "piped",
      }).output();
      return {
        success: output.success,
        stderr: new TextDecoder().decode(output.stderr),
        report: output.success
          ? await Deno.readTextFile(join(directory, "coverage/lcov.info"))
          : "",
      };
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  }

  it("merges a public-pool report against real checkout sources", async () => {
    const result = await mergeFixture(
      "/home/runner/_work/veryfront-code/veryfront-code/src/task.ts",
    );
    assertEquals(result.success, true, result.stderr);
    assert(result.report.includes("SF:src/task.ts"));
    assert(result.report.includes("DA:1,3"));
    assert(result.report.includes("BRDA:1,0,0,2"));
  });

  it("fails on unknown and nonexistent source paths", async () => {
    for (
      const path of [
        "/cache/src/task.ts",
        "/home/runner/work/veryfront-code/veryfront-code/src/missing.ts",
      ]
    ) {
      const result = await mergeFixture(path);
      assertEquals(result.success, false);
      assert(result.stderr.includes("LCOV source"), result.stderr);
    }
  });

  it("produces coverage only for checkout sources even when generated cache modules execute", async () => {
    const directory = await Deno.realPath(await makeTempDir());
    try {
      const checkout = join(directory, "checkout");
      const cache = join(directory, "cache");
      for (const root of [checkout, cache]) {
        await Deno.mkdir(join(root, "src"), { recursive: true });
        await Deno.writeTextFile(
          join(root, "src/value.js"),
          "export const value = 1;\n",
        );
      }
      const test = join(directory, "fixture.test.js");
      await Deno.writeTextFile(
        test,
        `import { value } from "./checkout/src/value.js";\nimport { value as generated } from "./cache/src/value.js";\nDeno.test("coverage source boundary", () => { if (value + generated !== 2) throw new Error("wrong value"); });\n`,
      );
      const profiles = join(directory, "profiles");
      const run = await new Deno.Command(Deno.execPath(), {
        args: [
          "test",
          "--no-config",
          "--no-check",
          "--coverage-raw-data-only",
          `--coverage=${profiles}`,
          test,
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(run.success, true, new TextDecoder().decode(run.stderr));
      const coverage = await new Deno.Command(Deno.execPath(), {
        args: buildCoverageCommandArgs([profiles], checkout),
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(
        coverage.success,
        true,
        new TextDecoder().decode(coverage.stderr),
      );
      const report = new TextDecoder().decode(coverage.stdout);
      assert(report.includes(`${checkout}/src/value.js`), report);
      assert(!report.includes(`${cache}/src/value.js`), report);
      assert(report.includes("DA:1,1"), report);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });
});
