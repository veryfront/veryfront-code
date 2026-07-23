import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildTempModulePath, buildTmpDirPath, getTmpDirCacheKey } from "./tmp-paths.ts";
import { formatCacheVersionSegment } from "#veryfront/utils/cache-version.ts";
import { hashString } from "#veryfront/cache/hash.ts";

describe("modules/react-loader/ssr-module-loader/tmp-paths", () => {
  it("builds a stable tmp dir cache key with hashed project id", () => {
    const key = getTmpDirCacheKey("/cache/mdx", "my/project", "release-1", "0.1.7");
    assertEquals(
      key,
      JSON.stringify([
        "/cache/mdx",
        "v0-1-7",
        hashString("my/project"),
        hashString("release-1"),
      ]),
    );
  });

  it("builds tmp dir path with hashed project id", () => {
    const path = buildTmpDirPath("/cache/mdx", "my/project", "branch-main", "0.1.7");
    assertEquals(
      path,
      `/cache/mdx/v0-1-7/${hashString("my/project")}/${hashString("branch-main")}`,
    );
  });

  it("isolates tmp directories by runtime version", () => {
    const oldPath = buildTmpDirPath("/cache/mdx", "my/project", "branch-main", "0.1.9");
    const newPath = buildTmpDirPath("/cache/mdx", "my/project", "branch-main", "0.1.1030");

    assert(oldPath.includes("/v0-1-9/"));
    assert(newPath.includes("/v0-1-1030/"));
    assert(oldPath !== newPath);
  });

  it("does not nest slash-containing content source ids under their prefixes", () => {
    const parent = buildTmpDirPath("/cache/mdx", "my/project", "preview-feature", "0.1.7");
    const child = buildTmpDirPath(
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
    const projectHash = hashString("my/project");
    const tempPath = buildTempModulePath(
      `/cache/mdx/${projectHash}/${hashString("release-1")}`,
      "/repo/project/src/page.tsx",
      "/repo/project",
      "0.1.7-rc.49",
      "deadbeefcafebabe",
    );

    assertEquals(
      tempPath,
      `/cache/mdx/${projectHash}/${
        hashString("release-1")
      }/src/page.v0-1-7-rc-49.deadbeefcafebabe.js`,
    );
  });

  it("isolates absolute files outside the project by their full identity", () => {
    const projectHash = hashString("my/project");
    const tempPath = buildTempModulePath(
      `/cache/mdx/${projectHash}/${hashString("release-1")}`,
      "/tmp/external.tsx",
      "/repo/project",
      "0.1.7-rc.49",
    );

    assertEquals(
      tempPath,
      `/cache/mdx/${projectHash}/${hashString("release-1")}/_external/${
        hashString("/tmp/external.tsx")
      }/external.v0-1-7-rc-49.js`,
    );
  });

  it("should not produce URL-encoded characters in cache paths", () => {
    // Regression: encodeURIComponent created dirs with literal %2F chars
    // which broke Deno's file:// URL module resolution.
    const deepPath = "/home/user/Documents/Projects/org/my-app";
    const runtimeVersion = "0.1.7+build@42";
    const path = buildTmpDirPath("/cache/mdx", deepPath, "build-static", runtimeVersion);
    const key = getTmpDirCacheKey("/cache/mdx", deepPath, "build-static", runtimeVersion);

    assert(!path.includes("%"), `cache path must not contain percent-encoded chars: ${path}`);
    assert(!key.includes("%"), `cache key must not contain percent-encoded chars: ${key}`);
    assert(path.includes(`/${formatCacheVersionSegment(runtimeVersion)}/`));
    assert(/^[a-f0-9]+$/.test(hashString(deepPath)), "project key should be hex-only");
  });

  it("does not truncate distinct content hashes to the same temp path", () => {
    const first = buildTempModulePath(
      "/cache/mdx/project/source",
      "/repo/project/page.tsx",
      "/repo/project",
      "0.1.7",
      "deadbeef00000000",
    );
    const second = buildTempModulePath(
      "/cache/mdx/project/source",
      "/repo/project/page.tsx",
      "/repo/project",
      "0.1.7",
      "deadbeefffffffff",
    );

    assert(first !== second);
  });

  it("keeps traversal-shaped relative paths inside the cache directory", () => {
    const cacheDir = "/cache/mdx/project/source";
    const tempPath = buildTempModulePath(
      cacheDir,
      "../../outside.tsx",
      "/repo/project",
      "0.1.7",
    );

    assert(
      tempPath.startsWith(`${cacheDir}/`),
      `temp module must remain inside its cache directory: ${tempPath}`,
    );
    assert(!tempPath.includes("/../"));
  });
});
