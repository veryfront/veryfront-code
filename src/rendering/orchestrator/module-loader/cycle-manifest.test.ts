import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertNotEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { basename, dirname, join } from "#veryfront/compat/path/index.ts";
import {
  getCycleManifestCacheDir,
} from "#veryfront/transforms/mdx/esm-module-loader/cache-format.ts";
import {
  advanceCycleManifestGeneration,
  getCycleManifestGeneration,
} from "#veryfront/transforms/mdx/esm-module-loader/cycle-manifest-lifecycle.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  CYCLE_MANIFEST_SIDECAR_SUFFIX,
  cycleArtifactBelongsToGraph,
  CycleManifestTransaction,
  inspectCycleManifestCache,
} from "./cycle-manifest.ts";

async function removeFixture(tmpDir: string): Promise<void> {
  await Promise.all([
    Deno.remove(tmpDir, { recursive: true }).catch(() => undefined),
    Deno.remove(getCycleManifestCacheDir(tmpDir), { recursive: true }).catch(() => undefined),
  ]);
}

describe("module-loader/cycle-manifest", () => {
  it("adopts a persisted generation before the first local invalidation", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "vf-cycle-persisted-generation-" });
    const manifestDir = getCycleManifestCacheDir(tmpDir);
    const artifactPath = join(
      manifestDir,
      "42-snapshot/artifacts/0.snapshot.js",
    );

    try {
      assertEquals(
        cycleArtifactBelongsToGraph(artifactPath, tmpDir, "snapshot"),
        true,
      );
      advanceCycleManifestGeneration(manifestDir);
      assertEquals(
        cycleArtifactBelongsToGraph(artifactPath, tmpDir, "snapshot"),
        false,
      );
    } finally {
      await removeFixture(tmpDir);
    }
  });

  it("rejects an artifact from an invalidated manifest generation", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "vf-cycle-generation-" });
    const manifestDir = getCycleManifestCacheDir(tmpDir);
    const generation = getCycleManifestGeneration(manifestDir);
    const artifactPath = join(
      manifestDir,
      `${generation}-snapshot/artifacts/0.snapshot.js`,
    );

    try {
      assertEquals(
        cycleArtifactBelongsToGraph(artifactPath, tmpDir, "snapshot"),
        true,
      );
      advanceCycleManifestGeneration(manifestDir);
      assertEquals(
        cycleArtifactBelongsToGraph(artifactPath, tmpDir, "snapshot"),
        false,
      );
    } finally {
      await removeFixture(tmpDir);
    }
  });

  it("rejects an edge count that its cache evidence cannot represent", () => {
    const transaction = new CycleManifestTransaction("/tmp/cycle-limit", "bounded");
    for (let index = 0; index < 5_000; index++) {
      transaction.registerEdge(`/project/target-${index}.ts`, "/project/importer.ts", true);
    }

    const error = assertThrows(
      () => transaction.registerEdge("/project/overflow.ts", "/project/importer.ts", true),
      VeryfrontError,
    );
    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "cache-error");
  });

  it("publishes colliding targets only after every entry is durable", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "vf-cycle-manifest-" });
    const localAdapter = await getLocalAdapter();
    const tsSourcePath = "/project/app/page.ts";
    const tsxSourcePath = "/project/app/page.tsx";
    const transaction = new CycleManifestTransaction(
      tmpDir,
      "snapshot-a",
      new Map([
        [tsSourcePath, "0"],
        [tsxSourcePath, "1"],
      ]),
    );
    const manifestRoot = getCycleManifestCacheDir(tmpDir);
    const tsEntryPath = transaction.registerEdge(tsSourcePath, tsSourcePath, true);
    const tsxArtifactPath = transaction.registerEdge(tsxSourcePath, tsxSourcePath, false);
    const tsArtifactPath = transaction.reserveArtifactPath(tsSourcePath);

    try {
      await Deno.mkdir(join(manifestRoot, "0-snapshot-a/artifacts"), {
        recursive: true,
      });
      await Deno.writeTextFile(tsxArtifactPath, `export default "tsx";`);
      transaction.recordArtifact(tsxSourcePath, tsxArtifactPath, true);
      await Deno.writeTextFile(
        tsArtifactPath,
        await transaction.sealRootArtifactCode(
          `export const kind = "ts";`,
          tsSourcePath,
          false,
          localAdapter,
        ),
      );
      transaction.recordArtifact(tsSourcePath, tsArtifactPath, false, true);

      let published = false;
      transaction.deferCachePublication(async () => {
        assertEquals(await localAdapter.fs.exists(tsEntryPath), true);
        assertEquals(await localAdapter.fs.exists(tsxArtifactPath), true);
        published = true;
      });

      await transaction.commit(localAdapter);

      assertNotEquals(tsEntryPath, tsxArtifactPath);
      assertStringIncludes(await Deno.readTextFile(tsEntryPath), basename(tsArtifactPath));
      assertEquals(await Deno.readTextFile(tsxArtifactPath), `export default "tsx";`);
      assertStringIncludes(await Deno.readTextFile(tsEntryPath), `export function then`);
      assertEquals(await localAdapter.fs.exists(join(tmpDir, "app/page.js")), false);
      assertEquals(published, true);
    } finally {
      await removeFixture(tmpDir);
    }
  });

  it("fails closed before publication when its manifest directory cannot persist", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "vf-cycle-manifest-" });
    const localAdapter = await getLocalAdapter();
    const transaction = new CycleManifestTransaction(tmpDir, "mkdir-failure");
    const sourcePath = join(tmpDir, "project/app/page.ts");
    const manifestRoot = getCycleManifestCacheDir(tmpDir);
    const artifactPath = join(manifestRoot, "0-mkdir-failure/artifacts/0.aaaa1111.js");
    transaction.registerEdge(sourcePath, sourcePath, true);
    await Deno.mkdir(join(manifestRoot, "0-mkdir-failure/artifacts"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      artifactPath,
      await transaction.sealRootArtifactCode(
        `export const value = true;`,
        sourcePath,
        false,
        localAdapter,
      ),
    );
    transaction.recordArtifact(sourcePath, artifactPath, false, true);
    let published = false;
    transaction.deferCachePublication(() => {
      published = true;
      return Promise.resolve();
    });

    const stubFs = Object.create(localAdapter.fs) as typeof localAdapter.fs;
    stubFs.mkdir = () => Promise.reject(new Error("ENOSPC: manifest directory"));
    const stubAdapter = Object.create(localAdapter) as typeof localAdapter;
    Object.defineProperty(stubAdapter, "fs", { value: stubFs });

    try {
      const error = await assertRejects(() => transaction.commit(stubAdapter), VeryfrontError);
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "cache-error");
      assertEquals(published, false);
    } finally {
      await removeFixture(tmpDir);
    }
  });

  it("rejects a graph root whose persisted bytes lost their sealed evidence", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "vf-cycle-manifest-missing-evidence-" });
    const localAdapter = await getLocalAdapter();
    const transaction = new CycleManifestTransaction(tmpDir, "missing-evidence");
    const rootSource = "/project/root.ts";
    const rootArtifact = transaction.registerEdge(rootSource, rootSource, false);

    try {
      await Deno.mkdir(dirname(rootArtifact), { recursive: true });
      await transaction.sealRootArtifactCode(
        "export const root = true;",
        rootSource,
        false,
        localAdapter,
      );
      await Deno.writeTextFile(rootArtifact, "export const root = true;");
      transaction.recordArtifact(rootSource, rootArtifact, false, true);

      await assertRejects(
        () => transaction.commit(localAdapter),
        VeryfrontError,
        "Cycle manifest root evidence is missing",
      );
    } finally {
      await removeFixture(tmpDir);
    }
  });

  it("rejects graph root bytes changed after sealing", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "vf-cycle-manifest-changed-root-" });
    const localAdapter = await getLocalAdapter();
    const transaction = new CycleManifestTransaction(tmpDir, "changed-root");
    const rootSource = "/project/root.ts";
    const rootArtifact = transaction.registerEdge(rootSource, rootSource, false);

    try {
      await Deno.mkdir(dirname(rootArtifact), { recursive: true });
      const sealed = await transaction.sealRootArtifactCode(
        "export const root = true;",
        rootSource,
        false,
        localAdapter,
      );
      await Deno.writeTextFile(
        rootArtifact,
        sealed.replace("root = true", "root = false"),
      );
      transaction.recordArtifact(rootSource, rootArtifact, false, true);

      await assertRejects(
        () => transaction.commit(localAdapter),
        VeryfrontError,
        "Cycle manifest changed after its root was sealed",
      );
    } finally {
      await removeFixture(tmpDir);
    }
  });

  it("binds the complete entry set to the root artifact", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "vf-cycle-manifest-complete-" });
    const localAdapter = await getLocalAdapter();
    const transaction = new CycleManifestTransaction(tmpDir, "complete");
    const rootSource = "/project/root.ts";
    const otherSource = "/project/other.ts";
    const manifestRoot = getCycleManifestCacheDir(tmpDir);
    const rootArtifact = join(manifestRoot, "0-complete/artifacts/0.aaaa1111.js");
    const otherArtifact = join(manifestRoot, "0-complete/artifacts/1.bbbb2222.js");
    const firstEntry = transaction.registerEdge(rootSource, rootSource, true);
    transaction.registerEdge(otherSource, otherSource, true);

    try {
      await Deno.mkdir(join(manifestRoot, "0-complete/artifacts"), {
        recursive: true,
      });
      await Deno.writeTextFile(otherArtifact, `export const other = true;`);
      transaction.recordArtifact(otherSource, otherArtifact, false);
      await Deno.writeTextFile(
        rootArtifact,
        await transaction.sealRootArtifactCode(
          `export const root = true;`,
          rootSource,
          false,
          localAdapter,
        ),
      );
      transaction.recordArtifact(rootSource, rootArtifact, false, true);
      await transaction.commit(localAdapter);

      const sidecarPath = `${rootArtifact}${CYCLE_MANIFEST_SIDECAR_SUFFIX}`;
      const sidecar = JSON.parse(await Deno.readTextFile(sidecarPath));
      sidecar.entries = sidecar.entries.slice(1);
      await Deno.writeTextFile(sidecarPath, JSON.stringify(sidecar));
      await Deno.remove(firstEntry);

      assertEquals(
        await inspectCycleManifestCache(rootArtifact, tmpDir, localAdapter),
        "invalid",
      );
    } finally {
      await removeFixture(tmpDir);
    }
  });

  it("rejects a sidecar whose entry is coherently retargeted", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "vf-cycle-manifest-retarget-" });
    const localAdapter = await getLocalAdapter();
    const transaction = new CycleManifestTransaction(tmpDir, "retarget");
    const rootSource = "/project/root.ts";
    const otherSource = "/project/other.ts";
    const manifestRoot = getCycleManifestCacheDir(tmpDir);
    const rootArtifact = join(manifestRoot, "0-retarget/artifacts/0.aaaa1111.js");
    const otherArtifact = join(manifestRoot, "0-retarget/artifacts/1.bbbb2222.js");
    const entryPath = transaction.registerEdge(otherSource, rootSource, true);
    transaction.markCycleBound(otherSource);

    try {
      await Deno.mkdir(join(manifestRoot, "0-retarget/artifacts"), {
        recursive: true,
      });
      await Deno.writeTextFile(otherArtifact, `export const other = true;`);
      transaction.recordArtifact(otherSource, otherArtifact, false);
      await Deno.writeTextFile(
        rootArtifact,
        await transaction.sealRootArtifactCode(
          `export const root = true;`,
          rootSource,
          false,
          localAdapter,
        ),
      );
      transaction.recordArtifact(rootSource, rootArtifact, false, true);
      await transaction.commit(localAdapter);

      const sidecarPath = `${rootArtifact}${CYCLE_MANIFEST_SIDECAR_SUFFIX}`;
      const sidecar = JSON.parse(await Deno.readTextFile(sidecarPath));
      sidecar.entries[0][1] = sidecar.root;
      await Deno.writeTextFile(sidecarPath, JSON.stringify(sidecar));
      await Deno.writeTextFile(
        entryPath,
        [
          "export function then(resolve, reject) {",
          '  return import("./artifacts/0.aaaa1111.js").then(resolve, reject);',
          "}",
        ].join("\n"),
      );

      assertEquals(
        await inspectCycleManifestCache(rootArtifact, tmpDir, localAdapter),
        "invalid",
      );
    } finally {
      await removeFixture(tmpDir);
    }
  });

  it("persists one canonical manifest instead of duplicating it per member", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "vf-cycle-manifest-linear-" });
    const localAdapter = await getLocalAdapter();
    const transaction = new CycleManifestTransaction(tmpDir, "linear");
    const artifactPaths: string[] = [];

    try {
      const manifestRoot = getCycleManifestCacheDir(tmpDir);
      await Deno.mkdir(join(manifestRoot, "0-linear/artifacts"), {
        recursive: true,
      });
      for (let index = 0; index < 40; index++) {
        const sourcePath = `/project/module-${index}.ts`;
        const artifactPath = join(
          manifestRoot,
          `0-linear/artifacts/${index.toString(36)}.deadbeef.js`,
        );
        transaction.registerEdge(sourcePath, sourcePath, true);
        await Deno.writeTextFile(
          artifactPath,
          transaction.markMemberArtifactCode(`export const value = ${index};`),
        );
        transaction.recordArtifact(sourcePath, artifactPath, false, index === 0);
        artifactPaths.push(artifactPath);
      }
      await Deno.writeTextFile(
        artifactPaths[0]!,
        await transaction.sealRootArtifactCode(
          `export const value = 0;`,
          "/project/module-0.ts",
          false,
          localAdapter,
        ),
      );
      await transaction.commit(localAdapter);

      let sidecarCount = 0;
      for (const artifactPath of artifactPaths) {
        if (await localAdapter.fs.exists(`${artifactPath}${CYCLE_MANIFEST_SIDECAR_SUFFIX}`)) {
          sidecarCount++;
        }
      }
      assertEquals(sidecarCount, 1);
    } finally {
      await removeFixture(tmpDir);
    }
  });
});
