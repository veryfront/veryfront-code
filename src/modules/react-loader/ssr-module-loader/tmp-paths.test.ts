import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildTempModulePath, buildTmpDirPath, getTmpDirCacheKey } from "./tmp-paths.ts";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";

describe("modules/react-loader/ssr-module-loader/tmp-paths", () => {
  it("builds a stable tmp dir cache key with hashed project id", () => {
    const key = getTmpDirCacheKey("/cache/mdx", "my/project", "release-1");
    assertEquals(key, `/cache/mdx|${hashCodeHex("my/project")}|${hashCodeHex("release-1")}`);
  });

  it("builds tmp dir path with hashed project id", () => {
    const path = buildTmpDirPath("/cache/mdx", "my/project", "branch-main");
    assertEquals(path, `/cache/mdx/${hashCodeHex("my/project")}/${hashCodeHex("branch-main")}`);
  });

  it("does not nest slash-containing content source ids under their prefixes", () => {
    const parent = buildTmpDirPath("/cache/mdx", "my/project", "preview-feature");
    const child = buildTmpDirPath("/cache/mdx", "my/project", "preview-feature/refactor");

    assert(
      !child.startsWith(`${parent}/`),
      `child source cache dir must not be nested under parent source: ${child}`,
    );
  });

  it("builds hashed temp module path for files under project dir", () => {
    const projectHash = hashCodeHex("my/project");
    const tempPath = buildTempModulePath(
      `/cache/mdx/${projectHash}/${hashCodeHex("release-1")}`,
      "/repo/project/src/page.tsx",
      "/repo/project",
      "0.1.7-rc.49",
      "deadbeefcafebabe",
    );

    assertEquals(
      tempPath,
      `/cache/mdx/${projectHash}/${hashCodeHex("release-1")}/src/page.v0-1-7-rc-49.deadbeef.js`,
    );
  });

  it("keeps absolute path structure when file is outside project dir", () => {
    const projectHash = hashCodeHex("my/project");
    const tempPath = buildTempModulePath(
      `/cache/mdx/${projectHash}/${hashCodeHex("release-1")}`,
      "/tmp/external.tsx",
      "/repo/project",
      "0.1.7-rc.49",
    );

    assertEquals(
      tempPath,
      `/cache/mdx/${projectHash}/${hashCodeHex("release-1")}/tmp/external.v0-1-7-rc-49.js`,
    );
  });

  it("should not produce URL-encoded characters in cache paths", () => {
    // Regression: encodeURIComponent created dirs with literal %2F chars
    // which broke Deno's file:// URL module resolution.
    const deepPath = "/home/user/Documents/Projects/org/my-app";
    const path = buildTmpDirPath("/cache/mdx", deepPath, "build-static");
    const key = getTmpDirCacheKey("/cache/mdx", deepPath, "build-static");

    assert(!path.includes("%"), `cache path must not contain percent-encoded chars: ${path}`);
    assert(!key.includes("%"), `cache key must not contain percent-encoded chars: ${key}`);
    assert(/^[a-f0-9]+$/.test(hashCodeHex(deepPath)), "project key should be hex-only");
  });
});
