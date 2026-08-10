import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { prepareBunWorkspacePackages } from "./workspace-packages.mjs";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const workspacePackagesModuleUrl = new URL("./workspace-packages.mjs", import.meta.url).href;
const PREPARATION_ACTIVE_EXIT_CODE = 17;
const RECLAIMER_GUARD_PREFIX = ".veryfront-bun-workspace-packages.reclaiming-";

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

function runWorkspacePreparationChild() {
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
        VF_BUN_WORKSPACE_RECLAIM_PAUSE_MS: "100",
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
  rmSync(guardPath, { recursive: true, force: true });
  writeStaleLock(lockPath, staleToken);

  try {
    const results = await Promise.all([
      runWorkspacePreparationChild(),
      runWorkspacePreparationChild(),
    ]);
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
    rmSync(lockPath, { recursive: true, force: true });
    rmSync(guardPath, { recursive: true, force: true });
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
