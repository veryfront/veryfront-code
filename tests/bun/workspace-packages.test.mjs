import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { prepareBunWorkspacePackages } from "./workspace-packages.mjs";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
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
  const lockPath = join(
    projectRoot,
    "node_modules",
    ".veryfront-bun-workspace-packages.lock",
  );
  rmSync(lockPath, { recursive: true, force: true });
  mkdirSync(lockPath, { recursive: true });
  writeFileSync(
    join(lockPath, ".veryfront-bun-workspace-package.json"),
    `${JSON.stringify({ owner: "veryfront-bun-tests", pid: 9_999_999, token: "stale" })}\n`,
  );

  const prepared = prepareBunWorkspacePackages(projectRoot);
  try {
    assert.equal(
      existsSync(join(prepared.nodeModulesPath, "veryfront/package.json")),
      true,
    );
  } finally {
    prepared.cleanup();
  }
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
