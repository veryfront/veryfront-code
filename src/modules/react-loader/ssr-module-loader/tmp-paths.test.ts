import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildTempModulePath, buildTmpDirPath, getTmpDirCacheKey } from "./tmp-paths.ts";

describe("modules/react-loader/ssr-module-loader/tmp-paths", () => {
  it("builds a stable tmp dir cache key with encoded project id", () => {
    const key = getTmpDirCacheKey("/cache/mdx", "my/project", "release-1");
    assertEquals(key, "/cache/mdx|my%2Fproject|release-1");
  });

  it("builds tmp dir path with encoded project id", () => {
    const path = buildTmpDirPath("/cache/mdx", "my/project", "branch-main");
    assertEquals(path, "/cache/mdx/my%2Fproject/branch-main");
  });

  it("builds hashed temp module path for files under project dir", () => {
    const tempPath = buildTempModulePath(
      "/cache/mdx/my%2Fproject/release-1",
      "/repo/project/src/page.tsx",
      "/repo/project",
      "0.1.7-rc.49",
      "deadbeefcafebabe",
    );

    assertEquals(
      tempPath,
      "/cache/mdx/my%2Fproject/release-1/src/page.v0-1-7-rc-49.deadbeef.js",
    );
  });

  it("keeps absolute path structure when file is outside project dir", () => {
    const tempPath = buildTempModulePath(
      "/cache/mdx/my%2Fproject/release-1",
      "/tmp/external.tsx",
      "/repo/project",
      "0.1.7-rc.49",
    );

    assertEquals(tempPath, "/cache/mdx/my%2Fproject/release-1/tmp/external.v0-1-7-rc-49.js");
  });
});
