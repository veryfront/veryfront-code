#!/usr/bin/env node

import { spawn } from "node:child_process";
import os from "node:os";
import { filterTestFiles, listTestFiles, splitIntoShards } from "../test-file-utils.mjs";

function resolveConcurrency(envKeys) {
  for (const key of envKeys) {
    const raw = process.env[key];
    if (!raw) continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  const available = typeof os.availableParallelism === "function"
    ? os.availableParallelism()
    : os.cpus().length;
  return Math.max(1, Math.floor(available));
}

function resolveShardCount(envKeys) {
  for (const key of envKeys) {
    const raw = process.env[key];
    if (!raw) continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.floor(parsed);
    }
  }
  return null;
}

const args = process.argv.slice(2);
const concurrency = resolveConcurrency(["VF_TEST_CONCURRENCY", "BUN_TEST_CONCURRENCY"]);
const shardOverride = resolveShardCount(["VF_TEST_SHARDS", "BUN_TEST_SHARDS"]);
const autoShards = concurrency >= 4 ? Math.min(4, Math.floor(concurrency / 2)) : 1;
const shardCount = shardOverride ?? autoShards;
const defaultRoots = ["src", "tests", "proxy"];
const includePatterns = (process.env.BUN_TEST_INCLUDE || process.env.VF_TEST_INCLUDE || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const excludePatterns = (process.env.BUN_TEST_EXCLUDE || process.env.VF_TEST_EXCLUDE || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const hasFilters = includePatterns.length > 0 || excludePatterns.length > 0;

function buildArgsForShard(files, perShardConcurrency) {
  return [
    "test",
    "--concurrency",
    String(perShardConcurrency),
    ...files,
  ];
}

async function runShardedTests() {
  const patterns = args.length > 0 ? args : defaultRoots;
  let files = listTestFiles(patterns);
  if (hasFilters) {
    files = filterTestFiles(files, { include: includePatterns, exclude: excludePatterns });
  }
  if (files.length === 0) {
    return hasFilters ? true : null;
  }

  const shards = splitIntoShards(files, shardCount);
  const perShardConcurrency = Math.max(1, Math.floor(concurrency / shards.length));

  const runs = shards.map((shardFiles) =>
    new Promise((resolvePromise) => {
      const bunArgs = buildArgsForShard(shardFiles, perShardConcurrency);
      const child = spawn("bun", bunArgs, { stdio: "inherit", env });
      child.on("error", (error) => {
        console.error("Failed to start bun tests:", error);
        resolvePromise(1);
      });
      child.on("exit", (code) => {
        resolvePromise(code ?? 1);
      });
    })
  );

  const results = await Promise.all(runs);
  return results.every((code) => code === 0);
}

const bunArgs = [
  "test",
  "--concurrency",
  String(concurrency),
  ...args,
];

const env = { ...process.env };
if (!env.VF_DISABLE_LRU_INTERVAL) env.VF_DISABLE_LRU_INTERVAL = "1";
if (!env.NODE_ENV) env.NODE_ENV = "production";
if (!env.LOG_FORMAT) env.LOG_FORMAT = "text";
// Don't scale time by default - many tests have timing-sensitive operations
if (!env.VF_TEST_TIME_SCALE) env.VF_TEST_TIME_SCALE = "1";

function runSingleProcess(explicitFiles) {
  if (explicitFiles && explicitFiles.length === 0) {
    process.exit(0);
  }
  const resolvedArgs = explicitFiles && explicitFiles.length > 0
    ? [
      "test",
      "--concurrency",
      String(concurrency),
      ...explicitFiles,
    ]
    : bunArgs;
  const child = spawn("bun", resolvedArgs, { stdio: "inherit", env });
  child.on("error", (error) => {
    console.error("Failed to start bun tests:", error);
    process.exit(1);
  });
  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });
}

if (shardCount > 1) {
  runShardedTests()
    .then((ok) => {
      if (ok === null) {
        runSingleProcess();
        return;
      }
      process.exit(ok ? 0 : 1);
    })
    .catch(() => runSingleProcess());
} else {
  const needsExplicitFiles = includePatterns.length > 0 || excludePatterns.length > 0;
  if (needsExplicitFiles) {
    const patterns = args.length > 0 ? args : defaultRoots;
    let files = listTestFiles(patterns);
    files = filterTestFiles(files, { include: includePatterns, exclude: excludePatterns });
    runSingleProcess(files);
  } else {
    runSingleProcess();
  }
}
