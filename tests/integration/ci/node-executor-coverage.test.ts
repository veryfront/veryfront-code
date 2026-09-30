import { fileURLToPath } from "node:url";
import { relative } from "node:path";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDirWithOptions } from "#veryfront/testing/deno-compat.ts";
import {
  buildNativeCoverageArgs,
  validateNativeCoverage,
} from "../../../scripts/test/coverage-node-executor.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));

describe("native executor source coverage", () => {
  it("retains original source coverage from an owned child process", async () => {
    await Deno.mkdir(`${root}/coverage`, { recursive: true });
    const directory = await makeTempDirWithOptions({
      dir: `${root}/coverage`,
      prefix: "node-child-",
    });
    const source = `${directory}/child-source.ts`;
    const child = `${directory}/child.ts`;
    const test = `${directory}/child.test.ts`;
    const lcov = `${directory}/lcov.info`;
    await Deno.writeTextFile(
      source,
      [
        "export interface Input {",
        "  value: number;",
        "}",
        "",
        "export function childTarget(input: Input): number {",
        "  return input.value + 1;",
        "}",
      ].join("\n"),
    );
    await Deno.writeTextFile(
      child,
      'import { childTarget } from "./child-source.ts"; if (childTarget({ value: 2 }) !== 3) throw new Error("Invalid result");',
    );
    await Deno.writeTextFile(
      test,
      [
        'import { test } from "node:test";',
        'import { spawnSync } from "node:child_process";',
        'import process from "node:process";',
        'import assert from "node:assert/strict";',
        'test("executes child source", () => {',
        `  const result = spawnSync(process.execPath, ["--enable-source-maps", "--import", ${
          JSON.stringify(`${root}/tests/node/resolver.mjs`)
        }, ${JSON.stringify(child)}], {`,
        '    env: { NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE }, encoding: "utf8",',
        "  });",
        "  assert.equal(result.status, 0, result.stderr);",
        "});",
      ].join("\n"),
    );
    try {
      const output = await new Deno.Command("node", {
        args: buildNativeCoverageArgs({
          root,
          reportPath: lcov,
          sourceFiles: [relative(root, source)],
          testFiles: [test],
        }),
        cwd: root,
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
      const summaries = await validateNativeCoverage({
        root,
        reportPath: lcov,
        sourceFiles: [source],
      });
      assertEquals(summaries.length, 1);
      assert(summaries[0]!.linesHit > 0);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });

  it("retains an original function anchor when generated coordinates repeat its name", async () => {
    await Deno.mkdir(`${root}/coverage`, { recursive: true });
    const directory = await makeTempDirWithOptions({
      dir: `${root}/coverage`,
      prefix: "node-body-anchor-",
    });
    const source = `${directory}/body-anchor.ts`;
    const lcov = `${directory}/lcov.info`;
    await Deno.writeTextFile(
      source,
      [
        "/** Typed declaration whose first executable range starts later. */",
        "export function bodyMappedTarget(value: number): number {",
        "  if (value > 0) {",
        "    return value;",
        "  }",
        "  return 0;",
        "}",
        "",
        "export const trailingTopLevel = 1;",
      ].join("\n"),
    );
    await Deno.writeTextFile(
      lcov,
      [
        "TN:",
        `SF:${source}`,
        "FN:4,bodyMappedTarget",
        "FN:1,bodyMappedTarget",
        "FNDA:1,bodyMappedTarget",
        "DA:4,1",
        "end_of_record",
        "",
      ].join("\n"),
    );
    try {
      const summaries = await validateNativeCoverage({
        root,
        reportPath: lcov,
        sourceFiles: [source],
      });
      assertEquals(summaries, [{ source, linesHit: 1, linesFound: 1 }]);
      await Deno.writeTextFile(
        lcov,
        [
          "TN:",
          `SF:${source}`,
          "FN:9,bodyMappedTarget",
          "FNDA:1,bodyMappedTarget",
          "DA:9,1",
          "end_of_record",
          "",
        ].join("\n"),
      );
      await assertRejects(
        () => validateNativeCoverage({ root, reportPath: lcov, sourceFiles: [source] }),
        Error,
        "not mapped to original source",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });

  it("maps real TypeScript coverage and rejects transformed JavaScript positions", async () => {
    await Deno.mkdir(`${root}/coverage`, { recursive: true });
    const directory = await makeTempDirWithOptions({
      dir: `${root}/coverage`,
      prefix: "node-mapping-",
    });
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
          assert(summaries[0]!.linesHit > 0);
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
