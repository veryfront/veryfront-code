import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { prepareBunWorkspacePackages, reclaimStalePreparationLock } from "./workspace-packages.mjs";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function waitForFiles(paths, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!paths.every((path) => existsSync(path))) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${paths.join(", ")}`);
    }
    await delay(10);
  }
}

function spawnLockReclaimer(lockPath, coordinationRoot, id) {
  const childSource = String.raw`
    import { existsSync, writeFileSync } from "node:fs";
    const { reclaimStalePreparationLock } = await import(process.env.VF_LOCK_MODULE_URL);
    const lockPath = process.env.VF_LOCK_PATH;
    const coordinationRoot = process.env.VF_COORDINATION_ROOT;
    const id = process.env.VF_RECLAIMER_ID;
    const otherId = id === "0" ? "1" : "0";
    const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
    const wait = () => Atomics.wait(waitBuffer, 0, 0, 10);
    writeFileSync(coordinationRoot + "/" + id + ".ready", "ready\n");
    while (!existsSync(coordinationRoot + "/start")) wait();
    const runtimeProcess = {
      kill() {
        writeFileSync(coordinationRoot + "/" + id + ".checked", "checked\n");
        const deadline = Date.now() + 500;
        while (
          !existsSync(coordinationRoot + "/" + otherId + ".checked") &&
          Date.now() < deadline
        ) wait();
        const error = new Error("dead lock owner");
        error.code = "ESRCH";
        throw error;
      },
    };
    const token = reclaimStalePreparationLock(lockPath, runtimeProcess);
    writeFileSync(
      coordinationRoot + "/" + id + ".result.json",
      JSON.stringify({ id, pid: process.pid, token }),
    );
    if (token !== null) {
      while (!existsSync(coordinationRoot + "/release")) wait();
    }
  `;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", childSource], {
    env: {
      ...process.env,
      VF_COORDINATION_ROOT: coordinationRoot,
      VF_LOCK_MODULE_URL: new URL("./workspace-packages.mjs", import.meta.url).href,
      VF_LOCK_PATH: lockPath,
      VF_RECLAIMER_ID: String(id),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const completion = new Promise((resolveCompletion) => {
    child.on("close", (code, signal) => resolveCompletion({ code, signal, stderr }));
  });
  return { child, completion };
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

test("stale-lock recovery reclaims an abandoned reclaimer directory", () => {
  const coordinationRoot = mkdtempSync(join(tmpdir(), "veryfront-bun-lock-interrupted-"));
  const lockPath = join(coordinationRoot, ".veryfront-bun-workspace-packages.lock");
  const reclaimerPath = join(coordinationRoot, ".veryfront-bun-workspace-packages.reclaim");
  mkdirSync(lockPath);
  mkdirSync(reclaimerPath);
  writeFileSync(
    join(lockPath, ".veryfront-bun-workspace-package.json"),
    `${JSON.stringify({ owner: "veryfront-bun-tests", pid: 9_999_999, token: "stale" })}\n`,
  );
  writeFileSync(
    join(reclaimerPath, ".veryfront-bun-workspace-package.json"),
    `${
      JSON.stringify({
        owner: "veryfront-bun-tests",
        pid: 9_999_998,
        token: "abandoned-reclaimer",
      })
    }\n`,
  );

  try {
    const token = reclaimStalePreparationLock(lockPath);

    assert.equal(typeof token, "string");
    assert.equal(readJson(join(lockPath, ".veryfront-bun-workspace-package.json")).token, token);
    assert.equal(existsSync(reclaimerPath), false);
  } finally {
    rmSync(coordinationRoot, { recursive: true, force: true });
  }
});

test("concurrent stale-lock reclaimers preserve the live replacement owner", async () => {
  const coordinationRoot = mkdtempSync(join(tmpdir(), "veryfront-bun-lock-race-"));
  const lockPath = join(coordinationRoot, ".veryfront-bun-workspace-packages.lock");
  mkdirSync(lockPath);
  writeFileSync(
    join(lockPath, ".veryfront-bun-workspace-package.json"),
    `${JSON.stringify({ owner: "veryfront-bun-tests", pid: 9_999_999, token: "stale" })}\n`,
  );
  const reclaimers = [
    spawnLockReclaimer(lockPath, coordinationRoot, 0),
    spawnLockReclaimer(lockPath, coordinationRoot, 1),
  ];
  const releasePath = join(coordinationRoot, "release");

  try {
    await waitForFiles([
      join(coordinationRoot, "0.ready"),
      join(coordinationRoot, "1.ready"),
    ]);
    writeFileSync(join(coordinationRoot, "start"), "start\n");
    const resultPaths = [
      join(coordinationRoot, "0.result.json"),
      join(coordinationRoot, "1.result.json"),
    ];
    await waitForFiles(resultPaths);

    const results = resultPaths.map(readJson);
    const winners = results.filter((result) => result.token !== null);
    assert.equal(winners.length, 1);
    const winner = winners[0];
    const marker = readJson(join(lockPath, ".veryfront-bun-workspace-package.json"));
    assert.equal(marker.token, winner.token);
    assert.equal(marker.pid, winner.pid);
    assert.doesNotThrow(() => process.kill(winner.pid, 0));
    assert.equal(existsSync(lockPath), true);

    writeFileSync(releasePath, "release\n");
    const completions = await Promise.all(reclaimers.map(({ completion }) => completion));
    for (const completion of completions) {
      assert.deepEqual(completion, { code: 0, signal: null, stderr: "" });
    }
  } finally {
    if (!existsSync(releasePath)) writeFileSync(releasePath, "release\n");
    for (const { child } of reclaimers) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
    await Promise.allSettled(reclaimers.map(({ completion }) => completion));
    rmSync(coordinationRoot, { recursive: true, force: true });
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
