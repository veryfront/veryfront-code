import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import type { CacheBackend } from "#veryfront/cache/types.ts";
import {
  extractBundleDeps,
  findParentBundleWithEmbeddedUrl,
  validateBundleDepsExist,
} from "./bundle-deps-validator.ts";
import { markDegradedArtifact } from "./degraded-artifact.ts";
import { MAX_CACHED_HTTP_BUNDLE_BYTES } from "./http-bundle-file.ts";
import { __setDistributedCacheAccessorForTests } from "./http-cache-wrapper.ts";
import { embedSourceUrl } from "./source-url-embed.ts";

describe("transforms/esm/bundle-deps-validator", () => {
  describe("extractBundleDeps", () => {
    it("extracts absolute file:// deps", () => {
      const code = `import "file:///cache/veryfront-http-bundle/http-12345.mjs";`;
      const deps = extractBundleDeps(code);
      assertEquals(deps.length, 1);
      assertEquals(deps[0]!.hash, "12345");
      assertEquals(deps[0]!.path, "/cache/veryfront-http-bundle/http-12345.mjs");
    });

    it("extracts relative deps", () => {
      const code = `import "./http-67890.mjs";`;
      const deps = extractBundleDeps(code);
      assertEquals(deps.length, 1);
      assertEquals(deps[0]!.hash, "67890");
      assertEquals(deps[0]!.path, "http-67890.mjs");
    });

    it("extracts mixed absolute and relative deps", () => {
      const code = `
        import "file:///cache/veryfront-http-bundle/http-111.mjs";
        import './http-222.mjs';
      `;
      const deps = extractBundleDeps(code);
      assertEquals(deps.length, 2);
      const hashes = deps.map((d) => d.hash);
      assertEquals(hashes.includes("111"), true);
      assertEquals(hashes.includes("222"), true);
    });

    it("deduplicates by hash", () => {
      const code = `
        import "file:///cache/veryfront-http-bundle/http-111.mjs";
        import './http-111.mjs';
      `;
      const deps = extractBundleDeps(code);
      assertEquals(deps.length, 1);
      assertEquals(deps[0]!.hash, "111");
    });

    it("returns empty for code with no deps", () => {
      assertEquals(extractBundleDeps("const x = 1;"), []);
    });

    it("returns empty for empty string", () => {
      assertEquals(extractBundleDeps(""), []);
    });

    it("handles multiple absolute deps", () => {
      const code = `
        import "file:///a/veryfront-http-bundle/http-1.mjs";
        import "file:///a/veryfront-http-bundle/http-2.mjs";
        import "file:///a/veryfront-http-bundle/http-3.mjs";
      `;
      const deps = extractBundleDeps(code);
      assertEquals(deps.length, 3);
    });

    it("handles double-quoted relative deps", () => {
      const code = `import "./http-99999.mjs";`;
      const deps = extractBundleDeps(code);
      assertEquals(deps.length, 1);
      assertEquals(deps[0]!.hash, "99999");
    });

    it("extracts deps from from-style imports", () => {
      const code = `import { foo } from "file:///cache/veryfront-http-bundle/http-42.mjs";`;
      const deps = extractBundleDeps(code);
      assertEquals(deps.length, 1);
      assertEquals(deps[0]!.hash, "42");
    });

    it("handles very large hash numbers", () => {
      const code = `import "file:///cache/veryfront-http-bundle/http-999999999.mjs";`;
      const deps = extractBundleDeps(code);
      assertEquals(deps.length, 1);
      assertEquals(deps[0]!.hash, "999999999");
    });

    it("extracts full SHA-256 bundle hashes", () => {
      const hash = "d9daafa3b706faf7af89c03417596d23beed4c1ae964d7ee7ead5d335b683412";
      const code = `
        import "file:///cache/veryfront-http-bundle/http-${hash}.mjs";
        import "./http-${hash}.mjs";
      `;

      assertEquals(extractBundleDeps(code), [{
        path: `/cache/veryfront-http-bundle/http-${hash}.mjs`,
        hash,
      }]);
    });
  });

  describe("validateBundleDepsExist", () => {
    const depHash = "a1b2c3d4";
    const depPath = `http-${depHash}.mjs`;

    // Keys are stored under the version-free `{prefix}:{hash}` suffix so the
    // test never has to track the wrapper's cache-key version.
    function createBundleCacheBackend(
      entries: Record<string, string>,
      reads: string[],
    ): CacheBackend {
      const values = new Map(Object.entries(entries));
      return {
        type: "memory",
        get: (key) => {
          const match = /^[^:]+:([^:]+):(.+)$/.exec(key);
          const suffixKey = match ? `${match[1]}:${match[2]}` : key;
          reads.push(suffixKey);
          return Promise.resolve(values.get(suffixKey) ?? null);
        },
        set: () => Promise.resolve(),
        del: () => Promise.resolve(),
      };
    }

    async function bundleFileExists(path: string): Promise<boolean> {
      try {
        await createFileSystem().stat(path);
        return true;
      } catch {
        return false;
      }
    }

    async function assertRecoveryRejected(recoveredCode: string, why: string): Promise<void> {
      const cacheDir = await Deno.makeTempDir();
      __setDistributedCacheAccessorForTests(() =>
        Promise.resolve(createBundleCacheBackend({ [`code:${depHash}`]: recoveredCode }, []))
      );

      try {
        assertEquals(
          await validateBundleDepsExist([{ path: depPath, hash: depHash }], cacheDir),
          false,
          why,
        );
        assertEquals(
          await bundleFileExists(join(cacheDir, `http-${depHash}.mjs`)),
          false,
          "a rejected recovery must never be written to the local cache",
        );
      } finally {
        await Deno.remove(cacheDir, { recursive: true });
      }
    }

    afterEach(() => {
      __setDistributedCacheAccessorForTests(null);
    });

    it("rejects a recovered dep that is marked degraded", async () => {
      await assertRecoveryRejected(
        markDegradedArtifact("export const value = 1;\n"),
        "a degraded recovered dep is rejected",
      );
    });

    it("rejects a recovered dep carrying another environment's absolute cache paths", async () => {
      await assertRecoveryRejected(
        `import "file:///other-pod/.cache/veryfront-http-bundle/http-abc.mjs";\n`,
        "a recovered dep with foreign absolute cache paths is rejected",
      );
    });

    it("rejects a recovered dep larger than the cached bundle byte limit", async () => {
      await assertRecoveryRejected(
        "a".repeat(MAX_CACHED_HTTP_BUNDLE_BYTES + 1),
        "an oversized recovered dep is rejected",
      );
    });

    it("fails the graph closed for an invalid bundle hash", async () => {
      const cacheDir = await Deno.makeTempDir();
      const reads: string[] = [];
      __setDistributedCacheAccessorForTests(() =>
        Promise.resolve(createBundleCacheBackend({}, reads))
      );

      try {
        assertEquals(
          await validateBundleDepsExist(
            [{ path: "http-zz../etc.mjs", hash: "zz../etc" }],
            cacheDir,
          ),
          false,
          "an invalid bundle hash fails the graph closed",
        );
        assertEquals(
          reads,
          [],
          "an invalid bundle hash must never reach the distributed cache",
        );
      } finally {
        await Deno.remove(cacheDir, { recursive: true });
      }
    });
  });

  it("finds SHA-256-named parent bundles during local recovery", async () => {
    const cacheDir = await Deno.makeTempDir();
    const parentHash = "d9daafa3b706faf7af89c03417596d23beed4c1ae964d7ee7ead5d335b683412";
    const targetHash = "915c2e2f2105f33640de7ae9d5252b1edb798614e5958f63cd7acef23e501124";
    const parentPath = join(cacheDir, `http-${parentHash}.mjs`);
    const sourceUrl = "https://modules.example.com/parent.js";

    try {
      await Deno.writeTextFile(
        parentPath,
        embedSourceUrl(`import "./http-${targetHash}.mjs";`, sourceUrl),
      );

      assertEquals(
        await findParentBundleWithEmbeddedUrl(targetHash, cacheDir, createFileSystem()),
        { path: parentPath, sourceUrl },
      );
    } finally {
      await Deno.remove(cacheDir, { recursive: true });
    }
  });
});
