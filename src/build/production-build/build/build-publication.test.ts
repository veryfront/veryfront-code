import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createFileSystem, type FileSystem } from "#veryfront/platform/compat/fs.ts";
import { createBuildPublication } from "./build-publication.ts";

describe("build/production-build/build/build-publication", () => {
  it("replaces a previous output only when the staged build is published", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-build-publication-" });
    const outputDir = `${root}/dist`;
    await Deno.mkdir(outputDir);
    await Deno.writeTextFile(`${outputDir}/version.txt`, "old");

    const publication = await createBuildPublication(outputDir, false);
    try {
      await Deno.mkdir(publication.buildDir);
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
      await Deno.mkdir(publication.buildDir);
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
    await Deno.mkdir(publication.buildDir);
    try {
      await assertRejects(
        () => publication.cleanup(),
        Error,
        "Failed to remove abandoned build staging directory",
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
      await Deno.mkdir(publication.buildDir);
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
      await Deno.mkdir(publication.buildDir);
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
      await Deno.mkdir(publication.buildDir);
      await Deno.writeTextFile(`${publication.buildDir}/version.txt`, "new");
      await assertRejects(
        () => publication.publish(),
        Error,
        "Failed to publish staged build output",
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

  it("does not create staging or lock artifacts for dry runs", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-build-publication-" });
    const outputDir = `${root}/dist`;
    try {
      const publication = await createBuildPublication(outputDir, true);
      assertEquals(publication.buildDir, outputDir);
      await publication.publish();
      await publication.cleanup();
      assertEquals([...Deno.readDirSync(root)].length, 0);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});
