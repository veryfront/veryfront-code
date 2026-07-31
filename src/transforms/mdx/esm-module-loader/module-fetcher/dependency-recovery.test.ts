import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { makeTempDir, readTextFile, remove } from "#veryfront/testing/deno-compat.ts";
import type {
  CacheRevisionMutation,
  CacheRevisionSnapshot,
  RevisionedCacheBackend,
} from "#veryfront/cache/types.ts";
import { buildRevisionedCacheKey } from "#veryfront/cache/backend.ts";
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

class FakeDistributedCache implements RevisionedCacheBackend {
  readonly type = "redis" as const;
  readonly ordinaryCalls: string[] = [];
  readonly revisionReads: string[] = [];
  readonly exchanges: Array<{
    key: string;
    expectedRevision: string;
    mutation: CacheRevisionMutation;
    result: boolean;
  }> = [];
  snapshotOverride?: () => unknown;
  beforeExchange?: (key: string, mutation: CacheRevisionMutation) => void;
  private readonly values = new Map<string, { value: string | null; revision: string }>();
  private nextRevision = 0;

  get(key: string): Promise<string | null> {
    this.ordinaryCalls.push(`get:${key}`);
    return Promise.reject(new Error("ordinary get must not be used"));
  }

  set(key: string): Promise<void> {
    this.ordinaryCalls.push(`set:${key}`);
    return Promise.reject(new Error("ordinary set must not be used"));
  }

  del(key: string): Promise<void> {
    this.ordinaryCalls.push(`del:${key}`);
    return Promise.reject(new Error("ordinary del must not be used"));
  }

  getWithRevision(key: string): Promise<CacheRevisionSnapshot> {
    this.revisionReads.push(key);
    if (this.snapshotOverride) {
      return Promise.resolve(this.snapshotOverride() as CacheRevisionSnapshot);
    }
    const record = this.values.get(key);
    return Promise.resolve({ value: record?.value ?? null, revision: record?.revision ?? "0" });
  }

  compareExchange(
    key: string,
    expectedRevision: string,
    mutation: CacheRevisionMutation,
  ): Promise<boolean> {
    this.beforeExchange?.(key, mutation);
    const current = this.values.get(key);
    const accepted = (current?.revision ?? "0") === expectedRevision;
    if (accepted) {
      this.values.set(key, {
        value: mutation.kind === "set" ? mutation.value : null,
        revision: String(++this.nextRevision),
      });
    }
    this.exchanges.push({ key, expectedRevision, mutation, result: accepted });
    return Promise.resolve(accepted);
  }

  seed(key: string, value: string | null): void {
    this.values.set(key, { value, revision: String(++this.nextRevision) });
  }

  peek(key: string): string | null | undefined {
    return this.values.get(key)?.value;
  }
}

function recoveryKey(projectId: string, contentSourceId: string, fileName: string): string {
  return buildRevisionedCacheKey(
    buildMdxEsmModuleRecoveryCacheKey(projectId, contentSourceId, fileName),
  );
}

describe("module-fetcher/dependency-recovery", () => {
  it("reads recovery payloads only through reserved revision snapshots", async () => {
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
      distributedCache.seed(
        recoveryKey("project-a", "preview-main", childPayload.fileName),
        serializeMdxModuleRecoveryPayload(childPayload),
      );

      distributedCache.seed(
        recoveryKey(
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
      assertEquals(distributedCache.ordinaryCalls, []);
      assertEquals(
        distributedCache.revisionReads.every((key) => key.startsWith("vf:revisioned:v1:")),
        true,
      );
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
      distributedCache.seed(
        recoveryKey("project-a", "release-42", wrongPayload.fileName),
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
    distributedCache.seed(
      recoveryKey("project-a", "preview-main", payload.fileName),
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
    distributedCache.seed(
      recoveryKey("project-a", "preview-main", payload.fileName),
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

  it("rejects malformed snapshot shapes", async () => {
    const distributedCache = new FakeDistributedCache();
    const sourceDir = getMdxEsmSsrCacheDir("project-a", "preview-main");
    const payload = createMdxModuleRecoveryPayload(
      "project-a",
      "preview-main",
      "_vf_modules/child.js",
      `export default "trusted";`,
    );
    const childPath = join(sourceDir, payload.fileName);
    distributedCache.snapshotOverride = () => ({ value: null, revision: "1", extra: true });

    await assertRejects(
      () =>
        ensureMdxModuleDependencies(
          `import child from "file://${childPath}"; export default child;`,
          {
            projectId: "project-a",
            contentSourceId: "preview-main",
            distributedCache,
            log: noopLog,
          },
        ),
      TypeError,
      "contain only value and revision",
    );

    assertEquals(distributedCache.ordinaryCalls, []);
  });

  it("conditionally removes corrupt recovery data without deleting replacement", async () => {
    const distributedCache = new FakeDistributedCache();
    const sourceDir = getMdxEsmSsrCacheDir("project-a", "preview-main");
    const payload = createMdxModuleRecoveryPayload(
      "project-a",
      "preview-main",
      "_vf_modules/child.js",
      `export default "replacement";`,
    );
    const childPath = join(sourceDir, payload.fileName);
    const key = recoveryKey("project-a", "preview-main", payload.fileName);
    const replacement = serializeMdxModuleRecoveryPayload(payload);
    distributedCache.seed(key, '{"version":1,"portableCode":"corrupt"}');
    distributedCache.beforeExchange = (candidateKey, mutation) => {
      if (candidateKey === key && mutation.kind === "delete") {
        distributedCache.beforeExchange = undefined;
        distributedCache.seed(key, replacement);
      }
    };

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
    assertEquals(distributedCache.peek(key), replacement);
    assertEquals(
      distributedCache.exchanges.some((call) =>
        call.key === key && call.mutation.kind === "delete" && call.result === false
      ),
      true,
    );
    assertEquals(distributedCache.ordinaryCalls, []);
  });
});
