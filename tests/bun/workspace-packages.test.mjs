import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { isDirectoryPathConflict, prepareBunWorkspacePackages } from "./workspace-packages.mjs";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const workspacePackagesModuleUrl = new URL("./workspace-packages.mjs", import.meta.url).href;
const PREPARATION_ACTIVE_EXIT_CODE = 17;
const PREPARATION_PUBLISH_INTERRUPTED_EXIT_CODE = 18;
const LOCK_STAGING_PREFIX = ".veryfront-bun-workspace-packages.lock.staging-";
const RECLAIMER_GUARD_PREFIX = ".veryfront-bun-workspace-packages.reclaiming-";
const RECLAIM_BARRIER_PREFIX = ".veryfront-bun-workspace-packages.barrier-";

test("directory conflicts include Windows access errors for existing paths", () => {
  const guardPath = reclaimerGuardPath(randomUUID());
  mkdirSync(guardPath, { recursive: true });

  try {
    assert.equal(isDirectoryPathConflict({ code: "EPERM" }, guardPath), true);
    assert.equal(isDirectoryPathConflict({ code: "EACCES" }, guardPath), true);
    assert.equal(isDirectoryPathConflict({ code: "EINVAL" }, guardPath), false);
  } finally {
    rmSync(guardPath, { recursive: true, force: true });
  }

  assert.equal(isDirectoryPathConflict({ code: "EPERM" }, guardPath), false);
});

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function staleLockPath() {
  return join(
    projectRoot,
    "node_modules",
    ".veryfront-bun-workspace-packages.lock",
  );
}

function reclaimerGuardPath(token) {
  const digest = createHash("sha256").update(token).digest("hex");
  return join(projectRoot, "node_modules", `${RECLAIMER_GUARD_PREFIX}${digest}`);
}

function writeOwnedLockMarker(directoryPath, token, pid = 9_999_999) {
  writeFileSync(
    join(directoryPath, ".veryfront-bun-workspace-package.json"),
    `${JSON.stringify({ owner: "veryfront-bun-tests", pid, token })}\n`,
  );
}

function writeStaleLock(lockPath, token = "stale") {
  rmSync(lockPath, { recursive: true, force: true });
  mkdirSync(lockPath, { recursive: true });
  writeOwnedLockMarker(lockPath, token);
}

function runWorkspacePreparationChild(extraEnv = {}) {
  const source = `
    import { setTimeout } from "node:timers/promises";
    import { prepareBunWorkspacePackages } from ${JSON.stringify(workspacePackagesModuleUrl)};

    try {
      const prepared = prepareBunWorkspacePackages(${JSON.stringify(projectRoot)});
      await setTimeout(Number(process.env.VF_BUN_WORKSPACE_HOLD_MS ?? 0));
      prepared.cleanup();
      process.exit(0);
    } catch (error) {
      if (error?.message === "Bun workspace package preparation is already active") {
        process.exit(${PREPARATION_ACTIVE_EXIT_CODE});
      }
      console.error(error);
      process.exit(1);
    }
  `;
  const evalArgs = process.versions.deno
    ? ["eval", source]
    : ["--input-type=module", "--eval", source];

  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, evalArgs, {
      env: {
        ...process.env,
        VF_BUN_WORKSPACE_HOLD_MS: "500",
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      resolvePromise({
        code: 1,
        stdout: Buffer.concat(stdout).toString(),
        stderr: `${Buffer.concat(stderr).toString()}${error.stack ?? error.message}`,
      });
    });
    child.on("close", (code) => {
      resolvePromise({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
      });
    });
  });
}

function stagingLockPaths() {
  const nodeModulesPath = join(projectRoot, "node_modules");
  return readdirSync(nodeModulesPath)
    .filter((name) => name.startsWith(LOCK_STAGING_PREFIX))
    .map((name) => join(nodeModulesPath, name));
}

async function waitForReclaimerArrivals(barrierPath, expectedCount) {
  const deadline = Date.now() + 10_000;
  while (
    readdirSync(barrierPath).filter((name) => name.startsWith("ready-")).length < expectedCount
  ) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for Bun workspace reclaimers");
    }
    await delay(10);
  }
}

