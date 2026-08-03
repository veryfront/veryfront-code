import "#veryfront/schemas/_test-setup.ts";
import {
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { deleteEnv, getEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { isNode } from "#veryfront/platform/compat/runtime.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __cacheDirInternals,
  ensureCacheNodeModules,
  getCacheBaseDir,
  getCacheDirFromContext,
  getHttpBundleCacheDir,
  getMdxEsmCacheDir,
  runWithCacheDir,
} from "./cache-dir.ts";
import { runWithProjectEnv } from "#veryfront/server/project-env/storage.ts";

const MANAGED_ENV_KEYS = [
  "HOME",
  "NODE_ENV",
  "VERYFRONT_CACHE_DIR",
  "VERYFRONT_MODE",
  "VF_CACHE_DIR",
];

const originalEnv = new Map<string, string | undefined>(
  MANAGED_ENV_KEYS.map((key) => [key, getEnv(key)]),
);

const nodeCacheRoots = new Set<string>();

function makeNodeCacheRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "veryfront-cache-node-modules-"));
  nodeCacheRoots.add(root);
  return root;
}

function assertFrameworkNodeModulesLink(cacheRoot: string): void {
  const link = join(cacheRoot, "node_modules");
  const require = createRequire(import.meta.url);
  const expectedReactDir = realpathSync(dirname(require.resolve("react")));

  assert(lstatSync(link).isSymbolicLink());
  assertEquals(realpathSync(join(link, "react")), expectedReactDir);
}

function restoreManagedEnv(): void {
  for (const [key, value] of originalEnv) {
    if (value === undefined) {
      deleteEnv(key);
    } else {
      setEnv(key, value);
    }
  }
}

