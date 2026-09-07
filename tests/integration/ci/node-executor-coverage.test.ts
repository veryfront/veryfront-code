import { fileURLToPath } from "node:url";
import { relative } from "node:path";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildNativeCoverageArgs,
  validateNativeCoverage,
} from "../../../scripts/test/coverage-node-executor.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));

describe("native executor source coverage", () => {
  it("maps real TypeScript coverage and rejects transformed JavaScript positions", async () => {
    await Deno.mkdir(`${root}/coverage`, { recursive: true });
    const directory = await Deno.makeTempDir({ dir: `${root}/coverage`, prefix: "node-mapping-" });
    const source = `${directory}/mapping-fixture.ts`;
    const test = `${directory}/mapping-fixture.test.ts`;
    const lcov = `${directory}/lcov.info`;
    // Erased types and comments make generated lines differ from source lines.
    await Deno.writeTextFile(
      source,
      [
        "export interface FixtureInput {",
        "  value: number;",
        "  label?: string;",
        "}",
        "",
        "/** An ordinary typed function used to check source positions. */",
        "export function mappingTarget(input: FixtureInput): number {",
        "  if (input.value > 0) {",
        "    return input.value;",
        "  }",
        "  return 0;",
        "}",
        "",
      ].join("\n"),
    );
    await Deno.writeTextFile(
      test,
      [
        'import { test } from "node:test";',
        'import assert from "node:assert/strict";',
        'import { mappingTarget } from "./mapping-fixture.ts";',
        'test("maps typed fixture", () => {',
        "  assert.equal(mappingTarget({ value: 3 }), 3);",
        "});",
      ].join("\n"),
    );
    try {
      const args = buildNativeCoverageArgs({
        root,
        reportPath: lcov,
        sourceFiles: [relative(root, source)],
        testFiles: [test],
      });
      for (const mapped of [false, true]) {
        const output = await new Deno.Command("node", {
          args: mapped ? args : args.filter((arg: string) => arg !== "--enable-source-maps"),
          cwd: root,
          stdout: "piped",
          stderr: "piped",
        }).output();
        assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
        if (mapped) {
          const summaries = await validateNativeCoverage({
            root,
            reportPath: lcov,
            sourceFiles: [source],
          });
          assertEquals(summaries.length, 1);
          assert(summaries[0].linesHit > 0);
        } else {
          await assertRejects(
            () => validateNativeCoverage({ root, reportPath: lcov, sourceFiles: [source] }),
            Error,
            "not mapped to original source",
          );
        }
      }
      await Deno.writeTextFile(lcov, "");
      await assertRejects(
        () => validateNativeCoverage({ root, reportPath: lcov, sourceFiles: [source] }),
        Error,
        "Missing native coverage record",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });
});
