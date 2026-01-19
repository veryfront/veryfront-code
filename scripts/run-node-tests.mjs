#!/usr/bin/env node

import { spawn } from "node:child_process";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { filterTestFiles, listTestFiles, splitIntoShards } from "./test-file-utils.mjs";

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

const scriptDir = dirname(fileURLToPath(import.meta.url));
const resolverPath = resolve(scriptDir, "node-resolver.mjs");

const patterns = process.argv.slice(2);
const concurrency = resolveConcurrency(["VF_TEST_CONCURRENCY", "NODE_TEST_CONCURRENCY"]);
const shardOverride = resolveShardCount(["VF_TEST_SHARDS", "NODE_TEST_SHARDS"]);
const autoShards = concurrency >= 4 ? Math.min(4, Math.floor(concurrency / 2)) : 1;
const shardCount = shardOverride ?? autoShards;
const includePatterns = (process.env.NODE_TEST_INCLUDE || process.env.VF_TEST_INCLUDE || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const excludePatterns = (process.env.NODE_TEST_EXCLUDE || process.env.VF_TEST_EXCLUDE || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const hasFilters = includePatterns.length > 0 || excludePatterns.length > 0;

function buildNodeArgs(files, perShardConcurrency) {
  return [
    "--experimental-transform-types",
    "--import",
    resolverPath,
    "--test",
    "--test-concurrency",
    String(perShardConcurrency),
    ...files,
  ];
}

const env = { ...process.env };
if (!env.VF_DISABLE_LRU_INTERVAL) env.VF_DISABLE_LRU_INTERVAL = "1";
if (!env.NODE_ENV) env.NODE_ENV = "production";
if (!env.LOG_FORMAT) env.LOG_FORMAT = "text";
if (!env.VF_TEST_TIME_SCALE) env.VF_TEST_TIME_SCALE = "0.25";

async function runShardedTests() {
  const filePatterns = patterns.length > 0 ? patterns : ["src/**/*.test.ts"];
  let files = listTestFiles(filePatterns);
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
      const nodeArgs = buildNodeArgs(shardFiles, perShardConcurrency);
      const child = spawn(process.execPath, nodeArgs, { stdio: "inherit", env });
      child.on("error", (error) => {
        console.error("Failed to start node tests:", error);
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

if (shardCount > 1) {
  runShardedTests()
    .then((ok) => {
      if (ok === null) {
        process.exit(0);
        return;
      }
      process.exit(ok ? 0 : 1);
    })
    .catch(() => process.exit(1));
} else {
  const needsExplicitFiles = includePatterns.length > 0 || excludePatterns.length > 0;
  const basePatterns = patterns.length > 0 ? patterns : ["src/**/*.test.ts"];
  const files = needsExplicitFiles
    ? filterTestFiles(listTestFiles(basePatterns), {
      include: includePatterns,
      exclude: excludePatterns,
    })
    : basePatterns;
  if (Array.isArray(files) && files.length === 0) {
    process.exit(0);
  }
  const nodeArgs = buildNodeArgs(Array.isArray(files) ? files : basePatterns, concurrency);
  const child = spawn(process.execPath, nodeArgs, { stdio: "inherit", env });
  child.on("error", (error) => {
    console.error("Failed to start node tests:", error);
    process.exit(1);
  });
  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });
}
