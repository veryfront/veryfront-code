import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { makeTempDir, readTextFile, remove } from "#veryfront/testing/deno-compat.ts";
import type { CacheBackend } from "#veryfront/cache/types.ts";
import { tokenizeAllVeryFrontPaths } from "#veryfront/cache";
import { buildMdxEsmModuleRecoveryCacheKey } from "../cache-format.ts";
import { ensureMdxModuleDependencies } from "./dependency-recovery.ts";
import { getMdxEsmSsrCacheDir } from "../cache-paths.ts";
import {
  createMdxModuleRecoveryPayload,
  serializeMdxModuleRecoveryPayload,
} from "./recovery-payload.ts";

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
    const sourceDir = getMdxEsmSsrCacheDir("project-a", "preview-main");

    const grandChildPayload = createMdxModuleRecoveryPayload(
      "project-a",
      "preview-main",
      "_vf_modules/grandchild.js",
      `export default "ok";`,
    );
    const grandChildPath = join(sourceDir, grandChildPayload.fileName);
    const childPortableCode = tokenizeAllVeryFrontPaths(
      [
        `import grandChild from "file://${grandChildPath}";`,
        `export default grandChild;`,
      ].join("\n"),
    );
    const childPayload = createMdxModuleRecoveryPayload(
      "project-a",
      "preview-main",
      "_vf_modules/child.js",
      childPortableCode,
    );
    const childPath = join(sourceDir, childPayload.fileName);

    try {
      await distributedCache.set(
        buildMdxEsmModuleRecoveryCacheKey("project-a", "preview-main", childPayload.fileName),
        serializeMdxModuleRecoveryPayload(childPayload),
      );

      await distributedCache.set(
        buildMdxEsmModuleRecoveryCacheKey(
          "project-a",
          "preview-main",
          grandChildPayload.fileName,
        ),
        serializeMdxModuleRecoveryPayload(grandChildPayload),
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
    } finally {
      await remove(sourceDir, { recursive: true }).catch(() => {});
      await remove(tempDir, { recursive: true });
    }
  });

  it("does not recover vfmods from another content source", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-vfmod-recovery-scope-" });
    const distributedCache = new FakeDistributedCache();
    const sourceDir = getMdxEsmSsrCacheDir("project-a", "preview-main");
    const wrongPayload = createMdxModuleRecoveryPayload(
      "project-a",
      "release-42",
      "_vf_modules/child.js",
      `export default "wrong-source";`,
    );
    const childPath = join(sourceDir, wrongPayload.fileName);

    try {
      await distributedCache.set(
        buildMdxEsmModuleRecoveryCacheKey("project-a", "release-42", wrongPayload.fileName),
        serializeMdxModuleRecoveryPayload(wrongPayload),
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

  it("rejects recovery paths outside the exact tenant namespace", async () => {
    const distributedCache = new FakeDistributedCache();
    const otherTenantDir = getMdxEsmSsrCacheDir("project-b", "preview-main");
    const payload = createMdxModuleRecoveryPayload(
      "project-a",
      "preview-main",
      "_vf_modules/child.js",
      `export default "nope";`,
    );
    const outsidePath = join(otherTenantDir, payload.fileName);
    await distributedCache.set(
      buildMdxEsmModuleRecoveryCacheKey("project-a", "preview-main", payload.fileName),
      serializeMdxModuleRecoveryPayload(payload),
    );

    const result = await ensureMdxModuleDependencies(
      `import child from "file://${outsidePath}"; export default child;`,
      {
        projectId: "project-a",
        contentSourceId: "preview-main",
        distributedCache,
        log: noopLog,
      },
    );

    assertEquals(result.recovered, []);
    assertEquals(result.missing, [outsidePath]);
  });

  it("rejects a recovery payload whose code digest was tampered", async () => {
    const distributedCache = new FakeDistributedCache();
    const sourceDir = getMdxEsmSsrCacheDir("project-a", "preview-main");
    const payload = createMdxModuleRecoveryPayload(
      "project-a",
      "preview-main",
      "_vf_modules/child.js",
      `export default "trusted";`,
    );
    const childPath = join(sourceDir, payload.fileName);
    const tampered = { ...payload, portableCode: `export default "tampered";` };
    await distributedCache.set(
      buildMdxEsmModuleRecoveryCacheKey("project-a", "preview-main", payload.fileName),
      JSON.stringify(tampered),
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

    assertEquals(result.recovered, []);
    assertEquals(result.missing, [childPath]);
  });
});
