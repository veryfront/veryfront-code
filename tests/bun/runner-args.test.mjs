import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildBunTestArgs, buildIsolatedBunTestRuns } from "./runner-args.mjs";

test("buildBunTestArgs caps concurrency without enabling concurrent test semantics", () => {
  const args = buildBunTestArgs(["one.test.ts", "two.test.ts"], 3);

  assert.deepEqual(args, [
    "--no-env-file",
    "test",
    "--preload",
    "./tests/bun/preload.ts",
    "--max-concurrency",
    "3",
    "one.test.ts",
    "two.test.ts",
  ]);
  assert.equal(args.includes("--concurrent"), false);
  assert.equal(args.includes("--concurrency"), false);
});

test("buildIsolatedBunTestRuns puts each test file in its own Bun process", () => {
  assert.deepEqual(buildIsolatedBunTestRuns(["one.test.ts", "two.test.ts"]), [
    buildBunTestArgs(["one.test.ts"], 1),
    buildBunTestArgs(["two.test.ts"], 1),
  ]);
});

test("the Bun runner drains child output and exits naturally", () => {
  const source = readFileSync(new URL("./run-tests.mjs", import.meta.url), "utf8");

  assert.match(source, /child\.on\("close", \(code\) => finish\(code \?\? 1\)\)/);
  assert.doesNotMatch(source, /process\.exit\(/);
  assert.match(source, /process\.exitCode = ok \? 0 : 1/);
});