describe("cache-dir", () => {
  afterEach(() => {
    restoreManagedEnv();
    for (const root of nodeCacheRoots) {
      rmSync(root, { recursive: true, force: true });
    }
    nodeCacheRoots.clear();
  });

  describe("getCacheDirFromContext", () => {
    it("should return undefined when not in a context", () => {
      assertEquals(getCacheDirFromContext(), undefined);
    });
  });

  describe("resolved React module paths", () => {
    it("should locate node_modules on POSIX and Windows", () => {
      assertEquals(
        __cacheDirInternals.getReactNodeModulesDir(
          "/repo/node_modules/react/index.js",
        ),
        "/repo/node_modules",
      );
      assertEquals(
        __cacheDirInternals.getReactNodeModulesDir(
          "C:\\repo\\node_modules\\react\\index.js",
        ),
        "C:\\repo\\node_modules",
      );
      assertEquals(
        __cacheDirInternals.getReactNodeModulesDir("/repo/vendor/react.js"),
        undefined,
      );
    });
  });

  describe("runWithCacheDir", () => {
    it("should make cache dir available within the callback", () => {
      const result = runWithCacheDir("/tmp/test-cache", getCacheDirFromContext);
      assertEquals(result, "/tmp/test-cache");
    });

    it("should restore undefined context after callback completes", () => {
      runWithCacheDir("/tmp/test-cache", () => {});
      assertEquals(getCacheDirFromContext(), undefined);
    });

    it("should return the callback result", () => {
      assertEquals(runWithCacheDir("/tmp/test-cache", () => 42), 42);
    });

    it("should support nested contexts", () => {
      runWithCacheDir("/tmp/outer", () => {
        assertEquals(getCacheDirFromContext(), "/tmp/outer");

        runWithCacheDir("/tmp/inner", () => {
          assertEquals(getCacheDirFromContext(), "/tmp/inner");
        });

        assertEquals(getCacheDirFromContext(), "/tmp/outer");
      });
    });
  });

  describe("getCacheBaseDir", () => {
    it("should return context cache dir when in a context", () => {
      const result = runWithCacheDir("/tmp/context-cache", getCacheBaseDir);
      assertEquals(result, "/tmp/context-cache");
    });

    it("should prefer context cache dir over explicit env", () => {
      setEnv("VERYFRONT_CACHE_DIR", "/tmp/env-cache");
      setEnv("NODE_ENV", "production");
      setEnv("HOME", "/tmp/home");

      const result = runWithCacheDir("/tmp/context-cache", getCacheBaseDir);

      assertEquals(result, "/tmp/context-cache");
    });

    it("should prefer VERYFRONT_CACHE_DIR over production default", () => {
      setEnv("VERYFRONT_CACHE_DIR", "/tmp/env-cache");
      setEnv("NODE_ENV", "production");
      setEnv("HOME", "/tmp/home");

      assertEquals(getCacheBaseDir(), "/tmp/env-cache");
    });

    it("should prefer VF_CACHE_DIR over production default", () => {
      deleteEnv("VERYFRONT_CACHE_DIR");
      setEnv("VF_CACHE_DIR", "/tmp/vf-cache");
      setEnv("NODE_ENV", "production");
      setEnv("HOME", "/tmp/home");

      assertEquals(getCacheBaseDir(), "/tmp/vf-cache");
    });

    it("should use a writable home cache in production", () => {
      deleteEnv("VERYFRONT_CACHE_DIR");
      deleteEnv("VF_CACHE_DIR");
      setEnv("NODE_ENV", "production");
      setEnv("VERYFRONT_MODE", "production");
      setEnv("HOME", "/tmp");

      assertEquals(getCacheBaseDir(), "/tmp/.cache/veryfront");
    });

    it("should use host runtime env while a project env overlay is active", () => {
      deleteEnv("VERYFRONT_CACHE_DIR");
      deleteEnv("VF_CACHE_DIR");
      setEnv("NODE_ENV", "production");
      setEnv("VERYFRONT_MODE", "production");
      setEnv("HOME", "/tmp");

      const result = runWithProjectEnv(
        { HOME: "/tenant", VF_CACHE_DIR: "/tenant/cache" },
        () => getCacheBaseDir(),
      );

      assertEquals(result, "/tmp/.cache/veryfront");
    });

    it("should return the local .cache dir when not in production and no env", () => {
      deleteEnv("NODE_ENV");
      deleteEnv("VERYFRONT_MODE");
      deleteEnv("VERYFRONT_CACHE_DIR");
      deleteEnv("VF_CACHE_DIR");

      const result = getCacheBaseDir();
      assertEquals(typeof result, "string");
      assert(result.length > 0);
      assert(result.endsWith(".cache"));
    });
  });

  describe("getMdxEsmCacheDir", () => {
    it("should return path ending with veryfront-mdx-esm", () => {
      const result = runWithCacheDir("/tmp/test", getMdxEsmCacheDir);
      assert(result.startsWith("/tmp/test"));
      assert(result.endsWith("veryfront-mdx-esm"));
    });
  });

  describe("getHttpBundleCacheDir", () => {
    it("should return path ending with veryfront-http-bundle", () => {
      const result = runWithCacheDir("/tmp/test", getHttpBundleCacheDir);
      assert(result.startsWith("/tmp/test"));
      assert(result.endsWith("veryfront-http-bundle"));
    });
  });

  describe({ name: "ensureCacheNodeModules on Node", ignore: !isNode }, () => {
    it("should link distinct cache roots independently", async () => {
      const firstRoot = makeNodeCacheRoot();
      const secondRoot = makeNodeCacheRoot();

      await Promise.all([
        runWithCacheDir(firstRoot, ensureCacheNodeModules),
        runWithCacheDir(secondRoot, ensureCacheNodeModules),
      ]);

      assertFrameworkNodeModulesLink(firstRoot);
      assertFrameworkNodeModulesLink(secondRoot);
    });

    it("should deduplicate concurrent callers and release completed operations", async () => {
      const cacheRoot = makeNodeCacheRoot();

      await runWithCacheDir(
        cacheRoot,
        () => Promise.all(Array.from({ length: 20 }, () => ensureCacheNodeModules())),
      );
      assertFrameworkNodeModulesLink(cacheRoot);

      unlinkSync(join(cacheRoot, "node_modules"));
      await runWithCacheDir(cacheRoot, ensureCacheNodeModules);

      assertFrameworkNodeModulesLink(cacheRoot);
    });

    it("should replace wrong and dangling symlinks", async () => {
      const cacheRoot = makeNodeCacheRoot();
      const wrongTarget = join(cacheRoot, "wrong-node-modules");
      const link = join(cacheRoot, "node_modules");
      mkdirSync(wrongTarget);
      symlinkSync(wrongTarget, link, "dir");

      await runWithCacheDir(cacheRoot, ensureCacheNodeModules);
      assertFrameworkNodeModulesLink(cacheRoot);

      unlinkSync(link);
      symlinkSync(join(cacheRoot, "missing-node-modules"), link, "dir");

      await runWithCacheDir(cacheRoot, ensureCacheNodeModules);
      assertFrameworkNodeModulesLink(cacheRoot);
    });

    it("should preserve a real node_modules directory", async () => {
      const cacheRoot = makeNodeCacheRoot();
      const nodeModulesDir = join(cacheRoot, "node_modules");
      const marker = join(nodeModulesDir, "keep.txt");
      mkdirSync(nodeModulesDir);
      writeFileSync(marker, "keep");

      await runWithCacheDir(cacheRoot, ensureCacheNodeModules);

      assert(lstatSync(nodeModulesDir).isDirectory());
      assertEquals(lstatSync(nodeModulesDir).isSymbolicLink(), false);
      assertEquals(readFileSync(marker, "utf8"), "keep");
    });

    it("should preserve a non-directory node_modules entry", async () => {
      const cacheRoot = makeNodeCacheRoot();
      const nodeModulesEntry = join(cacheRoot, "node_modules");
      writeFileSync(nodeModulesEntry, "keep");

      await runWithCacheDir(cacheRoot, ensureCacheNodeModules);

      const entry = openSync(nodeModulesEntry, "r");
      try {
        assert(fstatSync(entry).isFile());
        assertEquals(readFileSync(entry, "utf8"), "keep");
      } finally {
        closeSync(entry);
      }
    });
  });
});