function releaseReclaimers(barrierPath) {
  try {
    writeFileSync(join(barrierPath, "release"), "release\n", { flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
}

test("prepareBunWorkspacePackages derives native packages from every workspace export", () => {
  const prepared = prepareBunWorkspacePackages(projectRoot);
  const generatedPackageRoots = [];

  try {
    const rootConfig = readJson(resolve(projectRoot, "deno.json"));
    const rootPackage = readJson(
      join(prepared.nodeModulesPath, "veryfront/package.json"),
    );
    assert.equal(
      rootPackage.exports["./platform/path"],
      "./source/src/platform/compat/path/index.ts",
    );
    assert.equal(
      rootPackage.exports["./transforms/frontmatter"],
      "./source/src/transforms/mdx/compiler/frontmatter-extractor.ts",
    );
    const publishedWorkspaces = rootConfig.workspace.filter(
      (workspaceDirectory) => {
        const config = readJson(
          resolve(projectRoot, workspaceDirectory, "deno.json"),
        );
        return typeof config.name === "string" && config.exports !== undefined;
      },
    );
    assert.ok(publishedWorkspaces.length > 0);

    for (const workspaceDirectory of publishedWorkspaces) {
      const workspaceRoot = resolve(projectRoot, workspaceDirectory);
      const sourceConfig = readJson(resolve(workspaceRoot, "deno.json"));
      const packageRoot = join(
        prepared.nodeModulesPath,
        ...sourceConfig.name.split("/"),
      );
      generatedPackageRoots.push(packageRoot);
      const packageConfig = readJson(join(packageRoot, "package.json"));

      assert.equal(packageConfig.name, sourceConfig.name);
      assert.equal(
        realpathSync(join(packageRoot, "source")),
        realpathSync(workspaceRoot),
      );
      if (typeof sourceConfig.exports === "string") {
        assert.equal(
          packageConfig.exports,
          `./source/${sourceConfig.exports.slice(2)}`,
        );
      } else {
        for (const [subpath, target] of Object.entries(sourceConfig.exports)) {
          assert.equal(
            packageConfig.exports[subpath],
            `./source/${target.slice(2)}`,
          );
        }
      }
    }
  } finally {
    prepared.cleanup();
  }

  for (const packageRoot of generatedPackageRoots) {
    assert.equal(existsSync(packageRoot), false);
  }
  assert.equal(existsSync(join(prepared.nodeModulesPath, "veryfront")), false);
  assert.equal(existsSync(join(prepared.nodeModulesPath, "react")), true);
});

test("workspace package cleanup is idempotent", () => {
  const prepared = prepareBunWorkspacePackages(projectRoot);
  prepared.cleanup();
  prepared.cleanup();
  assert.equal(
    existsSync(join(prepared.nodeModulesPath, "@veryfront/ext-schema-zod")),
    false,
  );
  assert.equal(existsSync(join(prepared.nodeModulesPath, "react")), true);
});

test("workspace package preparation rejects an overlapping run without disturbing it", () => {
  const prepared = prepareBunWorkspacePackages(projectRoot);
  const rootPackagePath = join(
    prepared.nodeModulesPath,
    "veryfront/package.json",
  );

  try {
    assert.throws(
      () => prepareBunWorkspacePackages(projectRoot),
      new Error("Bun workspace package preparation is already active"),
    );
    assert.equal(existsSync(rootPackagePath), true);
  } finally {
    prepared.cleanup();
  }

  assert.equal(existsSync(rootPackagePath), false);
});

test("workspace package preparation survives interrupted lock publication", async () => {
  const lockPath = staleLockPath();
  rmSync(lockPath, { recursive: true, force: true });
  for (const path of stagingLockPaths()) {
    rmSync(path, { recursive: true, force: true });
  }

  try {
    const result = await runWorkspacePreparationChild({
      VF_BUN_WORKSPACE_HOLD_MS: "0",
      VF_BUN_WORKSPACE_INTERRUPT_BEFORE_LOCK_PUBLISH: "1",
    });

    assert.equal(result.code, PREPARATION_PUBLISH_INTERRUPTED_EXIT_CODE);
    assert.equal(existsSync(lockPath), false);
    assert.equal(stagingLockPaths().length, 1);

    const prepared = prepareBunWorkspacePackages(projectRoot);
    prepared.cleanup();
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
    for (const path of stagingLockPaths()) {
      rmSync(path, { recursive: true, force: true });
    }
  }
});

test("workspace package preparation reclaims a stale lock with a dead owner", () => {
  const lockPath = staleLockPath();
  const staleToken = "single-stale-generation";
  const guardPath = reclaimerGuardPath(staleToken);
  rmSync(guardPath, { recursive: true, force: true });
  writeStaleLock(lockPath, staleToken);

  const prepared = prepareBunWorkspacePackages(projectRoot);
  let guardExistsAfterCleanup = false;
  try {
    assert.equal(
      existsSync(join(prepared.nodeModulesPath, "veryfront/package.json")),
      true,
    );
  } finally {
    prepared.cleanup();
    guardExistsAfterCleanup = existsSync(guardPath);
    rmSync(guardPath, { recursive: true, force: true });
  }

  assert.equal(guardExistsAfterCleanup, true);
});

test("workspace package preparation serializes concurrent stale-lock reclaimers", async () => {
  const lockPath = staleLockPath();
  const staleToken = "raced-stale-generation";
  const guardPath = reclaimerGuardPath(staleToken);
  const barrierPath = join(
    projectRoot,
    "node_modules",
    `${RECLAIM_BARRIER_PREFIX}${randomUUID()}`,
  );
  rmSync(guardPath, { recursive: true, force: true });
  mkdirSync(barrierPath, { recursive: true });
  writeStaleLock(lockPath, staleToken);
  const children = [
    runWorkspacePreparationChild({
      VF_BUN_WORKSPACE_RECLAIM_BARRIER_PATH: barrierPath,
    }),
    runWorkspacePreparationChild({
      VF_BUN_WORKSPACE_RECLAIM_BARRIER_PATH: barrierPath,
    }),
  ];

  try {
    await waitForReclaimerArrivals(barrierPath, children.length);
    releaseReclaimers(barrierPath);
    const results = await Promise.all(children);
    const exitCodes = results.map((result) => result.code).sort((a, b) => a - b);

    assert.deepEqual(
      exitCodes,
      [0, PREPARATION_ACTIVE_EXIT_CODE],
      JSON.stringify(results, null, 2),
    );
    assert.equal(existsSync(lockPath), false);
    assert.equal(existsSync(guardPath), true);
    assert.equal(
      existsSync(join(projectRoot, "node_modules", "veryfront/package.json")),
      false,
    );
  } finally {
    releaseReclaimers(barrierPath);
    await Promise.allSettled(children);
    rmSync(lockPath, { recursive: true, force: true });
    rmSync(guardPath, { recursive: true, force: true });
    rmSync(barrierPath, { recursive: true, force: true });
  }
});

test("workspace package preparation ignores an orphaned stale-generation guard", () => {
  const lockPath = staleLockPath();
  const orphanGuardPath = reclaimerGuardPath("orphaned-generation");
  const reclaimedGuardPath = reclaimerGuardPath("new-stale-generation");
  rmSync(lockPath, { recursive: true, force: true });
  rmSync(orphanGuardPath, { recursive: true, force: true });
  rmSync(reclaimedGuardPath, { recursive: true, force: true });
  mkdirSync(orphanGuardPath, { recursive: true });
  writeOwnedLockMarker(orphanGuardPath, "orphaned-generation");
  writeStaleLock(lockPath, "new-stale-generation");

  const prepared = prepareBunWorkspacePackages(projectRoot);
  let reclaimedExistsAfterCleanup = false;
  try {
    assert.equal(existsSync(orphanGuardPath), true);
    assert.equal(existsSync(reclaimedGuardPath), true);
    assert.equal(
      existsSync(join(prepared.nodeModulesPath, "veryfront/package.json")),
      true,
    );
  } finally {
    prepared.cleanup();
    reclaimedExistsAfterCleanup = existsSync(reclaimedGuardPath);
    rmSync(orphanGuardPath, { recursive: true, force: true });
    rmSync(reclaimedGuardPath, { recursive: true, force: true });
    rmSync(lockPath, { recursive: true, force: true });
  }

  assert.equal(existsSync(lockPath), false);
  assert.equal(reclaimedExistsAfterCleanup, true);
});

test("workspace package preparation preserves a live lock owner", () => {
  const lockPath = join(
    projectRoot,
    "node_modules",
    ".veryfront-bun-workspace-packages.lock",
  );
  rmSync(lockPath, { recursive: true, force: true });
  mkdirSync(lockPath, { recursive: true });
  writeFileSync(
    join(lockPath, ".veryfront-bun-workspace-package.json"),
    `${JSON.stringify({ owner: "veryfront-bun-tests", pid: process.pid, token: "active" })}\n`,
  );

  try {
    assert.throws(
      () => prepareBunWorkspacePackages(projectRoot),
      new Error("Bun workspace package preparation is already active"),
    );
    assert.equal(existsSync(lockPath), true);
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
});

test("workspace package preparation preserves a lock with a missing marker", () => {
  const lockPath = join(
    projectRoot,
    "node_modules",
    ".veryfront-bun-workspace-packages.lock",
  );
  rmSync(lockPath, { recursive: true, force: true });
  mkdirSync(lockPath, { recursive: true });

  try {
    assert.throws(
      () => prepareBunWorkspacePackages(projectRoot),
      new Error("Bun workspace package preparation is already active"),
    );
    assert.equal(existsSync(lockPath), true);
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
});

test("workspace package preparation preserves an invalid owned lock marker", () => {
  const lockPath = join(
    projectRoot,
    "node_modules",
    ".veryfront-bun-workspace-packages.lock",
  );
  rmSync(lockPath, { recursive: true, force: true });
  mkdirSync(lockPath, { recursive: true });
  writeFileSync(
    join(lockPath, ".veryfront-bun-workspace-package.json"),
    `${JSON.stringify({ owner: "veryfront-bun-tests", pid: 0, token: "invalid" })}\n`,
  );

  try {
    assert.throws(
      () => prepareBunWorkspacePackages(projectRoot),
      new Error("Bun workspace package preparation is already active"),
    );
    assert.equal(existsSync(lockPath), true);
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
});

test("workspace package preparation preserves a foreign lock owner", () => {
  const lockPath = join(
    projectRoot,
    "node_modules",
    ".veryfront-bun-workspace-packages.lock",
  );
  rmSync(lockPath, { recursive: true, force: true });
  mkdirSync(lockPath, { recursive: true });
  writeFileSync(
    join(lockPath, ".veryfront-bun-workspace-package.json"),
    `${JSON.stringify({ owner: "external-owner", pid: 9_999_999, token: "external" })}\n`,
  );

  try {
    assert.throws(
      () => prepareBunWorkspacePackages(projectRoot),
      new Error("Bun workspace package preparation is already active"),
    );
    assert.equal(existsSync(lockPath), true);
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
});
