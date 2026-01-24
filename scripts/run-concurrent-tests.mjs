#!/usr/bin/env node

import { spawn } from "node:child_process";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function resolveConcurrency(envKeys) {
  for (const key of envKeys) {
    const raw = process.env[key];
    if (!raw) continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return null;
}

function getAvailableCores() {
  return typeof os.availableParallelism === "function"
    ? os.availableParallelism()
    : os.cpus().length;
}

function splitArgs(args) {
  const bunArgs = [];
  const nodeArgs = [];
  let profile = null;
  let target = null;
  for (const arg of args) {
    if (arg === "--fast") {
      profile = "fast";
      continue;
    }
    if (arg.startsWith("--profile=")) {
      profile = arg.slice("--profile=".length) || profile;
      continue;
    }
    if (arg === "--bun") {
      target = "bun";
      continue;
    }
    if (arg === "--node") {
      target = "node";
      continue;
    }
    if (target === "bun") {
      bunArgs.push(arg);
      continue;
    }
    if (target === "node") {
      nodeArgs.push(arg);
      continue;
    }
    bunArgs.push(arg);
    nodeArgs.push(arg);
  }
  return { bunArgs, nodeArgs, profile };
}

const args = process.argv.slice(2);
const { bunArgs, nodeArgs, profile } = splitArgs(args);
const hasExplicitArgs = args.length > 0;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const bunRunner = resolve(scriptDir, "run-bun-tests.mjs");
const nodeRunner = resolve(scriptDir, "run-node-tests.mjs");

const availableCores = getAvailableCores();
const totalConcurrency =
  resolveConcurrency(["VF_TEST_CONCURRENCY_TOTAL", "VF_TEST_TOTAL_CONCURRENCY"]);
const fallbackPerRunner = Math.max(1, Math.floor((totalConcurrency ?? availableCores) / 2));
const autoShards = Math.min(4, Math.max(1, Math.floor(fallbackPerRunner / 2)));

const bunEnv = { ...process.env };
if (!bunEnv.BUN_TEST_CONCURRENCY && !bunEnv.VF_TEST_CONCURRENCY) {
  bunEnv.BUN_TEST_CONCURRENCY = String(fallbackPerRunner);
}
if (!bunEnv.BUN_TEST_SHARDS && !bunEnv.VF_TEST_SHARDS && autoShards > 1) {
  bunEnv.BUN_TEST_SHARDS = String(autoShards);
}
if (profile === "fast" && !bunEnv.VF_TEST_EXCLUDE && !bunEnv.BUN_TEST_EXCLUDE) {
  bunEnv.VF_TEST_EXCLUDE = "tests/integration/**,tests/ai/**,tests/rendering/**";
}
if (profile === "fast" && !bunEnv.VF_TEST_TIME_SCALE) {
  bunEnv.VF_TEST_TIME_SCALE = "0.25";
}

const nodeEnv = { ...process.env };
if (!nodeEnv.NODE_TEST_CONCURRENCY && !nodeEnv.VF_TEST_CONCURRENCY) {
  nodeEnv.NODE_TEST_CONCURRENCY = String(fallbackPerRunner);
}
if (!nodeEnv.NODE_TEST_SHARDS && !nodeEnv.VF_TEST_SHARDS && autoShards > 1) {
  nodeEnv.NODE_TEST_SHARDS = String(autoShards);
}
// Exclude Deno-specific test files that use Deno.test directly
const denoOnlyTests = "src/issues/**,src/cache/backend.test.ts";
if (!nodeEnv.VF_TEST_EXCLUDE && !nodeEnv.NODE_TEST_EXCLUDE) {
  nodeEnv.VF_TEST_EXCLUDE = denoOnlyTests;
} else {
  const existing = nodeEnv.VF_TEST_EXCLUDE || nodeEnv.NODE_TEST_EXCLUDE || "";
  nodeEnv.VF_TEST_EXCLUDE = existing ? `${existing},${denoOnlyTests}` : denoOnlyTests;
}
if (profile === "fast" && !nodeEnv.VF_TEST_EXCLUDE) {
  nodeEnv.VF_TEST_EXCLUDE = `${denoOnlyTests},tests/integration/**,tests/ai/**,tests/rendering/**`;
}
if (profile === "fast" && !nodeEnv.VF_TEST_TIME_SCALE) {
  nodeEnv.VF_TEST_TIME_SCALE = "0.25";
}

const defaultBunArgs = ["tests/"];
const defaultNodeArgs = ["src/**/*.test.ts"];

const effectiveBunArgs = hasExplicitArgs ? bunArgs : defaultBunArgs;
const effectiveNodeArgs = hasExplicitArgs ? nodeArgs : defaultNodeArgs;

const failFast = process.env.VF_TEST_FAIL_FAST === "1";

function spawnRunner(label, command, runnerArgs, env) {
  const child = spawn(command, runnerArgs, { stdio: "inherit", env });
  const promise = new Promise((resolvePromise) => {
    child.on("error", (error) => {
      console.error(`Failed to start ${label} tests:`, error);
      resolvePromise({ label, code: 1 });
    });
    child.on("exit", (code) => {
      resolvePromise({ label, code: code ?? 1 });
    });
  });
  return { child, promise };
}

const bun = spawnRunner("bun", process.execPath, [bunRunner, ...effectiveBunArgs], bunEnv);
const node = spawnRunner("node", process.execPath, [nodeRunner, ...effectiveNodeArgs], nodeEnv);

if (failFast) {
  bun.promise.then((result) => {
    if (result.code !== 0) node.child.kill("SIGTERM");
  }).catch(() => {});
  node.promise.then((result) => {
    if (result.code !== 0) bun.child.kill("SIGTERM");
  }).catch(() => {});
}

const results = await Promise.all([bun.promise, node.promise]);
const failed = results.some((result) => result.code !== 0);
process.exit(failed ? 1 : 0);
