import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { prepareBunWorkspacePackages, reclaimStalePreparationLock } from "./workspace-packages.mjs";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("prepareBunWorkspacePackages derives native packages from every workspace export", () => {
  const prepared = prepareBunWorkspacePackages(projectRoot);
  const generatedPackageRoots = [];

  try {
    const rootConfig = readJson(resolve(projectRoot, "deno.json"));
    const rootPackage = readJson(join(prepared.nodeModulesPath, "veryfront/package.json"));
    assert.equal(
      rootPackage.exports["./platform/path"],
      "./source/src/platform/compat/path/index.ts",
    );
    assert.equal(
      rootPackage.exports["./transforms/frontmatter"],
      "./source/src/transforms/mdx/compiler/frontmatter-extractor.ts",
    );
    const publishedWorkspaces = rootConfig.workspace.filter((workspaceDirectory) => {
      const config = readJson(resolve(projectRoot, workspaceDirectory, "deno.json"));
      return typeof config.name === "string" && config.exports !== undefined;
    });
    assert.ok(publishedWorkspaces.length > 25);

    for (const workspaceDirectory of publishedWorkspaces) {
      const workspaceRoot = resolve(projectRoot, workspaceDirectory);
      const sourceConfig = readJson(resolve(workspaceRoot, "deno.json"));
      const packageRoot = join(prepared.nodeModulesPath, ...sourceConfig.name.split("/"));
      generatedPackageRoots.push(packageRoot);
      const packageConfig = readJson(join(packageRoot, "package.json"));

      assert.equal(packageConfig.name, sourceConfig.name);
      assert.equal(realpathSync(join(packageRoot, "source")), realpathSync(workspaceRoot));
      if (typeof sourceConfig.exports === "string") {
        assert.equal(packageConfig.exports, `./source/${sourceConfig.exports.slice(2)}`);
      } else {
        for (const [subpath, target] of Object.entries(sourceConfig.exports)) {
          assert.equal(packageConfig.exports[subpath], `./source/${target.slice(2)}`);
        }
      }
    }
  } finally {
    prepared.cleanup();
  }

  for (const packageRoot of generatedPackageRoots) assert.equal(existsSync(packageRoot), false);
  assert.equal(existsSync(join(prepared.nodeModulesPath, "veryfront")), false);
  assert.equal(existsSync(join(prepared.nodeModulesPath, "react")), true);
});

test("workspace package cleanup is idempotent", () => {
  const prepared = prepareBunWorkspacePackages(projectRoot);
  prepared.cleanup();
  prepared.cleanup();
  assert.equal(existsSync(join(prepared.nodeModulesPath, "@veryfront/ext-schema-zod")), false);
  assert.equal(existsSync(join(prepared.nodeModulesPath, "react")), true);
});

test("workspace package preparation rejects an overlapping run without disturbing it", () => {
  const prepared = prepareBunWorkspacePackages(projectRoot);
  const rootPackagePath = join(prepared.nodeModulesPath, "veryfront/package.json");

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

test("workspace package preparation reclaims a lock owned by a dead process", () => {
  const root = mkdtempSync(join(tmpdir(), "veryfront-bun-lock-"));
  const lockPath = join(root, ".veryfront-bun-workspace-packages.lock");
  mkdirSync(lockPath);
  writeFileSync(
    join(lockPath, ".veryfront-bun-workspace-package.json"),
    `${JSON.stringify({ owner: "veryfront-bun-tests", pid: 123, token: "stale" })}\n`,
  );
  const runtimeProcess = {
    kill(pid, signal) {
      assert.equal(pid, 123);
      assert.equal(signal, 0);
      throw Object.assign(new Error("process does not exist"), { code: "ESRCH" });
    },
  };

  try {
    assert.equal(reclaimStalePreparationLock(lockPath, runtimeProcess), true);
    assert.equal(existsSync(lockPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspace package preparation reclaims a lock without a valid marker", () => {
  const root = mkdtempSync(join(tmpdir(), "veryfront-bun-lock-"));
  const lockPath = join(root, ".veryfront-bun-workspace-packages.lock");
  mkdirSync(lockPath);

  try {
    assert.equal(reclaimStalePreparationLock(lockPath), true);
    assert.equal(existsSync(lockPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
