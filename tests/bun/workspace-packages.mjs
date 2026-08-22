import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { ensureDirectoryLink } from "../ensure-npm-links.mjs";

const MARKER_NAME = ".veryfront-bun-workspace-package.json";
const LOCK_NAME = ".veryfront-bun-workspace-packages.lock";
const RECLAIMER_GUARD_PREFIX = ".veryfront-bun-workspace-packages.reclaiming-";
const LOCK_OWNER = "veryfront-bun-tests";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function activePreparationError() {
  return new Error("Bun workspace package preparation is already active");
}

function waitForReclaimRaceTestBarrier() {
  const barrierPath = process.env.VF_BUN_WORKSPACE_RECLAIM_BARRIER_PATH;
  if (!barrierPath) return;
  mkdirSync(barrierPath, { recursive: true });
  writeFileSync(
    join(barrierPath, `ready-${process.pid}-${randomUUID()}`),
    "ready\n",
    { flag: "wx" },
  );
  const releasePath = join(barrierPath, "release");
  const deadline = Date.now() + 10_000;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  while (!existsSync(releasePath)) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for the Bun workspace reclaim barrier");
    }
    Atomics.wait(signal, 0, 0, 10);
  }
}

function reclaimerGuardPath(nodeModulesPath, token) {
  const digest = createHash("sha256").update(token).digest("hex");
  return join(nodeModulesPath, `${RECLAIMER_GUARD_PREFIX}${digest}`);
}

function createPreparationLock(nodeModulesPath, lockPath, token) {
  const stagingPath = join(
    nodeModulesPath,
    `${LOCK_NAME}.staging-${process.pid}-${token}`,
  );
  try {
    mkdirSync(stagingPath);
    writeFileSync(
      join(stagingPath, MARKER_NAME),
      `${JSON.stringify({ owner: LOCK_OWNER, pid: process.pid, token })}\n`,
    );
    if (process.env.VF_BUN_WORKSPACE_INTERRUPT_BEFORE_LOCK_PUBLISH === "1") {
      process.exit(18);
    }
    if (existsSync(lockPath)) {
      const conflict = new Error("Bun workspace package lock already exists");
      conflict.code = "EEXIST";
      throw conflict;
    }
    renameSync(stagingPath, lockPath);
  } catch (error) {
    rmSync(stagingPath, { recursive: true, force: true });
    throw error;
  }
}

export function isDirectoryPathConflict(error, path) {
  return existsSync(path) &&
    ["EACCES", "EEXIST", "ENOTEMPTY", "EPERM"].includes(error?.code);
}

function acquirePreparationLock(nodeModulesPath) {
  mkdirSync(nodeModulesPath, { recursive: true });
  const lockPath = join(nodeModulesPath, LOCK_NAME);
  const token = randomUUID();
  let reclaimedGuardPath;
  try {
    createPreparationLock(nodeModulesPath, lockPath, token);
  } catch (error) {
    if (isDirectoryPathConflict(error, lockPath)) {
      reclaimedGuardPath = reclaimStalePreparationLock(
        nodeModulesPath,
        lockPath,
      );
      if (!reclaimedGuardPath) {
        throw activePreparationError();
      }
      try {
        createPreparationLock(nodeModulesPath, lockPath, token);
      } catch (retryError) {
        if (isDirectoryPathConflict(retryError, lockPath)) {
          // This generation tombstone must remain permanent. Otherwise an
          // arbitrarily delayed stale-generation reader could reuse it after a
          // fresh runner acquires lockPath and move that fresh live lock.
          throw activePreparationError();
        }
        throw retryError;
      }
    } else {
      throw error;
    }
  }

  return { lockPath, token };
}

function isOwnedLockMarker(marker) {
  return marker?.owner === LOCK_OWNER &&
    Number.isSafeInteger(marker.pid) &&
    marker.pid >= 1 &&
    typeof marker.token === "string" &&
    marker.token.length > 0;
}

function sameLockGeneration(left, right) {
  return left?.owner === right?.owner &&
    left?.pid === right?.pid &&
    left?.token === right?.token;
}

