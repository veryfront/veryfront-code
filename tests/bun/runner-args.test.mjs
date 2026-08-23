import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildBunTestArgs,
  buildIsolatedBunTestRuns,
  registerBunWorkspaceCleanup,
} from "./runner-args.mjs";

const runTestsPath = fileURLToPath(new URL("./run-tests.mjs", import.meta.url));

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
  const source = readFileSync(
    new URL("./run-tests.mjs", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /child\.on\("close", \(code\) => finish\(code \?\? 1\)\)/,
  );
  assert.doesNotMatch(source, /process\.exit\(/);
  assert.match(source, /process\.exitCode = ok \? 0 : 1/);
});

test("the Bun runner fails loudly when filters select no files", () => {
  const result = spawnSync(
    process.execPath,
    [runTestsPath],
    {
      env: { ...process.env, BUN_TEST_INCLUDE: "missing-bun-fixture.test.ts" },
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Bun test runner failed: Error: Suite planner failed for runtime:bun \(exit 4\):/,
  );
  assert.match(result.stderr, /runtime:bun selected no test files/);
  assert.doesNotMatch(result.stdout, /0 passed, 0 failed/);
});

test("the empty-selection spawn path is decoded through fileURLToPath", () => {
  const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const runnerPathnameAccess = 'run-tests.mjs", import.meta.url)' +
    ".pathname";

  assert.match(
    source,
    /const runTestsPath = fileURLToPath\(new URL\("\.\/run-tests\.mjs", import\.meta\.url\)\)/,
  );
  assert.equal(source.includes(runnerPathnameAccess), false);
});

test("Bun workspace cleanup runs before termination signals are re-raised", () => {
  const runtimeProcess = new EventEmitter();
  runtimeProcess.pid = 123;
  const events = [];
  runtimeProcess.kill = (pid, signal) => events.push(["kill", pid, signal]);

  registerBunWorkspaceCleanup(() => events.push(["cleanup"]), runtimeProcess);
  runtimeProcess.emit("SIGINT");
  runtimeProcess.emit("exit");

  assert.deepEqual(events, [["cleanup"], ["kill", 123, "SIGINT"]]);
});
