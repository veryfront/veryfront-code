import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolve } from "#veryfront/compat/path/index.ts";
import {
  copyStaticAssets,
  discoverStaticAssets,
  loadClientStyles,
  validateStaticBuildOutput,
} from "./asset-generation.ts";
import type { AssetStats } from "./asset-generation.ts";
import { type BuildPublication, createBuildPublication } from "./build/build-publication.ts";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { createMockAdapter as createBaseMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { FileSnapshotChangedError } from "#veryfront/platform/adapters/file-snapshot-error.ts";
import { STATIC_ASSET_MAX_BYTES } from "#veryfront/utils/constants/static-assets.ts";

function createMockAdapter(): ReturnType<typeof createBaseMockAdapter> {
  const adapter = createBaseMockAdapter();
  adapter.fs.rename = () => Promise.reject(new Error("mock publication was not expected"));
  adapter.fs.createFileBytesExclusive = (path, content) => {
    if (
      adapter.fs.byteFiles.has(path) || adapter.fs.files.has(path) ||
      adapter.fs.directories.has(path)
    ) {
      return Promise.reject(new Deno.errors.AlreadyExists(path));
    }
    adapter.fs.byteFiles.set(path, content.slice());
    return Promise.resolve();
  };
  return adapter;
}

async function createOwnedMockStage(
  adapter: ReturnType<typeof createMockAdapter>,
): Promise<{ publication: BuildPublication & { dryRun: false }; lockRoot: string }> {
  const lockRoot = await Deno.makeTempDir({ prefix: "vf-static-assets-stage-" });
  const publication = await createBuildPublication(`${lockRoot}/output`, false, {
    fs: adapter.fs,
  });
  if (publication.dryRun) throw new Error("Expected a live publication");
  return { publication, lockRoot };
}

async function cleanupOwnedMockStage(
  publication: BuildPublication,
  lockRoot: string,
): Promise<void> {
  await publication.cleanup().catch(() => undefined);
  await Deno.remove(lockRoot, { recursive: true }).catch(() => undefined);
}

describe("build/production-build/asset-generation", () => {
  describe("loadClientStyles", () => {
    it("returns the stable embedded error styles", () => {
      const styles = loadClientStyles();
      assertEquals(styles.length > 0, true);
      assertEquals(styles.includes(".error-container"), true);
      assertEquals(styles.includes(".prose"), false);
      assertEquals(loadClientStyles(), styles);
    });
  });

  describe("AssetStats type", () => {
    it("represents asset count and total bytes", () => {
      const stats: AssetStats = { assets: 15, totalSize: 1024000 };
      assertEquals(stats, { assets: 15, totalSize: 1024000 });
    });
  });

  describe("discoverStaticAssets", () => {
    it("returns an empty inventory when public is absent", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-static-assets-" });
      try {
        assertEquals(await discoverStaticAssets(denoAdapter, projectDir), []);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("rejects symbolic links instead of following them", async () => {
      const root = await Deno.makeTempDir({ prefix: "vf-static-assets-" });
      const projectDir = `${root}/project`;
      await Deno.mkdir(`${projectDir}/public`, { recursive: true });
      await Deno.writeTextFile(`${root}/outside.txt`, "secret");
      await Deno.symlink(`${root}/outside.txt`, `${projectDir}/public/link.txt`);
      try {
        await assertRejects(
          () => discoverStaticAssets(denoAdapter, projectDir),
          Error,
          "Symbolic links are not supported",
        );
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });

    it("rejects reserved and portable-colliding paths", async () => {
      const reserved = createMockAdapter();
      reserved.fs.files.set("/project/public/sw.js", "public");
      await assertRejects(
        () => discoverStaticAssets(reserved, "/project"),
        Error,
        "reserved for generated build output",
      );

      for (const names of [["Logo.svg", "logo.svg"], ["café.txt", "café.txt"]]) {
        const adapter = createMockAdapter();
        for (const name of names) adapter.fs.files.set(`/project/public/${name}`, name);
        await assertRejects(
          () => discoverStaticAssets(adapter, "/project"),
          Error,
          "portable path collision",
        );
      }
    });

    it("accepts the shared byte boundary and rejects one byte above it", async () => {
      const adapter = createMockAdapter();
      adapter.fs.byteFiles.set("/project/public/large.bin", new Uint8Array([1]));
      const stat = adapter.fs.stat.bind(adapter.fs);
      let declaredSize = STATIC_ASSET_MAX_BYTES;
      adapter.fs.stat = async (path) => {
        const info = await stat(path);
        return path === "/project/public/large.bin" ? { ...info, size: declaredSize } : info;
      };

      assertEquals((await discoverStaticAssets(adapter, "/project"))[0]?.size, declaredSize);
      declaredSize++;
      await assertRejects(
        () => discoverStaticAssets(adapter, "/project"),
        Error,
        `exceeds the ${STATIC_ASSET_MAX_BYTES}-byte static output limit`,
      );
    });
  });

  describe("copyStaticAssets", () => {
    it("copies binary assets into a real owned stage", async () => {
      const root = await Deno.makeTempDir({ prefix: "vf-static-assets-" });
      const projectDir = `${root}/project`;
      const bytes = new Uint8Array([0, 255, 1, 128, 2]);
      await Deno.mkdir(`${projectDir}/public/images`, { recursive: true });
      await Deno.writeFile(`${projectDir}/public/images/pixel.bin`, bytes);
      const publication = await createBuildPublication(`${root}/dist`, false, {
        fs: denoAdapter.fs,
      });
      try {
        if (publication.dryRun) throw new Error("Expected a live publication");
        const stats = await copyStaticAssets(denoAdapter, projectDir, {
          dryRun: false,
          output: publication.outputOwnership,
        });
        assertEquals(stats, { assets: 1, totalSize: bytes.byteLength });
        assertEquals(
          [...await Deno.readFile(`${publication.buildDir}/images/pixel.bin`)],
          [...bytes],
        );
      } finally {
        await publication.cleanup();
        await Deno.remove(root, { recursive: true });
      }
    });

    it("does not recreate a missing owned stage through child creation", async () => {
      const root = await Deno.makeTempDir({ prefix: "vf-static-assets-" });
      const projectDir = `${root}/project`;
      await Deno.mkdir(`${projectDir}/public/nested`, { recursive: true });
      await Deno.writeFile(`${projectDir}/public/nested/asset.bin`, new Uint8Array([1]));
      const publication = await createBuildPublication(`${root}/dist`, false, {
        fs: denoAdapter.fs,
      });
      try {
        if (publication.dryRun) throw new Error("Expected a live publication");
        await Deno.remove(publication.buildDir, { recursive: true });
        await assertRejects(() =>
          copyStaticAssets(denoAdapter, projectDir, {
            dryRun: false,
            output: publication.outputOwnership,
          })
        );
        await assertRejects(
          () => Deno.stat(publication.buildDir),
          Deno.errors.NotFound,
        );
      } finally {
        await publication.cleanup();
        await Deno.remove(root, { recursive: true });
      }
    });

    it("rejects a missing owned stage even when the public inventory is empty", async () => {
      const root = await Deno.makeTempDir({ prefix: "vf-static-assets-empty-stage-" });
      const projectDir = `${root}/project`;
      await Deno.mkdir(projectDir);
      const publication = await createBuildPublication(`${root}/dist`, false, {
        fs: denoAdapter.fs,
      });
      try {
        if (publication.dryRun) throw new Error("Expected a live publication");
        await Deno.remove(publication.buildDir, { recursive: true });
        await assertRejects(
          () =>
            copyStaticAssets(denoAdapter, projectDir, {
              dryRun: false,
              output: publication.outputOwnership,
            }),
          Error,
          "Owned build stage is not a safe existing directory",
        );
        await assertRejects(
          () => Deno.stat(publication.buildDir),
          Deno.errors.NotFound,
        );
      } finally {
        await publication.cleanup();
        await Deno.remove(root, { recursive: true });
      }
    });

    it("inventories a dry run without snapshot or exclusive-create authority", async () => {
      const adapter = createMockAdapter();
      adapter.fs.byteFiles.set("/project/public/robots.txt", new Uint8Array([1, 2]));
      let snapshotCalls = 0;
      let createCalls = 0;
      Object.defineProperty(adapter.fs, "readFileSnapshotWithinLimit", {
        configurable: true,
        get() {
          snapshotCalls++;
          throw new Error("snapshot authority must not be inspected");
        },
      });
      Object.defineProperty(adapter.fs, "createFileBytesExclusive", {
        configurable: true,
        get() {
          createCalls++;
          throw new Error("exclusive authority must not be inspected");
        },
      });

      assertEquals(
        await copyStaticAssets(adapter, "/project", { dryRun: true }),
        { assets: 1, totalSize: 2 },
      );
      assertEquals(snapshotCalls, 0);
      assertEquals(createCalls, 0);
    });

    it("uses the canonical public root, shared limit, and exclusive destination", async () => {
      const adapter = createMockAdapter();
      const sourcePath = "/project/public/images/pixel.bin";
      const bytes = new Uint8Array([1, 2, 3]);
      adapter.fs.byteFiles.set(sourcePath, bytes);
      const snapshotCalls: unknown[][] = [];
      const createCalls: Array<{ path: string; bytes: number[] }> = [];
      adapter.fs.readFileSnapshotWithinLimit = (path, root, byteLimit) => {
        snapshotCalls.push([path, root, byteLimit]);
        adapter.fs.stat = () => Promise.reject(new Error("post-discovery stat must not run"));
        return Promise.resolve(bytes);
      };
      adapter.fs.readFileBytes = () => Promise.reject(new Error("whole read must not run"));
      adapter.fs.readFileBytesWithinLimit = () =>
        Promise.reject(new Error("exact read must not run"));
      adapter.fs.writeFileBytes = () => Promise.reject(new Error("legacy write must not run"));
      adapter.fs.createFileBytesExclusive = (path, content) => {
        createCalls.push({ path, bytes: [...content] });
        adapter.fs.byteFiles.set(path, content.slice());
        return Promise.resolve();
      };
      const { publication, lockRoot } = await createOwnedMockStage(adapter);
      try {
        await copyStaticAssets(adapter, "/project", {
          dryRun: false,
          output: publication.outputOwnership,
        });
        assertEquals(snapshotCalls, [[
          sourcePath,
          resolve("/project/public"),
          STATIC_ASSET_MAX_BYTES,
        ]]);
        assertEquals(createCalls, [{
          path: `${publication.buildDir}/images/pixel.bin`,
          bytes: [1, 2, 3],
        }]);
      } finally {
        await cleanupOwnedMockStage(publication, lockRoot);
      }
    });

    it("rejects growth and shrinkage reported by the stable snapshot", async () => {
      for (const returned of [new Uint8Array([1]), new Uint8Array([1, 2, 3])]) {
        const adapter = createMockAdapter();
        adapter.fs.byteFiles.set("/project/public/asset.bin", new Uint8Array([1, 2]));
        adapter.fs.readFileSnapshotWithinLimit = () => Promise.resolve(returned);
        let creates = 0;
        adapter.fs.createFileBytesExclusive = () => {
          creates++;
          return Promise.resolve();
        };
        const { publication, lockRoot } = await createOwnedMockStage(adapter);
        try {
          await assertRejects(
            () =>
              copyStaticAssets(adapter, "/project", {
                dryRun: false,
                output: publication.outputOwnership,
              }),
            Error,
            "changed size while being read",
          );
          assertEquals(creates, 0);
        } finally {
          await cleanupOwnedMockStage(publication, lockRoot);
        }
      }
    });

    it("preserves snapshot generation-change classification", async () => {
      const adapter = createMockAdapter();
      adapter.fs.byteFiles.set("/project/public/asset.bin", new Uint8Array([1]));
      adapter.fs.readFileSnapshotWithinLimit = () =>
        Promise.reject(new FileSnapshotChangedError("source replaced during snapshot"));
      const { publication, lockRoot } = await createOwnedMockStage(adapter);
      try {
        await assertRejects(
          () =>
            copyStaticAssets(adapter, "/project", {
              dryRun: false,
              output: publication.outputOwnership,
            }),
          FileSnapshotChangedError,
          "source replaced during snapshot",
        );
      } finally {
        await cleanupOwnedMockStage(publication, lockRoot);
      }
    });

    it("fails independently when snapshot or exclusive-create authority is absent", async () => {
      for (
        const [missing, detail] of [
          ["snapshot", "stable snapshot reads"],
          ["exclusive", "exclusive file creation"],
        ] as const
      ) {
        const adapter = createMockAdapter();
        adapter.fs.byteFiles.set("/project/public/asset.bin", new Uint8Array([1]));
        if (missing === "snapshot") delete adapter.fs.readFileSnapshotWithinLimit;
        if (missing === "exclusive") delete adapter.fs.createFileBytesExclusive;
        adapter.fs.readFileBytesWithinLimit = () => {
          throw new Error("legacy exact read must not run");
        };
        adapter.fs.writeFileBytes = () => {
          throw new Error("legacy write must not run");
        };
        const { publication, lockRoot } = await createOwnedMockStage(adapter);
        try {
          await assertRejects(
            () =>
              copyStaticAssets(adapter, "/project", {
                dryRun: false,
                output: publication.outputOwnership,
              }),
            Error,
            detail,
          );
        } finally {
          await cleanupOwnedMockStage(publication, lockRoot);
        }
      }
    });

    it("rejects a destination inserted after preflight without changing it", async () => {
      const adapter = createMockAdapter();
      const sourcePath = "/project/public/asset.bin";
      adapter.fs.byteFiles.set(sourcePath, new Uint8Array([1]));
      const { publication, lockRoot } = await createOwnedMockStage(adapter);
      const destination = `${publication.buildDir}/asset.bin`;
      adapter.fs.readFileSnapshotWithinLimit = () => {
        adapter.fs.byteFiles.set(destination, new Uint8Array([9]));
        return Promise.resolve(new Uint8Array([1]));
      };
      try {
        await assertRejects(
          () =>
            copyStaticAssets(adapter, "/project", {
              dryRun: false,
              output: publication.outputOwnership,
            }),
          Error,
          "destination changed before exclusive creation",
        );
        assertEquals([...(adapter.fs.byteFiles.get(destination) ?? [])], [9]);
      } finally {
        await cleanupOwnedMockStage(publication, lockRoot);
      }
    });

    it("does no per-path rollback when a later exclusive create fails", async () => {
      const adapter = createMockAdapter();
      adapter.fs.byteFiles.set("/project/public/a.bin", new Uint8Array([1]));
      adapter.fs.byteFiles.set("/project/public/b.bin", new Uint8Array([2]));
      const { publication, lockRoot } = await createOwnedMockStage(adapter);
      const remove = adapter.fs.remove.bind(adapter.fs);
      const removed: string[] = [];
      adapter.fs.remove = (path, options) => {
        removed.push(path);
        return remove(path, options);
      };
      let creates = 0;
      adapter.fs.createFileBytesExclusive = (path, content) => {
        creates++;
        if (creates === 2) return Promise.reject(new Error("storage unavailable"));
        adapter.fs.byteFiles.set(path, content.slice());
        return Promise.resolve();
      };
      try {
        await assertRejects(
          () =>
            copyStaticAssets(adapter, "/project", {
              dryRun: false,
              output: publication.outputOwnership,
            }),
          Error,
          "storage unavailable",
        );
        assertEquals(removed, []);
        assertEquals(
          [...(adapter.fs.byteFiles.get(`${publication.buildDir}/a.bin`) ?? [])],
          [1],
        );
        assertEquals(adapter.fs.byteFiles.has(`${publication.buildDir}/b.bin`), false);

        await publication.cleanup();
        assertEquals(removed, [publication.buildDir]);
        assertEquals(adapter.fs.byteFiles.has(`${publication.buildDir}/a.bin`), false);
      } finally {
        await cleanupOwnedMockStage(publication, lockRoot);
      }
    });

    it("reuses only compatible directories inside the owned stage", async () => {
      const compatible = createMockAdapter();
      compatible.fs.byteFiles.set(
        "/project/public/images/asset.bin",
        new Uint8Array([1]),
      );
      const owned = await createOwnedMockStage(compatible);
      try {
        compatible.fs.directories.add(`${owned.publication.buildDir}/images`);
        await copyStaticAssets(compatible, "/project", {
          dryRun: false,
          output: owned.publication.outputOwnership,
        });
        assertEquals(
          [
            ...(compatible.fs.byteFiles.get(
              `${owned.publication.buildDir}/images/asset.bin`,
            ) ?? []),
          ],
          [1],
        );
      } finally {
        await cleanupOwnedMockStage(owned.publication, owned.lockRoot);
      }

      const incompatible = createMockAdapter();
      incompatible.fs.byteFiles.set(
        "/project/public/images/asset.bin",
        new Uint8Array([1]),
      );
      const blocked = await createOwnedMockStage(incompatible);
      const collision = `${blocked.publication.buildDir}/images`;
      try {
        incompatible.fs.byteFiles.set(collision, new Uint8Array([9]));
        await assertRejects(
          () =>
            copyStaticAssets(incompatible, "/project", {
              dryRun: false,
              output: blocked.publication.outputOwnership,
            }),
          Error,
          "collides with generated output",
        );
        assertEquals([...(incompatible.fs.byteFiles.get(collision) ?? [])], [9]);
      } finally {
        await cleanupOwnedMockStage(blocked.publication, blocked.lockRoot);
      }
    });

    it("rejects a terminal symlink directory collision without following or deleting it", async () => {
      const root = await Deno.makeTempDir({ prefix: "vf-static-assets-output-link-" });
      const projectDir = `${root}/project`;
      const outsideDir = `${root}/outside`;
      await Deno.mkdir(`${projectDir}/public/images`, { recursive: true });
      await Deno.mkdir(outsideDir);
      await Deno.writeTextFile(`${projectDir}/public/images/asset.bin`, "asset");
      await Deno.writeTextFile(`${outsideDir}/sentinel.txt`, "untouched");
      const publication = await createBuildPublication(`${root}/dist`, false, {
        fs: denoAdapter.fs,
      });
      if (publication.dryRun) throw new Error("Expected a live publication");
      const collision = `${publication.buildDir}/images`;
      await Deno.symlink(outsideDir, collision);
      try {
        await assertRejects(
          () =>
            copyStaticAssets(denoAdapter, projectDir, {
              dryRun: false,
              output: publication.outputOwnership,
            }),
          Error,
          "collides with generated output",
        );
        assertEquals((await Deno.lstat(collision)).isSymlink, true);
        assertEquals(await Deno.readTextFile(`${outsideDir}/sentinel.txt`), "untouched");
      } finally {
        await publication.cleanup().catch(() => undefined);
        await Deno.remove(root, { recursive: true });
      }
    });

    it("rejects a live token owned by another exact filesystem", async () => {
      const owner = createMockAdapter();
      const caller = createMockAdapter();
      const { publication, lockRoot } = await createOwnedMockStage(owner);
      try {
        await assertRejects(
          () =>
            copyStaticAssets(caller, "/project", {
              dryRun: false,
              output: publication.outputOwnership,
            }),
          Error,
          "belongs to another filesystem",
        );
      } finally {
        await cleanupOwnedMockStage(publication, lockRoot);
      }
    });
  });

  describe("validateStaticBuildOutput", () => {
    it("enforces the shared runtime limit without reading artifact bodies", async () => {
      const adapter = createMockAdapter();
      adapter.fs.byteFiles.set("/output/_veryfront/app.js", new Uint8Array([1]));
      const stat = adapter.fs.stat.bind(adapter.fs);
      let declaredSize = STATIC_ASSET_MAX_BYTES;
      adapter.fs.stat = async (path) => {
        const info = await stat(path);
        return path === "/output/_veryfront/app.js" ? { ...info, size: declaredSize } : info;
      };
      let reads = 0;
      adapter.fs.readFileBytes = () => {
        reads++;
        return Promise.resolve(new Uint8Array());
      };

      await validateStaticBuildOutput(adapter, "/output");
      assertEquals(reads, 0);
      declaredSize++;
      await assertRejects(
        () => validateStaticBuildOutput(adapter, "/output"),
        Error,
        `exceeds the ${STATIC_ASSET_MAX_BYTES}-byte static asset limit`,
      );
      assertEquals(reads, 0);
    });
  });
});
