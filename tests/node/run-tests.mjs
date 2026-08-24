#!/usr/bin/env node

import { spawn } from "node:child_process";
import os from "node:os";
import process from "node:process";
import { splitIntoShards } from "../test-file-utils.mjs";
import { ensureNpmNodeModulesLinks } from "../ensure-npm-links.mjs";
import { loadSuitePlan } from "../load-suite-plan.mjs";

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

const rawArgs = process.argv.slice(2);
const suiteArg = rawArgs.find((arg) => arg.startsWith("--suite="));
const suite = suiteArg?.slice("--suite=".length);
if (suite && suite !== "runtime:node") {
  throw new Error(`Unsupported Node suite profile: ${suite}`);
}
const patterns = rawArgs.filter((arg) => arg !== suiteArg);
const concurrency = resolveConcurrency(["VF_TEST_CONCURRENCY", "NODE_TEST_CONCURRENCY"]);
const shardOverride = resolveShardCount(["VF_TEST_SHARDS", "NODE_TEST_SHARDS"]);
const autoShards = concurrency >= 4 ? Math.min(4, Math.floor(concurrency / 2)) : 1;
const shardCount = shardOverride ?? autoShards;
const includePatterns = (process.env.NODE_TEST_INCLUDE || process.env.VF_TEST_INCLUDE || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const envExcludePatterns = (process.env.NODE_TEST_EXCLUDE || process.env.VF_TEST_EXCLUDE || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function selectedTestFiles() {
  const files = loadSuitePlan({
    suite: suite ?? "runtime:node",
    patterns,
    include: includePatterns,
    exclude: envExcludePatterns,
  });
  if (files.length === 0) {
    console.error("Node test runner selected no test files for the active filters.");
    process.exit(1);
  }
  return files;
}

function buildNodeArgs(files, perShardConcurrency) {
  return [
    "--import",
    "./tests/node/resolver.mjs",
    "--test",
    "--test-concurrency",
    String(perShardConcurrency),
    ...files,
  ];
}

const env = { ...process.env };
// Match the Deno test tasks' explicit host-test contract. This keeps guarded
// outbound consumers on deterministic injected transports in Node tests while
// production processes, which never run through this harness, remain pinned.
env.DENO_TESTING = "1";
if (!env.VF_DISABLE_LRU_INTERVAL) env.VF_DISABLE_LRU_INTERVAL = "1";
if (!env.NODE_ENV) env.NODE_ENV = "production";
if (!env.LOG_FORMAT) env.LOG_FORMAT = "text";
// Don't scale time by default - many tests have timing-sensitive operations
if (!env.VF_TEST_TIME_SCALE) env.VF_TEST_TIME_SCALE = "1";
for (
  const key of [
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_BASE_URL",
    "GOOGLE_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "GOOGLE_GEMINI_BASE_URL",
    "VERYFRONT_API_TOKEN",
    "VERYFRONT_API_BASE_URL",
    "VERYFRONT_API_URL",
    "VERYFRONT_PROJECT_SLUG",
    "AG_UI_EVAL_PROJECT_SLUG",
    "TENANT_PROJECT_SLUG",
    "MISTRAL_API_KEY",
    "MISTRAL_BASE_URL",
    "GROQ_API_KEY",
    "GROQ_BASE_URL",
    "DEEPSEEK_API_KEY",
    "DEEPSEEK_BASE_URL",
    "OPENROUTER_API_KEY",
    "OPENROUTER_BASE_URL",
  ]
) {
  delete env[key];
}

async function runShardedTests() {
  const files = selectedTestFiles();
  ensureNpmNodeModulesLinks();

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
      process.exit(ok ? 0 : 1);
    })
    .catch((error) => {
      console.error("Node test runner failed:", error);
      process.exit(1);
    });
} else {
  const runtimeFiles = selectedTestFiles();
  ensureNpmNodeModulesLinks();
  const nodeArgs = buildNodeArgs(runtimeFiles, concurrency);
  const child = spawn(process.execPath, nodeArgs, { stdio: "inherit", env });
  child.on("error", (error) => {
    console.error("Failed to start node tests:", error);
    process.exit(1);
  });
  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });
}
