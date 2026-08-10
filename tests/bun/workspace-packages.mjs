import { existsSync, mkdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { ensureDirectoryLink } from "../ensure-npm-links.mjs";

const MARKER_NAME = ".veryfront-bun-workspace-package.json";
const LOCK_NAME = ".veryfront-bun-workspace-packages.lock";
const LOCK_OWNER = "veryfront-bun-tests";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function acquirePreparationLock(nodeModulesPath) {
  mkdirSync(nodeModulesPath, { recursive: true });
  const lockPath = join(nodeModulesPath, LOCK_NAME);
  try {
    mkdirSync(lockPath);
  } catch (error) {
    if (error?.code === "EEXIST") {
      if (!reclaimStaleLock(lockPath)) {
        throw new Error("Bun workspace package preparation is already active");
      }
      mkdirSync(lockPath);
    } else {
      throw error;
    }
  }

  const token = randomUUID();
  try {
    writeFileSync(
      join(lockPath, MARKER_NAME),
      `${JSON.stringify({ owner: LOCK_OWNER, pid: process.pid, token })}\n`,
    );
  } catch (error) {
    rmSync(lockPath, { recursive: true, force: true });
    throw error;
  }

  return { lockPath, token };
}

function reclaimStaleLock(lockPath) {
  let marker;
  try {
    marker = readJson(join(lockPath, MARKER_NAME));
  } catch {
    return false;
  }

  if (marker?.owner !== LOCK_OWNER) {
    return false;
  }
  if (!Number.isInteger(marker.pid) || marker.pid < 1) {
    return false;
  }
  try {
    process.kill(marker.pid, 0);
    return false;
  } catch (error) {
    if (error?.code !== "ESRCH") return false;
    rmSync(lockPath, { recursive: true, force: true });
    return true;
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

export function prepareBunWorkspacePackages(projectRoot) {
  const nodeModulesPath = resolve(projectRoot, "node_modules");
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
