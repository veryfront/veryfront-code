import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createFileSystem, type FileSystem } from "#veryfront/platform/compat/fs.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createBuildPublication } from "./build-publication.ts";
import { setupBuildDirectories } from "./build-setup.ts";

function createAdapter(fs: FileSystem = createFileSystem()): RuntimeAdapter {
  return { name: "test", fs } as unknown as RuntimeAdapter;
}

describe("build/production-build/build/build-setup", () => {
  describe("setupBuildDirectories", () => {
    it("creates only the intended children inside an owned stage", async () => {
      const root = await Deno.makeTempDir();
      const fs = createFileSystem();
      const adapter = createAdapter(fs);
      const publication = await createBuildPublication(`${root}/dist`, false, { fs });
      try {
        if (publication.dryRun) throw new Error("Expected a live publication");
        await setupBuildDirectories(adapter, {
          dryRun: false,
          output: publication.outputOwnership,
        });

        for (
          const relativePath of [
            "_veryfront",
            "_veryfront/chunks",
            "_veryfront/data",
            "assets",
          ]
        ) {
          assertEquals(
            (await Deno.stat(`${publication.buildDir}/${relativePath}`)).isDirectory,
            true,
          );
        }
      } finally {
        await publication.cleanup();
        await Deno.remove(root, { recursive: true });
      }
    });

    it("performs no filesystem operation in a dry run", async () => {
      const operations: string[] = [];
      const delegate = createFileSystem();
      const fs = new Proxy(delegate, {
        get(target, property) {
          const value = Reflect.get(target, property);
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            operations.push(String(property));
            return Reflect.apply(value, target, args);
          };
        },
      }) as FileSystem;

      await setupBuildDirectories(createAdapter(fs), { dryRun: true });
      assertEquals(operations, []);
    });

    it("never removes or recreates the owned stage root", async () => {
      const root = await Deno.makeTempDir();
      const delegate = createFileSystem();
      const removed: string[] = [];
      const created: Array<{ path: string; recursive: boolean }> = [];
      const fs = new Proxy(delegate, {
        get(target, property) {
          if (property === "remove") {
            return async (path: string, options?: { recursive?: boolean }): Promise<void> => {
              removed.push(path);
              await target.remove(path, options);
            };
          }
          if (property === "mkdir") {
            return async (path: string, options?: { recursive?: boolean }): Promise<void> => {
              created.push({ path, recursive: options?.recursive ?? false });
              await target.mkdir(path, options);
            };
          }
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as FileSystem;
      const publication = await createBuildPublication(`${root}/dist`, false, { fs });
      try {
        if (publication.dryRun) throw new Error("Expected a live publication");
        removed.length = 0;
        created.length = 0;

        await setupBuildDirectories(createAdapter(fs), {
          dryRun: false,
          output: publication.outputOwnership,
        });

        assertEquals(removed, []);
        assertEquals(created, [
          { path: `${publication.buildDir}/_veryfront`, recursive: false },
          { path: `${publication.buildDir}/_veryfront/chunks`, recursive: false },
          { path: `${publication.buildDir}/_veryfront/data`, recursive: false },
          { path: `${publication.buildDir}/assets`, recursive: false },
        ]);
      } finally {
        await publication.cleanup();
        await Deno.remove(root, { recursive: true });
      }
    });

    it("rejects ownership created by another filesystem object", async () => {
      const root = await Deno.makeTempDir();
      const publicationFs = createFileSystem();
      const publication = await createBuildPublication(`${root}/dist`, false, {
        fs: publicationFs,
      });
      try {
        if (publication.dryRun) throw new Error("Expected a live publication");
        await assertRejects(
          () =>
            setupBuildDirectories(createAdapter(createFileSystem()), {
              dryRun: false,
              output: publication.outputOwnership,
            }),
          Error,
          "belongs to another filesystem",
        );
      } finally {
        await publication.cleanup();
        await Deno.remove(root, { recursive: true });
      }
    });

    it("does not recreate a missing owned stage through child creation", async () => {
      const root = await Deno.makeTempDir();
      const fs = createFileSystem();
      const publication = await createBuildPublication(`${root}/dist`, false, { fs });
      try {
        if (publication.dryRun) throw new Error("Expected a live publication");
        await Deno.remove(publication.buildDir, { recursive: true });

        await assertRejects(() =>
          setupBuildDirectories(createAdapter(fs), {
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

    it("reuses compatible child directories inside the live stage", async () => {
      const root = await Deno.makeTempDir();
      const fs = createFileSystem();
      const publication = await createBuildPublication(`${root}/dist`, false, { fs });
      try {
        if (publication.dryRun) throw new Error("Expected a live publication");
        const target = {
          dryRun: false as const,
          output: publication.outputOwnership,
        };
        await setupBuildDirectories(createAdapter(fs), target);
        await setupBuildDirectories(createAdapter(fs), target);
        assertEquals(
          (await Deno.stat(`${publication.buildDir}/assets`)).isDirectory,
          true,
        );
      } finally {
        await publication.cleanup();
        await Deno.remove(root, { recursive: true });
      }
    });

    it("rejects file and terminal-symlink child collisions without deleting them", async () => {
      for (const collision of ["file", "symlink"] as const) {
        const root = await Deno.makeTempDir();
        const fs = createFileSystem();
        const publication = await createBuildPublication(`${root}/dist`, false, { fs });
        const child = `${publication.buildDir}/_veryfront`;
        const outside = `${root}/outside`;
        try {
          if (publication.dryRun) throw new Error("Expected a live publication");
          if (collision === "file") {
            await Deno.writeTextFile(child, "sentinel");
          } else {
            await Deno.mkdir(outside);
            await Deno.symlink(outside, child);
          }

          await assertRejects(() =>
            setupBuildDirectories(createAdapter(fs), {
              dryRun: false,
              output: publication.outputOwnership,
            })
          );
          const info = await Deno.lstat(child);
          assertEquals(collision === "file" ? info.isFile : info.isSymlink, true);
          if (collision === "file") {
            assertEquals(await Deno.readTextFile(child), "sentinel");
          }
        } finally {
          await publication.cleanup();
          await Deno.remove(root, { recursive: true });
        }
      }
    });
  });
});
