import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildTempModulePath,
  buildTmpDirPath,
  getTmpDirCacheKey,
  isTmpDirCacheKeyForProject,
} from "./tmp-paths.ts";
import { formatCacheVersionSegment } from "#veryfront/utils/cache-version.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";

describe("modules/react-loader/ssr-module-loader/tmp-paths", () => {
  it("builds an injective tmp dir cache key", () => {
    const key = getTmpDirCacheKey("/cache/mdx", "my/project", "release-1", "0.1.7");
    assertEquals(key.startsWith("ssr-tmp-dir:v2:"), true);
    assertEquals(isTmpDirCacheKeyForProject(key, "my/project"), true);
    assertEquals(isTmpDirCacheKeyForProject(key, "other/project"), false);
    assert(
      getTmpDirCacheKey("/cache/mdx", "Aa", "release-1", "0.1.7") !==
        getTmpDirCacheKey("/cache/mdx", "BB", "release-1", "0.1.7"),
      "legacy 32-bit hash collisions must not alias project cache keys",
    );
  });

  it("builds tmp dir path with SHA-256 identities", async () => {
    const path = await buildTmpDirPath(
      "/cache/mdx",
      "my/project",
      "branch-main",
      "0.1.7",
    );
    assertEquals(
      path,
      `/cache/mdx/v0-1-7/${await computeHash(
        "veryfront:ssr-tmp-project:v2\0my/project",
      )}/${await computeHash("veryfront:ssr-tmp-source:v2\0branch-main")}`,
    );
  });

  it("isolates tmp directories by runtime version", async () => {
    const oldPath = await buildTmpDirPath(
      "/cache/mdx",
      "my/project",
      "branch-main",
      "0.1.9",
    );
    const newPath = await buildTmpDirPath(
      "/cache/mdx",
      "my/project",
      "branch-main",
      "0.1.1030",
    );

    assert(oldPath.includes("/v0-1-9/"));
    assert(newPath.includes("/v0-1-1030/"));
    assert(oldPath !== newPath);
  });

  it("does not nest slash-containing content source ids under their prefixes", async () => {
    const parent = await buildTmpDirPath(
      "/cache/mdx",
      "my/project",
      "preview-feature",
      "0.1.7",
    );
    const child = await buildTmpDirPath(
      "/cache/mdx",
      "my/project",
      "preview-feature/refactor",
      "0.1.7",
    );

    assert(
      !child.startsWith(`${parent}/`),
      `child source cache dir must not be nested under parent source: ${child}`,
    );
  });

  it("builds hashed temp module path for files under project dir", () => {
    const tempPath = buildTempModulePath(
      "/cache/mdx/project/source",
      "/repo/project/src/page.tsx",
      "/repo/project",
      "0.1.7-rc.49",
      "deadbeefcafebabe",
    );

    assertEquals(
      tempPath,
      "/cache/mdx/project/source/src/page.v0-1-7-rc-49.deadbeefcafebabe.js",
    );
  });

  it("content-addresses authored JavaScript files as well as TypeScript files", () => {
    assertEquals(
      buildTempModulePath(
        "/cache/mdx/project/source",
        "/repo/project/src/page.js",
        "/repo/project",
        "0.1.7",
        "deadbeefcafebabe",
      ),
      "/cache/mdx/project/source/src/page.v0-1-7.deadbeefcafebabe.js",
    );
  });

  it("builds hashed JavaScript paths for compiled framework .src files", () => {
    const tempPath = buildTempModulePath(
      "/cache/mdx/v0-1-1154/project/source",
      "/tmp/deno-compile-veryfront/dist/framework-src/react/runtime/core.ts.src",
      "/project",
      "0.1.1154",
      "deadbeefcafebabe",
    );

    assertEquals(
      tempPath,
      "/cache/mdx/v0-1-1154/project/source/__external__/module.v0-1-1154.deadbeefcafebabe.js",
    );
  });

  it("does not retain arbitrary host paths for files outside project dir", () => {
    const tempPath = buildTempModulePath(
      "/cache/mdx/project/source",
      "/tmp/external.tsx",
      "/repo/project",
      "0.1.7-rc.49",
      "deadbeefcafebabe",
    );

    assertEquals(
      tempPath,
      "/cache/mdx/project/source/__external__/module.v0-1-7-rc-49.deadbeefcafebabe.js",
    );
  });

  it("rejects an external file path without a content identity", () => {
    assertRejects(
      async () => {
        buildTempModulePath(
          "/cache/mdx/project/source",
          "/tmp/external.tsx",
          "/repo/project",
          "0.1.7",
        );
      },
      TypeError,
      "outside the project",
    );
  });

  it("should not produce URL-encoded characters in cache paths", async () => {
    // Regression: encodeURIComponent created dirs with literal %2F chars
    // which broke Deno's file:// URL module resolution.
    const deepPath = "/home/user/Documents/Projects/org/my-app";
    const runtimeVersion = "0.1.7+build@42";
    const path = await buildTmpDirPath(
      "/cache/mdx",
      deepPath,
      "build-static",
      runtimeVersion,
    );
    const key = getTmpDirCacheKey("/cache/mdx", deepPath, "build-static", runtimeVersion);

    assert(!path.includes("%"), `cache path must not contain percent-encoded chars: ${path}`);
    assert(!key.includes("%"), `cache key must not contain percent-encoded chars: ${key}`);
    assert(path.includes(`/${formatCacheVersionSegment(runtimeVersion)}/`));
    assert(
      path.split("/").slice(-2).every((segment) => /^[a-f0-9]{64}$/.test(segment)),
      "project and source path keys should be full SHA-256 hex",
    );
  });
});
