import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  ensureDirectoryLink,
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
      ensureDirectoryLink("source", "target", "package", {
        pathExists: () => false,
        createSymlink: () => {
          throw existsError;
        },
      })
    );

    const permissionError = Object.assign(new Error("permission denied"), { code: "EACCES" });
    assert.throws(
      () =>
        ensureDirectoryLink("source", "target", "package", {
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
      assert.throws(() => ensureNpmNodeModulesLinks(rootDir), {
        message: MISSING_BUILD_MESSAGE,
      });
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
      const result = spawnSync(process.execPath, evalArgs, {
        encoding: "utf8",
      });

      assert.equal(result.status, 1);
      assert.ok(
        result.stderr.includes(MISSING_BUILD_MESSAGE),
        `Expected build instruction in stderr, received: ${JSON.stringify(result.stderr)}`,
      );
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("tolerates a concurrent EEXIST link race after a stale exists check", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "veryfront-npm-links-"));
    const sourcePath = join(rootDir, "source");
    const targetPath = join(rootDir, "target");
    mkdirSync(sourcePath);
    symlinkSync(join(rootDir, "missing"), targetPath, resolveDirectoryLinkType());

    try {
      assert.equal(false, existsSync(targetPath));
      assert.doesNotThrow(() => ensureDirectoryLink(sourcePath, targetPath, "react"));
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("preserves the original npm/node_modules read failure as the error cause", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "veryfront-npm-links-"));
    mkdirSync(join(rootDir, "npm"));
    writeFileSync(join(rootDir, "npm/node_modules"), "");
    mkdirSync(join(rootDir, "node_modules"));

    try {
      assert.throws(
        () => ensureNpmNodeModulesLinks(rootDir),
        (error) => {
          assert.equal(
            error.message,
            "Cannot read npm/node_modules while preparing runtime tests.",
          );
          assert.equal(error.cause?.code, "ENOTDIR");
          return true;
        },
      );
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("preserves the original link failure as the error cause", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "veryfront-npm-links-"));
    const sourcePath = join(rootDir, "missing");
    const targetPath = join(rootDir, "missing-parent", "target");

    try {
      assert.throws(
        () => ensureDirectoryLink(sourcePath, targetPath, "react"),
        (error) => {
          assert.equal(
            error.message,
            'Cannot link npm dependency "react" into node_modules.',
          );
          assert.equal(error.cause?.code, "ENOENT");
          return true;
        },
      );
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