function reclaimStalePreparationLock(
  nodeModulesPath,
  lockPath,
  runtimeProcess = process,
) {
  let marker;
  try {
    marker = readJson(join(lockPath, MARKER_NAME));
  } catch {
    return false;
  }

  if (!isOwnedLockMarker(marker)) {
    return false;
  }
  try {
    runtimeProcess.kill(marker.pid, 0);
    return false;
  } catch (error) {
    if (error?.code !== "ESRCH") return false;
    waitForReclaimRaceTestBarrier();
    const guardPath = reclaimerGuardPath(nodeModulesPath, marker.token);
    try {
      renameSync(lockPath, guardPath);
    } catch (renameError) {
      if (
        renameError?.code === "ENOENT" ||
        isDirectoryPathConflict(renameError, guardPath)
      ) {
        return false;
      }
      throw renameError;
    }

    let claimedMarker;
    try {
      claimedMarker = readJson(join(guardPath, MARKER_NAME));
    } catch {
      return false;
    }
    if (!sameLockGeneration(marker, claimedMarker)) {
      return false;
    }
    // Lock markers are immutable after publication. Matching the generation
    // after the atomic rename proves this process claimed the stale directory;
    // keep that path as a permanent tombstone for delayed readers.
    return guardPath;
  }
}

function releasePreparationLock(lockPath, token) {
  let marker;
  try {
    marker = readJson(join(lockPath, MARKER_NAME));
  } catch {
    return;
  }
  if (marker.owner !== LOCK_OWNER || marker.token !== token) return;
  rmSync(lockPath, { recursive: true, force: true });
}

function packageSegments(name) {
  if (/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(name)) {
    return name.split("/");
  }
  if (/^[a-z0-9][a-z0-9._-]*$/i.test(name)) return [name];
  throw new TypeError(`invalid workspace package name: ${name}`);
}

function packageTarget(packageName, subpath, target, targetRoot, sourceRoot) {
  if (typeof target !== "string" || !target.startsWith(".")) {
    throw new TypeError(
      `${packageName} export ${subpath} must target a local path`,
    );
  }
  const targetPath = resolve(targetRoot, target);
  const sourceRelativePath = relative(sourceRoot, targetPath);
  if (
    isAbsolute(sourceRelativePath) ||
    sourceRelativePath === ".." ||
    sourceRelativePath.startsWith(`..${sep}`)
  ) {
    throw new Error(
      `${packageName} export ${subpath} escapes its generated package source`,
    );
  }
  return `./source/${sourceRelativePath.split(sep).join("/")}`;
}

function packageExports(
  packageName,
  exports,
  targetRoot,
  sourceRoot = targetRoot,
) {
  if (typeof exports === "string") {
    return packageTarget(packageName, ".", exports, targetRoot, sourceRoot);
  }
  if (!exports || typeof exports !== "object" || Array.isArray(exports)) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(exports).map(([subpath, target]) => {
      if (subpath !== "." && !subpath.startsWith("./")) {
        throw new TypeError(
          `${packageName} export ${subpath} must be . or start with ./`,
        );
      }
      return [
        subpath,
        packageTarget(packageName, subpath, target, targetRoot, sourceRoot),
      ];
    }),
  );
}

function addWorkspaceImportsToRootExports(
  rootName,
  rootExports,
  workspaceRoot,
  workspaceConfig,
  projectRoot,
) {
  for (
    const [specifier, target] of Object.entries(
      workspaceConfig.imports ?? {},
    )
  ) {
    if (!specifier.startsWith(`${rootName}/`) || typeof target !== "string") {
      continue;
    }
    const subpath = `./${specifier.slice(rootName.length + 1)}`;
    const generatedTarget = packageTarget(
      rootName,
      subpath,
      target,
      workspaceRoot,
      projectRoot,
    );
    const existing = rootExports[subpath];
    if (existing === undefined) rootExports[subpath] = generatedTarget;
  }
}

