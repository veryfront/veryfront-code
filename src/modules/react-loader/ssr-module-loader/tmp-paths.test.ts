import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildTempModulePath, buildTmpDirPath, getTmpDirCacheKey } from "./tmp-paths.ts";
import { formatCacheVersionSegment } from "#veryfront/utils/cache-version.ts";
import { cacheNamespaceSegment, hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { getMdxEsmCacheDir, runWithCacheDir } from "#veryfront/utils/cache-dir.ts";
import { getMdxEsmSsrCacheDir } from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import { RUNTIME_VERSION } from "#veryfront/utils/version.ts";

describe("modules/react-loader/ssr-module-loader/tmp-paths", () => {
  it("builds a stable tmp dir cache key with encoded project id", () => {
    const key = getTmpDirCacheKey("/cache/mdx", "my/project", "release-1", "0.1.7");
    assertEquals(
      key,
      `/cache/mdx|v0-1-7|${cacheNamespaceSegment("my/project")}|${
        cacheNamespaceSegment("release-1")
      }`,
    );
  });

  it("builds tmp dir path with encoded project id", () => {
    const path = buildTmpDirPath("/cache/mdx", "my/project", "branch-main", "0.1.7");
    assertEquals(
      path,
      `/cache/mdx/v0-1-7/${cacheNamespaceSegment("my/project")}/${
        cacheNamespaceSegment("branch-main")
      }`,
    );
  });

  it("keeps content source ids with colliding 32-bit hashes in distinct namespaces", () => {
    // Regression: hashCodeHex is a 32-bit hash, and these two preview source
    // ids collide under it. Sharing a namespace lets one content source serve
    // the other's transformed modules for the same file path.
    assertEquals(hashCodeHex("preview-58x4ga9b"), hashCodeHex("preview-5icz6rpk"));

    const first = buildTmpDirPath("/cache/mdx", "my/project", "preview-58x4ga9b", "0.1.7");
    const second = buildTmpDirPath("/cache/mdx", "my/project", "preview-5icz6rpk", "0.1.7");
    assert(first !== second, "colliding source ids must not share an SSR cache dir");

    const firstKey = getTmpDirCacheKey("/cache/mdx", "my/project", "preview-58x4ga9b", "0.1.7");
    const secondKey = getTmpDirCacheKey("/cache/mdx", "my/project", "preview-5icz6rpk", "0.1.7");
    assert(firstKey !== secondKey, "colliding source ids must not share a tmp dir cache key");
  });

  it("derives the same directory as the MDX ESM SSR cache", () => {
    // The SSR loader writes transformed modules into buildTmpDirPath and the
    // MDX cache reads them back from getMdxEsmSsrCacheDir. If the two
    // derivations drift, the loader writes into a directory the MDX cache
    // never reads.
    runWithCacheDir("/cache", () => {
      for (
        const [projectId, contentSourceId] of [
          ["project-parity", "preview-main"],
          ["My/Project", "preview-feature/refactor"],
          ["project-parity", "s".repeat(4096)],
        ] as const
      ) {
        assertEquals(
          buildTmpDirPath(getMdxEsmCacheDir(), projectId, contentSourceId, RUNTIME_VERSION),
          getMdxEsmSsrCacheDir(projectId, contentSourceId),
        );
      }
    });
  });

  it("keeps cached module paths within platform path limits", () => {
    // Namespace segments are lossless rather than hashed, so their length is
    // part of every cached module path. Hosts without long-path support cap a
    // path at 260 characters, and a realistic deep route must stay under it.
    const tmpDir = buildTmpDirPath(
      "/cache/representative-user-cache/veryfront-mdx-esm",
      "3f7c1a12-9e0b-4f2a-8c31-7a5d2b6e4f90",
      "preview-58x4ga9b",
      "0.1.7",
    );
    const modulePath = buildTempModulePath(
      tmpDir,
      "/project/_vf_modules/app/(marketing)/docs/[category]/[slug]/page.tsx",
      "/project",
      "0.1.7",
      "deadbeefcafebabe",
    );

    assert(
      modulePath.length < 260,
      `cached module path must stay within platform path limits: ${modulePath.length}`,
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
      `/cache/mdx/${projectHash}/${
        hashCodeHex("release-1")
      }/src/page.tsx.v0-1-7-rc-49.deadbeef.mjs`,
    );
  });

  it("builds hashed temp module paths for every accepted source extension", () => {
    const tmpDir = `/cache/mdx/${hashCodeHex("my/project")}/${hashCodeHex("release-1")}`;
    const extensions = [
      "js",
      "jsx",
      "mjs",
      "mjsx",
      "cjs",
      "cjsx",
      "ts",
      "tsx",
      "mts",
      "mtsx",
      "cts",
      "ctsx",
      "mdx",
    ];

    for (const extension of extensions) {
      assertEquals(
        buildTempModulePath(
          tmpDir,
          `/repo/project/src/module.${extension}`,
          "/repo/project",
          "0.1.7",
          "deadbeefcafebabe",
        ),
        `${tmpDir}/src/module.${extension}.v0-1-7.deadbeef.mjs`,
        `${extension} sources must get a versioned, content-hashed .mjs temp path`,
      );
    }
  });

  it("keeps source extension identity for identical transformed content", () => {
    const tmpDir = `/cache/mdx/${hashCodeHex("my/project")}/${hashCodeHex("release-1")}`;
    const jsPath = buildTempModulePath(
      tmpDir,
      "/repo/project/src/module.js",
      "/repo/project",
      "0.1.7",
      "deadbeefcafebabe",
    );
    const mjsPath = buildTempModulePath(
      tmpDir,
      "/repo/project/src/module.mjs",
      "/repo/project",
      "0.1.7",
      "deadbeefcafebabe",
    );

    assert(jsPath !== mjsPath, "distinct source modules must not share one ESM cache path");
  });

  it("builds content-addressed temp paths for JSON dependencies", () => {
    const tmpDir = `/cache/mdx/${hashCodeHex("my/project")}/${hashCodeHex("branch-main")}`;

    assertEquals(
      buildTempModulePath(
        tmpDir,
        "/repo/project/data/site.json",
        "/repo/project",
        "0.1.7",
        "deadbeefcafebabe",
      ),
      `${tmpDir}/data/site.v0-1-7.deadbeef.json`,
    );
  });

  it("builds hashed module paths for compiled framework .src files", () => {
    const tempPath = buildTempModulePath(
      "/cache/mdx/v0-1-1154/project/source",
      "/tmp/deno-compile-veryfront/dist/framework-src/react/runtime/core.ts.src",
      "/project",
      "0.1.1154",
      "deadbeefcafebabe",
    );

    assertEquals(
      tempPath,
      "/cache/mdx/v0-1-1154/project/source/tmp/deno-compile-veryfront/dist/framework-src/react/runtime/core.ts.src.v0-1-1154.deadbeef.mjs",
    );
  });

  it("keeps JSON modules as JSON while adding their content identity", () => {
    const tempPath = buildTempModulePath(
      "/cache/mdx/v0-1-7/project/source",
      "/repo/project/data/settings.json",
      "/repo/project",
      "0.1.7",
      "deadbeefcafebabe",
    );

    assertEquals(
      tempPath,
      "/cache/mdx/v0-1-7/project/source/data/settings.v0-1-7.deadbeef.json",
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
      `/cache/mdx/${projectHash}/${hashCodeHex("release-1")}/tmp/external.tsx.v0-1-7-rc-49.mjs`,
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
    assert(/^[a-f0-9]+$/.test(hashCodeHex(deepPath)), "project key should be hex-only");
  });
});
