import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  ensureDirectorySymlink,
  ensureNpmNodeModulesLinks,
  resolveDirectoryLinkType,
} from "./ensure-npm-links.mjs";

const MISSING_BUILD_MESSAGE =
  'Cannot prepare runtime tests because npm/node_modules is missing. Run "deno task build:npm" first.';

describe("ensureNpmNodeModulesLinks", () => {
  it("uses junctions for Windows directory links", () => {
    assert.equal(resolveDirectoryLinkType("win32"), "junction");
    assert.equal(resolveDirectoryLinkType("linux"), "dir");
  });

  it("tolerates a concurrent directory link and preserves other failures", () => {
    const existsError = Object.assign(new Error("already linked"), { code: "EEXIST" });
    assert.doesNotThrow(() =>
      ensureDirectorySymlink("source", "target", "package", {
        pathExists: () => false,
        createSymlink: () => {
          throw existsError;
        },
      })
    );

    const permissionError = Object.assign(new Error("permission denied"), { code: "EACCES" });
    assert.throws(
      () =>
        ensureDirectorySymlink("source", "target", "package", {
          pathExists: () => false,
          createSymlink: () => {
            throw permissionError;
          },
        }),
      (error) => {
        assert.equal(error.message, 'Cannot link npm dependency "package" into node_modules.');
        assert.equal(error.cause, permissionError);
        return true;
      },
    );
  });

  it("fails with the build instruction when npm dependencies are missing", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "veryfront-npm-links-"));
    mkdirSync(join(rootDir, "node_modules"));

    try {
      assert.throws(
        () => ensureNpmNodeModulesLinks(rootDir),
        {
          message: MISSING_BUILD_MESSAGE,
        },
      );
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("exits nonzero when link preparation fails", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "veryfront-npm-links-"));
    mkdirSync(join(rootDir, "node_modules"));
    const helperUrl = new URL("./ensure-npm-links.mjs", import.meta.url).href;
    const program = [
      `import { ensureNpmNodeModulesLinks } from ${JSON.stringify(helperUrl)};`,
      `ensureNpmNodeModulesLinks(${JSON.stringify(rootDir)});`,
    ].join("\n");
    const evalArgs = process.versions.deno
      ? ["eval", program]
      : ["--input-type=module", "--eval", program];

    try {
      const result = spawnSync(
        process.execPath,
        evalArgs,
        { encoding: "utf8" },
      );

      assert.equal(result.status, 1);
      assert.ok(
        result.stderr.includes(MISSING_BUILD_MESSAGE),
        `Expected build instruction in stderr, received: ${JSON.stringify(result.stderr)}`,
      );
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
