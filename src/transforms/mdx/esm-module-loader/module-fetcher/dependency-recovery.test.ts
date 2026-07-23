import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { makeTempDir, readTextFile, remove } from "#veryfront/testing/deno-compat.ts";
import type { CacheBackend } from "#veryfront/cache/types.ts";
import { tokenizeAllVeryFrontPaths } from "#veryfront/cache";
import { buildMdxEsmModuleRecoveryCacheKey } from "../cache-format.ts";
import { ensureMdxModuleDependencies } from "./dependency-recovery.ts";
import { getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { getLocalFs } from "../cache/local-fs.ts";

const noopLog = {
  debug: () => {},
  warn: () => {},
  info: () => {},
  error: () => {},
  child: () => noopLog,
} as never;

class FakeDistributedCache implements CacheBackend {
  readonly type = "redis" as const;
  private values = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}

describe("module-fetcher/dependency-recovery", () => {
  it("recovers nested vfmod dependencies for the current content source", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-vfmod-recovery-" });
    const distributedCache = new FakeDistributedCache();
    const sourceDir = join(getMdxEsmCacheDir(), "project-a", "preview-main");
    const childPath = join(sourceDir, "vfmod-child.mjs");
    const grandChildPath = join(sourceDir, "vfmod-grandchild.mjs");
    const localFs = getLocalFs();
    const originalWriteTextFile = localFs.writeTextFile.bind(localFs);
    const originalRename = localFs.rename?.bind(localFs);
    if (!originalRename) throw new Error("Test filesystem must support rename");
    const writes: string[] = [];
    const renames: Array<[string, string]> = [];
    localFs.writeTextFile = async (path, data) => {
      writes.push(path);
      await originalWriteTextFile(path, data);
    };
    localFs.rename = async (from, to) => {
      renames.push([from, to]);
      await originalRename(from, to);
    };

    try {
      await distributedCache.set(
        buildMdxEsmModuleRecoveryCacheKey("project-a", "preview-main", "vfmod-child.mjs"),
        tokenizeAllVeryFrontPaths(
          [
            `import grandChild from "file://${grandChildPath}";`,
            `export default grandChild;`,
          ].join("\n"),
        ),
      );

      await distributedCache.set(
        buildMdxEsmModuleRecoveryCacheKey("project-a", "preview-main", "vfmod-grandchild.mjs"),
        tokenizeAllVeryFrontPaths(`export default "ok";`),
      );

      const result = await ensureMdxModuleDependencies(
        `import child from "file://${childPath}"; export default child;`,
        {
          projectId: "project-a",
          contentSourceId: "preview-main",
          distributedCache,
          log: noopLog,
        },
      );

      assertEquals(result.missing.length, 0);
      assertEquals(result.recovered.length, 2);
      assertEquals(
        await readTextFile(childPath),
        [
          `import grandChild from "file://${grandChildPath}";`,
          `export default grandChild;`,
        ].join("\n"),
      );
      assertEquals(await readTextFile(grandChildPath), `export default "ok";`);
      assertEquals(
        renames.every(([from, to]) => from.startsWith(`${to}.tmp-`)),
        true,
      );
      assertEquals(
        new Set(renames.map(([, to]) => to)),
        new Set([childPath, grandChildPath]),
      );
      assertEquals(writes.length, 2);
    } finally {
      localFs.writeTextFile = originalWriteTextFile;
      localFs.rename = originalRename;
      await remove(sourceDir, { recursive: true }).catch(() => {});
      await remove(tempDir, { recursive: true });
    }
  });

  it("does not recover vfmods from another content source", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-vfmod-recovery-scope-" });
    const distributedCache = new FakeDistributedCache();
    const sourceDir = join(getMdxEsmCacheDir(), "project-a", "preview-main");
    const childPath = join(sourceDir, "vfmod-child.mjs");

    try {
      await distributedCache.set(
        buildMdxEsmModuleRecoveryCacheKey("project-a", "release-42", "vfmod-child.mjs"),
        tokenizeAllVeryFrontPaths(`export default "wrong-source";`),
      );

      const result = await ensureMdxModuleDependencies(
        `import child from "file://${childPath}"; export default child;`,
        {
          projectId: "project-a",
          contentSourceId: "preview-main",
          distributedCache,
          log: noopLog,
        },
      );

      assertEquals(result.recovered.length, 0);
      assertEquals(result.missing, [childPath]);
    } finally {
      await remove(sourceDir, { recursive: true }).catch(() => {});
      await remove(tempDir, { recursive: true });
    }
  });
});
