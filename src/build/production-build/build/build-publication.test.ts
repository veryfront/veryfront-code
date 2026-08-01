import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createFileSystem, type FileSystem } from "#veryfront/platform/compat/fs.ts";
import { createBuildPublication, resolveBuildOutputOwnership } from "./build-publication.ts";

describe("build/production-build/build/build-publication", () => {
  it("replaces a previous output only when the staged build is published", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-build-publication-" });
    const outputDir = `${root}/dist`;
    await Deno.mkdir(outputDir);
    await Deno.writeTextFile(`${outputDir}/version.txt`, "old");

    const publication = await createBuildPublication(outputDir, false);
    try {
      await Deno.writeTextFile(`${publication.buildDir}/version.txt`, "new");
      assertEquals(await Deno.readTextFile(`${outputDir}/version.txt`), "old");

      await publication.publish();

      assertEquals(await Deno.readTextFile(`${outputDir}/version.txt`), "new");
    } finally {
      await publication.cleanup();
      await Deno.remove(root, { recursive: true });
    }
  });

  it("removes an abandoned stage and preserves the previous output", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-build-publication-" });
    const outputDir = `${root}/dist`;
    await Deno.mkdir(outputDir);
    await Deno.writeTextFile(`${outputDir}/version.txt`, "old");

    const publication = await createBuildPublication(outputDir, false);
    try {
      await Deno.writeTextFile(`${publication.buildDir}/partial.txt`, "partial");
    } finally {
      await publication.cleanup();
    }

    try {
      assertEquals(await Deno.readTextFile(`${outputDir}/version.txt`), "old");
      await assertRejects(
        () => Deno.stat(publication.buildDir),
        Deno.errors.NotFound,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("allows cleanup to be retried after a transient filesystem failure", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-build-publication-" });
    const outputDir = `${root}/dist`;
    const delegate = createFileSystem();
    let failStageRemoval = true;
    const flakyFs = new Proxy(delegate, {
      get(target, property) {
        if (property === "remove") {
          return async (path: string, options?: { recursive?: boolean }): Promise<void> => {
            if (path.includes(".veryfront-stage-") && failStageRemoval) {
              failStageRemoval = false;
              throw new Error("transient removal failure");
            }
            await target.remove(path, options);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as FileSystem;

    const publication = await createBuildPublication(outputDir, false, {
      fs: flakyFs,
    });
    try {
      await assertRejects(
        () => publication.cleanup(),
        Error,
        "Failed to remove abandoned build staging directory",
      );
      if (publication.dryRun) throw new Error("Expected a live publication");
      assertThrows(
        () => resolveBuildOutputOwnership(publication.outputOwnership, flakyFs),
        Error,
      );
      await publication.cleanup();
      await assertRejects(
        () => Deno.stat(publication.buildDir),
        Deno.errors.NotFound,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("surfaces and retries published-backup cleanup failures", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-build-publication-" });
    const outputDir = `${root}/dist`;
    await Deno.mkdir(outputDir);
    await Deno.writeTextFile(`${outputDir}/version.txt`, "old");
    const delegate = createFileSystem();
    let failBackupRemoval = true;
    const flakyFs = new Proxy(delegate, {
      get(target, property) {
        if (property === "remove") {
          return async (path: string, options?: { recursive?: boolean }): Promise<void> => {
            if (path.includes(".veryfront-backup-") && failBackupRemoval) {
              throw new Error("backup removal failed");
            }
            await target.remove(path, options);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as FileSystem;

    const publication = await createBuildPublication(outputDir, false, {
      fs: flakyFs,
    });
    try {
      await Deno.writeTextFile(`${publication.buildDir}/version.txt`, "new");
      await publication.publish();

      assertEquals(await Deno.readTextFile(`${outputDir}/version.txt`), "new");
      await assertRejects(
        () => publication.cleanup(),
        Error,
        "Failed to remove published build backup",
      );

      failBackupRemoval = false;
      await publication.cleanup();
      assertEquals(
        [...Deno.readDirSync(root)].some((entry) => entry.name.includes(".veryfront-backup-")),
        false,
      );
    } finally {
      failBackupRemoval = false;
      await publication.cleanup().catch(() => undefined);
      await Deno.remove(root, { recursive: true });
    }
  });

  it("coalesces concurrent publication attempts", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-build-publication-" });
    const outputDir = `${root}/dist`;
    const delegate = createFileSystem();
    let renameCalls = 0;
    let signalRenameStarted!: () => void;
    let releaseRename!: () => void;
    const renameStarted = new Promise<void>((resolvePromise) => {
      signalRenameStarted = resolvePromise;
    });
    const renameGate = new Promise<void>((resolvePromise) => {
      releaseRename = resolvePromise;
    });
    const delayedFs = new Proxy(delegate, {
      get(target, property) {
        if (property === "rename") {
          return async (from: string, to: string): Promise<void> => {
            renameCalls++;
            signalRenameStarted();
            await renameGate;
            await target.rename!(from, to);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as FileSystem;

    const publication = await createBuildPublication(outputDir, false, {
      fs: delayedFs,
    });
    try {
      await Deno.writeTextFile(`${publication.buildDir}/version.txt`, "new");

      const firstPublish = publication.publish();
      await renameStarted;
      const secondPublish = publication.publish();
      await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 0));
      assertEquals(renameCalls, 1);

      releaseRename();
      await Promise.all([firstPublish, secondPublish]);
      assertEquals(await Deno.readTextFile(`${outputDir}/version.txt`), "new");
    } finally {
      releaseRename();
      await publication.cleanup().catch(() => undefined);
      await Deno.remove(root, { recursive: true });
    }
  });

  it("releases the build lock when a staging cleanup probe fails", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-build-publication-" });
    const outputDir = `${root}/dist`;
    const delegate = createFileSystem();
    let failStageProbe = true;
    const flakyFs = new Proxy(delegate, {
      get(target, property) {
        if (property === "exists") {
          return async (path: string): Promise<boolean> => {
            if (path.includes(".veryfront-stage-") && failStageProbe) {
              throw new Error("stage probe failed");
            }
            return await target.exists(path);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as FileSystem;

    const first = await createBuildPublication(outputDir, false, {
      fs: flakyFs,
    });
    let second: Awaited<ReturnType<typeof createBuildPublication>> | undefined;
    try {
      await assertRejects(
        () => first.cleanup(),
        Error,
        "Failed to remove abandoned build staging directory",
      );

      second = await createBuildPublication(outputDir, false, {
        lockTimeoutMs: 25,
      });
      failStageProbe = false;
      await first.cleanup();
    } finally {
      failStageProbe = false;
      await second?.cleanup().catch(() => undefined);
      await first.cleanup().catch(() => undefined);
      await Deno.remove(root, { recursive: true });
    }
  });

  it("rolls back the previous output when stage promotion fails", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-build-publication-" });
    const outputDir = `${root}/dist`;
    await Deno.mkdir(outputDir);
    await Deno.writeTextFile(`${outputDir}/version.txt`, "old");
    const delegate = createFileSystem();
    let renameCalls = 0;
    const failingFs = new Proxy(delegate, {
      get(target, property) {
        if (property === "rename") {
          return async (from: string, to: string): Promise<void> => {
            renameCalls++;
            if (renameCalls === 2) throw new Error("promotion failed");
            await target.rename!(from, to);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as FileSystem;

    const publication = await createBuildPublication(outputDir, false, {
      fs: failingFs,
    });
    try {
      await Deno.writeTextFile(`${publication.buildDir}/version.txt`, "new");
      await assertRejects(
        () => publication.publish(),
        Error,
        "Failed to publish staged build output",
      );
      if (publication.dryRun) throw new Error("Expected a live publication");
      assertThrows(
        () => resolveBuildOutputOwnership(publication.outputOwnership, failingFs),
        Error,
      );
      assertEquals(await Deno.readTextFile(`${outputDir}/version.txt`), "old");
    } finally {
      await publication.cleanup();
      await Deno.remove(root, { recursive: true });
    }
  });

  it("serializes concurrent builds targeting the same output", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-build-publication-" });
    const outputDir = `${root}/dist`;
    const first = await createBuildPublication(outputDir, false);
    try {
      await assertRejects(
        () =>
          createBuildPublication(outputDir, false, {
            lockTimeoutMs: 25,
          }),
        Error,
        "Timed out waiting for build output lock",
      );
    } finally {
      await first.cleanup();
      await Deno.remove(root, { recursive: true });
    }
  });

  it("acquires the output lock before creating one non-recursive stage", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-build-publication-" });
    const outputDir = `${root}/dist`;
    const delegate = createFileSystem();
    let stageMkdirCalls = 0;
    const orderedFs = new Proxy(delegate, {
      get(target, property) {
        if (property === "mkdir") {
          return async (path: string, options?: { recursive?: boolean }): Promise<void> => {
            if (path.includes(".veryfront-stage-")) {
              stageMkdirCalls++;
              assertEquals(options?.recursive ?? false, false);
              assert(
                [...Deno.readDirSync(root)].some((entry) =>
                  entry.name === ".dist.veryfront-build.lock"
                ),
              );
            }
            await target.mkdir(path, options);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as FileSystem;

    const publication = await createBuildPublication(outputDir, false, {
      fs: orderedFs,
    });
    try {
      assertEquals(stageMkdirCalls, 1);
      assertEquals((await Deno.stat(publication.buildDir)).isDirectory, true);
    } finally {
      await publication.cleanup();
      await Deno.remove(root, { recursive: true });
    }
  });

  it("preserves a colliding stage and releases its acquired lock", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-build-publication-" });
    const outputDir = `${root}/dist`;
    const delegate = createFileSystem();
    let collidingStage = "";
    const collidingFs = new Proxy(delegate, {
      get(target, property) {
        if (property === "mkdir") {
          return async (path: string, options?: { recursive?: boolean }): Promise<void> => {
            if (path.includes(".veryfront-stage-")) {
              collidingStage = path;
              await Deno.mkdir(path);
              await Deno.writeTextFile(`${path}/sentinel.txt`, "untouched");
            }
            await target.mkdir(path, options);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as FileSystem;

    await assertRejects(
      () => createBuildPublication(outputDir, false, { fs: collidingFs }),
      Error,
    );
    assertEquals(await Deno.readTextFile(`${collidingStage}/sentinel.txt`), "untouched");

    const next = await createBuildPublication(outputDir, false, {
      lockTimeoutMs: 25,
    });
    try {
      assertEquals((await Deno.stat(next.buildDir)).isDirectory, true);
    } finally {
      await next.cleanup();
      await Deno.remove(root, { recursive: true });
    }
  });

  it("reports both stage creation and lock release failures", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-build-publication-" });
    const outputDir = `${root}/dist`;
    const delegate = createFileSystem();
    const failingFs = new Proxy(delegate, {
      get(target, property) {
        if (property === "mkdir") {
          return async (path: string, options?: { recursive?: boolean }): Promise<void> => {
            if (path.includes(".veryfront-stage-")) {
              await Deno.writeTextFile(
                `${root}/.dist.veryfront-build.lock`,
                "ownership changed\n",
              );
              throw new Error("stage creation failed");
            }
            await target.mkdir(path, options);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as FileSystem;

    try {
      const error = await assertRejects(
        () => createBuildPublication(outputDir, false, { fs: failingFs }),
        AggregateError,
        "Build staging setup failed and lock release also failed",
      );
      assert(error instanceof AggregateError);
      assertEquals(error.errors.length, 2);
      assertEquals(
        String(error.errors[0]).includes("Failed to create build staging directory"),
        true,
      );
      assertEquals(String(error.errors[1]).includes("lock ownership changed unexpectedly"), true);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("binds a frozen opaque ownership token to its filesystem and generation", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-build-publication-" });
    const fs = createFileSystem();
    const first = await createBuildPublication(`${root}/first`, false, { fs });
    try {
      assertEquals(first.dryRun, false);
      if (first.dryRun) throw new Error("Expected a live publication");
      assertEquals(Object.getPrototypeOf(first.outputOwnership), null);
      assertEquals(Object.isFrozen(first.outputOwnership), true);
      assertEquals(Reflect.ownKeys(first.outputOwnership), []);
      assertEquals(
        resolveBuildOutputOwnership(first.outputOwnership, fs),
        first.buildDir,
      );
      const forged = Object.freeze(Object.create(null));
      const cloned = Object.freeze({ ...first.outputOwnership });
      const proxied = new Proxy(first.outputOwnership, {});
      for (const candidate of [forged, cloned, proxied]) {
        assertThrows(
          () => resolveBuildOutputOwnership(candidate, fs),
          Error,
        );
      }
      assertThrows(
        () => resolveBuildOutputOwnership(first.outputOwnership, createFileSystem()),
        Error,
      );
    } finally {
      await first.cleanup();
    }

    const second = await createBuildPublication(`${root}/second`, false, { fs });
    try {
      if (first.dryRun || second.dryRun) throw new Error("Expected live publications");
      assertThrows(
        () => resolveBuildOutputOwnership(first.outputOwnership, fs),
        Error,
      );
      assertEquals(
        resolveBuildOutputOwnership(second.outputOwnership, fs),
        second.buildDir,
      );
    } finally {
      await second.cleanup();
      await Deno.remove(root, { recursive: true });
    }
  });

  it("invalidates ownership synchronously when publication starts", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-build-publication-" });
    const fs = createFileSystem();
    const publication = await createBuildPublication(`${root}/dist`, false, { fs });
    try {
      if (publication.dryRun) throw new Error("Expected a live publication");
      await Deno.writeTextFile(`${publication.buildDir}/version.txt`, "new");
      const publishing = publication.publish();
      assertThrows(
        () => resolveBuildOutputOwnership(publication.outputOwnership, fs),
        Error,
      );
      await publishing;
    } finally {
      await publication.cleanup();
      await Deno.remove(root, { recursive: true });
    }
  });

  it("invalidates ownership synchronously when cleanup is requested", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-build-publication-" });
    const delegate = createFileSystem();
    let releaseRemoval!: () => void;
    const removalGate = new Promise<void>((resolvePromise) => {
      releaseRemoval = resolvePromise;
    });
    const gatedFs = new Proxy(delegate, {
      get(target, property) {
        if (property === "remove") {
          return async (path: string, options?: { recursive?: boolean }): Promise<void> => {
            if (path.includes(".veryfront-stage-")) await removalGate;
            await target.remove(path, options);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as FileSystem;
    const publication = await createBuildPublication(`${root}/dist`, false, {
      fs: gatedFs,
    });
    if (publication.dryRun) throw new Error("Expected a live publication");

    const cleanup = publication.cleanup();
    try {
      assertThrows(
        () => resolveBuildOutputOwnership(publication.outputOwnership, gatedFs),
        Error,
      );
    } finally {
      releaseRemoval();
      await cleanup;
      await Deno.remove(root, { recursive: true });
    }
  });

  it("does not create staging or lock artifacts for dry runs", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-build-publication-" });
    const outputDir = `${root}/dist`;
    const operations: string[] = [];
    const fs = new Proxy(createFileSystem(), {
      get(_target, property) {
        return (..._args: unknown[]) => {
          operations.push(String(property));
          throw new Error(`dry run invoked ${String(property)}`);
        };
      },
    }) as FileSystem;
    try {
      const publication = await createBuildPublication(outputDir, true, { fs });
      assertEquals(publication.buildDir, outputDir);
      assertEquals(publication.dryRun, true);
      assertEquals("outputOwnership" in publication, false);
      await publication.publish();
      await publication.cleanup();
      assertEquals(operations, []);
      assertEquals([...Deno.readDirSync(root)].length, 0);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});
