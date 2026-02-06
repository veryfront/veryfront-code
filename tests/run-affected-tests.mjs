#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { listTestFiles } from "./test-file-utils.mjs";

const TEST_FILE_RE = /\.test\.[cm]?[jt]sx?$/i;

function toPosixPath(path) {
  return path.split(sep).join("/");
}

function runGit(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.error || result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseStatusLines(lines) {
  const files = new Set();
  for (const line of lines) {
    if (line.length < 4) continue;
    const pathPart = line.slice(3).trim();
    if (!pathPart) continue;
    const resolved = pathPart.includes("->")
      ? pathPart.split("->").pop()?.trim()
      : pathPart;
    if (resolved) files.add(resolved);
  }
  return Array.from(files);
}

function getRepoRoot() {
  const output = runGit(["rev-parse", "--show-toplevel"]);
  return output[0] || process.cwd();
}

function getChangedFiles(baseRef) {
  const statusFiles = parseStatusLines(runGit(["status", "--porcelain"]));
  if (statusFiles.length > 0) return statusFiles;

  if (!baseRef) return [];
  return runGit(["diff", "--name-only", `${baseRef}...HEAD`]);
}

function expandDirTests(dir, cwd) {
  try {
    return listTestFiles([dir], cwd);
  } catch {
    return [];
  }
}

function findSiblingTests(file, cwd) {
  const matches = [];
  if (TEST_FILE_RE.test(file)) {
    matches.push(file);
    return matches;
  }

  const extMatch = file.match(/\.[cm]?[jt]sx?$/i);
  if (extMatch) {
    const base = file.slice(0, -extMatch[0].length);
    const candidates = [
      `${base}.test${extMatch[0]}`,
      `${base}.spec${extMatch[0]}`,
    ];
    for (const candidate of candidates) {
      const fullPath = resolve(cwd, candidate);
      if (existsSync(fullPath)) {
        matches.push(candidate);
      }
    }
  }
  return matches;
}

function categorizeTests(files, cwd) {
  const bunTargets = new Set();
  const nodeTargets = new Set();

  for (const file of files) {
    const rel = toPosixPath(file.startsWith(cwd) ? file.slice(cwd.length + 1) : file);
    if (rel.startsWith("src/")) {
      nodeTargets.add(rel);
    } else if (rel.startsWith("tests/") || rel.startsWith("proxy/")) {
      bunTargets.add(rel);
    } else if (rel.startsWith("scripts/") || rel.startsWith(".github/") || rel === "package.json") {
      // leave to smoke fallback
    } else {
      // Default to node for other src-adjacent changes, bun for tests
      if (rel.includes("src/")) nodeTargets.add(rel);
    }
  }

  return {
    bun: Array.from(bunTargets),
    node: Array.from(nodeTargets),
  };
}

function resolveConcurrency(available, split) {
  if (split) return Math.max(1, Math.floor(available / 2));
  return Math.max(1, available);
}

function resolveShards(concurrency) {
  return Math.min(4, Math.max(1, Math.floor(concurrency / 2)));
}

function spawnRunner(label, runnerPath, args, env) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [runnerPath, ...args], { stdio: "inherit", env });
    child.on("error", (error) => {
      console.error(`Failed to start ${label} tests:`, error);
      resolvePromise(1);
    });
    child.on("exit", (code) => resolvePromise(code ?? 1));
  });
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const bunRunner = resolve(scriptDir, "bun", "run-tests.mjs");
const nodeRunner = resolve(scriptDir, "node", "run-tests.mjs");

const baseFlagIndex = process.argv.findIndex((arg) => arg === "--base");
const baseRef = baseFlagIndex >= 0 ? process.argv[baseFlagIndex + 1] : null;
const base = baseRef || process.env.VF_TEST_BASE || "HEAD";

const cwd = getRepoRoot();
process.chdir(cwd);

const changedFiles = getChangedFiles(base);
if (changedFiles.length === 0) {
  const child = spawn(process.execPath, [resolve(scriptDir, "run-concurrent-tests.mjs"), "--fast"], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => process.exit(code ?? 1));
  return;
}

const testCandidates = new Set();
for (const file of changedFiles) {
  if (TEST_FILE_RE.test(file)) {
    testCandidates.add(file);
    continue;
  }

  const siblingTests = findSiblingTests(file, cwd);
  for (const testFile of siblingTests) testCandidates.add(testFile);

  const dirTests = expandDirTests(dirname(resolve(cwd, file)), cwd);
  for (const testFile of dirTests) testCandidates.add(testFile);
}

const selectedTests = Array.from(testCandidates).map((file) => toPosixPath(file));
if (selectedTests.length === 0) {
  const child = spawn(process.execPath, [resolve(scriptDir, "run-concurrent-tests.mjs"), "--fast"], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => process.exit(code ?? 1));
  return;
}

const { bun, node } = categorizeTests(selectedTests, cwd);

const availableCores = typeof os.availableParallelism === "function"
  ? os.availableParallelism()
  : os.cpus().length;
const split = bun.length > 0 && node.length > 0;
const perRunnerConcurrency = resolveConcurrency(availableCores, split);

const bunEnv = { ...process.env };
if (bun.length > 0) {
  if (!bunEnv.BUN_TEST_CONCURRENCY && !bunEnv.VF_TEST_CONCURRENCY) {
    bunEnv.BUN_TEST_CONCURRENCY = String(perRunnerConcurrency);
  }
  if (!bunEnv.BUN_TEST_SHARDS && !bunEnv.VF_TEST_SHARDS) {
    bunEnv.BUN_TEST_SHARDS = String(resolveShards(perRunnerConcurrency));
  }
  if (!bunEnv.VF_TEST_TIME_SCALE) {
    bunEnv.VF_TEST_TIME_SCALE = "0.25";
  }
}

const nodeEnv = { ...process.env };
if (node.length > 0) {
  if (!nodeEnv.NODE_TEST_CONCURRENCY && !nodeEnv.VF_TEST_CONCURRENCY) {
    nodeEnv.NODE_TEST_CONCURRENCY = String(perRunnerConcurrency);
  }
  if (!nodeEnv.NODE_TEST_SHARDS && !nodeEnv.VF_TEST_SHARDS) {
    nodeEnv.NODE_TEST_SHARDS = String(resolveShards(perRunnerConcurrency));
  }
  if (!nodeEnv.VF_TEST_TIME_SCALE) {
    nodeEnv.VF_TEST_TIME_SCALE = "0.25";
  }
}

const runners = [];
if (bun.length > 0) runners.push(spawnRunner("bun", bunRunner, bun, bunEnv));
if (node.length > 0) runners.push(spawnRunner("node", nodeRunner, node, nodeEnv));

if (runners.length === 0) {
  const child = spawn(process.execPath, [resolve(scriptDir, "run-concurrent-tests.mjs"), "--fast"], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => process.exit(code ?? 1));
  return;
}

Promise.all(runners).then((results) => {
  process.exit(results.every((code) => code === 0) ? 0 : 1);
});