export function prepareBunWorkspacePackages(
  projectRoot,
  { nodeModulesPath = resolve(projectRoot, "node_modules") } = {},
) {
  nodeModulesPath = resolve(nodeModulesPath);
  const { lockPath, token } = acquirePreparationLock(nodeModulesPath);
  const createdPackages = [];
  const scopeDirectories = new Set();

  function createPackage(name, sourceRoot, exports) {
    const segments = packageSegments(name);
    const packageRoot = join(nodeModulesPath, ...segments);
    const markerPath = join(packageRoot, MARKER_NAME);
    if (existsSync(packageRoot)) {
      let marker;
      try {
        marker = readJson(markerPath);
      } catch {
        throw new Error(`${name} already exists in node_modules`);
      }
      if (
        marker.owner !== LOCK_OWNER ||
        marker.name !== name ||
        marker.source !== sourceRoot
      ) {
        throw new Error(
          `${name} in node_modules is not owned by the Bun test runner`,
        );
      }
      rmSync(packageRoot, { recursive: true, force: true });
    }

    mkdirSync(packageRoot, { recursive: true });
    createdPackages.push(packageRoot);
    if (segments.length > 1) scopeDirectories.add(dirname(packageRoot));
    ensureDirectoryLink(
      sourceRoot,
      join(packageRoot, "source"),
      `${name}/source`,
    );
    writeFileSync(
      join(packageRoot, "package.json"),
      `${JSON.stringify({ name, private: true, type: "module", exports }, null, 2)}\n`,
    );
    writeFileSync(
      markerPath,
      `${
        JSON.stringify({
          owner: LOCK_OWNER,
          name,
          source: sourceRoot,
          token,
        })
      }\n`,
    );
  }

  function cleanup() {
    try {
      for (const packageRoot of createdPackages.splice(0).reverse()) {
        rmSync(packageRoot, { recursive: true, force: true });
      }
      for (const scopeDirectory of scopeDirectories) {
        try {
          rmdirSync(scopeDirectory);
        } catch (error) {
          if (error?.code !== "ENOENT" && error?.code !== "ENOTEMPTY") {
            throw error;
          }
        }
      }
    } finally {
      releasePreparationLock(lockPath, token);
    }
  }

  try {
    const rootConfig = readJson(resolve(projectRoot, "deno.json"));
    const workspaces = (rootConfig.workspace ?? []).map(
      (workspaceDirectory) => {
        const workspaceRoot = resolve(projectRoot, workspaceDirectory);
        const workspaceConfig = readJson(resolve(workspaceRoot, "deno.json"));
        return { workspaceDirectory, workspaceRoot, workspaceConfig };
      },
    );

    if (typeof rootConfig.name !== "string") {
      throw new TypeError("deno.json must name the root package");
    }
    const rootExports = packageExports(
      rootConfig.name,
      rootConfig.exports,
      projectRoot,
    );
    if (rootExports === null || typeof rootExports === "string") {
      throw new TypeError("the root package must declare named exports");
    }
    addWorkspaceImportsToRootExports(
      rootConfig.name,
      rootExports,
      projectRoot,
      rootConfig,
      projectRoot,
    );
    for (const { workspaceRoot, workspaceConfig } of workspaces) {
      addWorkspaceImportsToRootExports(
        rootConfig.name,
        rootExports,
        workspaceRoot,
        workspaceConfig,
        projectRoot,
      );
    }
    createPackage(rootConfig.name, projectRoot, rootExports);

    for (
      const {
        workspaceDirectory,
        workspaceRoot,
        workspaceConfig,
      } of workspaces
    ) {
      if (workspaceConfig.exports === undefined) continue;
      if (typeof workspaceConfig.name !== "string") {
        throw new TypeError(
          `${workspaceDirectory}/deno.json exports modules without a package name`,
        );
      }

      const exports = packageExports(
        workspaceConfig.name,
        workspaceConfig.exports,
        workspaceRoot,
      );
      if (exports === null) continue;
      createPackage(workspaceConfig.name, workspaceRoot, exports);
    }
  } catch (error) {
    cleanup();
    throw error;
  }

  let cleaned = false;
  return {
    nodeModulesPath,
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      cleanup();
    },
  };
}
