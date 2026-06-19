import { assertEquals, assertStringIncludes, assertThrows } from "#std/assert";
import {
  buildCoverageCommandArgs,
  buildDenoTestCommandArgs,
  mergeLcovReports,
  parseShardSpec,
  selectShardFiles,
} from "../../scripts/test/coverage-ci.ts";

Deno.test("parseShardSpec accepts one-based shard coordinates", () => {
  assertEquals(parseShardSpec("3/8"), { index: 3, total: 8 });
});

Deno.test("parseShardSpec rejects out-of-range shard coordinates", () => {
  assertThrows(
    () => parseShardSpec("0/8"),
    Error,
    "Invalid shard spec",
  );
  assertThrows(
    () => parseShardSpec("9/8"),
    Error,
    "Invalid shard spec",
  );
});

Deno.test("selectShardFiles splits files deterministically by sorted order", () => {
  const files = [
    "src/d.test.ts",
    "src/a.test.ts",
    "src/c.test.ts",
    "src/b.test.ts",
    "src/e.test.ts",
  ];

  assertEquals(selectShardFiles(files, { index: 1, total: 2 }), [
    "src/a.test.ts",
    "src/c.test.ts",
    "src/e.test.ts",
  ]);
  assertEquals(selectShardFiles(files, { index: 2, total: 2 }), [
    "src/b.test.ts",
    "src/d.test.ts",
  ]);
});

Deno.test("buildDenoTestCommandArgs keeps coverage profiles isolated per shard", () => {
  const args = buildDenoTestCommandArgs({
    coverageDir: "coverage-shard-3",
    files: ["src/example.test.ts"],
  });

  assertEquals(args.includes("--coverage=coverage-shard-3"), true);
  assertEquals(args.includes("--coverage-raw-data-only"), true);
  assertEquals(args.includes("--parallel"), true);
  assertEquals(args.includes("src/example.test.ts"), true);
});

Deno.test("buildCoverageCommandArgs converts a shard profile dir to an lcov stream", () => {
  const args = buildCoverageCommandArgs([
    "coverage-shard-1",
  ]);

  assertStringIncludes(args.join(" "), "coverage-shard-1");
  assertEquals(args.includes("--lcov"), true);
  assertEquals(args.includes("--include=src/"), true);
});

Deno.test("mergeLcovReports combines line hits from all shard lcov files", () => {
  const merged = mergeLcovReports([
    [
      "SF:src/shared.ts",
      "DA:1,1",
      "DA:2,0",
      "LH:1",
      "LF:2",
      "end_of_record",
    ].join("\n"),
    [
      "SF:src/shared.ts",
      "DA:1,0",
      "DA:2,3",
      "LH:1",
      "LF:2",
      "end_of_record",
    ].join("\n"),
  ]);

  assertStringIncludes(merged, "SF:src/shared.ts");
  assertStringIncludes(merged, "DA:1,1");
  assertStringIncludes(merged, "DA:2,3");
  assertStringIncludes(merged, "LH:2");
  assertStringIncludes(merged, "LF:2");
});
