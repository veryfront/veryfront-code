#!/usr/bin/env node

import { spawn } from "node:child_process";
import os from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ensureNpmNodeModulesLinks } from "../ensure-npm-links.mjs";
import { loadSuitePlan } from "../load-suite-plan.mjs";
import { buildIsolatedBunTestRuns, registerBunWorkspaceCleanup } from "./runner-args.mjs";
import { prepareBunWorkspacePackages } from "./workspace-packages.mjs";

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
if (suite && suite !== "runtime:bun") {
  throw new Error(`Unsupported Bun suite profile: ${suite}`);
}
const args = rawArgs.filter((arg) => arg !== suiteArg);
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const concurrency = resolveConcurrency([
  "VF_TEST_CONCURRENCY",
  "BUN_TEST_CONCURRENCY",
]);
const shardOverride = resolveShardCount(["VF_TEST_SHARDS", "BUN_TEST_SHARDS"]);
const processCount = shardOverride ?? Math.max(1, Math.min(4, concurrency));
const includePatterns = (
  process.env.BUN_TEST_INCLUDE ||
  process.env.VF_TEST_INCLUDE ||
  ""
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const envExcludePatterns = (
  process.env.BUN_TEST_EXCLUDE ||
  process.env.VF_TEST_EXCLUDE ||
  ""
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
function selectedTestFiles() {
  return loadSuitePlan({
    suite: suite ?? "runtime:bun",
    patterns: args,
    include: includePatterns,
    exclude: envExcludePatterns,
  });
}

function runBunProcess(file, bunArgs) {
  return new Promise((resolvePromise) => {
    const child = spawn("bun", bunArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    const stdout = [];
    const stderr = [];
    let settled = false;
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));

    function finish(code, startError) {
      if (settled) return;
      settled = true;
      if (code !== 0) {
        console.error(`\nBun test file failed: ${file}`);
        if (startError) console.error(startError);
        for (const chunk of stdout) process.stdout.write(chunk);
        for (const chunk of stderr) process.stderr.write(chunk);
      }
      resolvePromise(code);
    }

    child.on("error", (error) => finish(1, `Failed to start Bun tests: ${error.message}`));
    child.on("close", (code) => finish(code ?? 1));
  });
}

async function runIsolatedTests(files) {
  if (files.length === 0) {
    console.error("Bun test runner selected no test files.");
    return false;
  }
  const runs = buildIsolatedBunTestRuns(files);
  let nextIndex = 0;
  let passed = 0;
  const failed = [];

  async function worker() {
    while (nextIndex < runs.length) {
      const index = nextIndex++;
      const code = await runBunProcess(files[index], runs[index]);
      if (code === 0) passed += 1;
      else failed.push(files[index]);
    }
  }

  const workers = Array.from(
    { length: Math.min(processCount, runs.length) },
    () => worker(),
  );
  await Promise.all(workers);
  console.log(`Bun test files: ${passed} passed, ${failed.length} failed`);
  return failed.length === 0;
}

const env = { ...process.env };
env.DENO_TESTING = "1";
// Bun's runtime transpiler cache is global across worktrees. Cached source maps
// can carry another checkout's tsconfig paths into this isolated test process.
env.BUN_RUNTIME_TRANSPILER_CACHE_PATH = "0";
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
    "CONTEXT7_API_KEY",
  ]
) {
  delete env[key];
}

async function main() {
  const files = selectedTestFiles();
  ensureNpmNodeModulesLinks();
  const bunWorkspacePackages = prepareBunWorkspacePackages(projectRoot);
  registerBunWorkspaceCleanup(() => bunWorkspacePackages.cleanup());
  return await runIsolatedTests(files);
}

main()
  .then((ok) => {
    process.exitCode = ok ? 0 : 1;
  })
  .catch((error) => {
    console.error("Bun test runner failed:", error);
    process.exitCode = 1;
  });
