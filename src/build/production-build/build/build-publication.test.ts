import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createFileSystem, type FileSystem } from "#veryfront/platform/compat/fs.ts";
import { createBuildPublication, nativeBuildPublicationLock } from "./build-publication.ts";

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

      await publication.cleanup();
      assertEquals(
        [...Deno.readDirSync(root)].map((entry) => entry.name).sort(),
        ["dist"],
        "publication leaves no backup, stage, or lock artifacts beside the output",
      );
    } finally {
      await publication.cleanup();
      await Deno.remove(root, { recursive: true });
    }
  });

  it("refuses to release a build output lock it no longer owns", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-build-publication-" });
    const lockPath = `${root}/build.lock`;
    const foreignLock = '{"token":"foreign"}\n';
    try {
      const release = await nativeBuildPublicationLock.acquire(lockPath, 1_000);
      await Deno.writeTextFile(lockPath, foreignLock);

      await assertRejects(
        () => release(),
        Error,
        "Build output lock ownership changed unexpectedly",
      );
      assertEquals(
        await Deno.readTextFile(lockPath),
        foreignLock,
        "a build must not remove a lock it no longer owns",
      );
    } finally {
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
      lock: nativeBuildPublicationLock,
    });
    await Deno.mkdir(publication.buildDir);
    try {
      await assertRejects(
        () => publication.cleanup(),
        Error,
        "transient removal failure",
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
      lock: nativeBuildPublicationLock,
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

  it("requires custom filesystems to provide matching lock authority", async () => {
    const delegate = createFileSystem();
    await assertRejects(
      () => createBuildPublication("dist", false, { fs: delegate }),
      Error,
      "require a matching lock provider",
    );
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
