import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { createFileSystem, type FileSystem } from "#veryfront/platform/compat/fs.ts";
import { createBuildPublication } from "../../production-build/build/build-publication.ts";
import { writeCompiledFile } from "./file-writer.ts";

describe("build/compiler/mdx-compiler/file-writer", () => {
  describe("writeCompiledFile", () => {
    it("should write compiled file and return output path", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        const filePath = `${tmpDir}/pages/hello.mdx`;
        const code = "export default function Page() { return 'hello'; }";
        const options = {
          projectDir: tmpDir,
          outputDir: `${tmpDir}/.output`,
          mode: "production" as const,
        };

        const outputPath = await writeCompiledFile(filePath, code, options);

        assertEquals(
          outputPath.endsWith("pages/hello.js"),
          true,
          "should replace .mdx with .js in output path",
        );
        assertEquals(
          outputPath.startsWith(options.outputDir),
          true,
          "output should be under outputDir",
        );

        const written = await Deno.readTextFile(outputPath);
        assertEquals(written, code, "written content should match input code");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("should handle nested directory paths", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        const filePath = `${tmpDir}/pages/blog/post.mdx`;
        const code = "export default function Post() { return 'post'; }";
        const options = {
          projectDir: tmpDir,
          outputDir: `${tmpDir}/.output`,
          mode: "production" as const,
        };

        const outputPath = await writeCompiledFile(filePath, code, options);

        assertEquals(
          outputPath.endsWith("pages/blog/post.js"),
          true,
          "should preserve nested directory structure",
        );

        const written = await Deno.readTextFile(outputPath);
        assertEquals(written, code, "content should be written correctly");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("should create parent directories recursively", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        const filePath = `${tmpDir}/a/b/c/deep.mdx`;
        const code = "deep content";
        const options = {
          projectDir: tmpDir,
          outputDir: `${tmpDir}/.out`,
          mode: "development" as const,
        };

        const outputPath = await writeCompiledFile(filePath, code, options);

        const written = await Deno.readTextFile(outputPath);
        assertEquals(written, code, "should write to deeply nested path");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("should strip leading slash from relative path", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        const filePath = `${tmpDir}/pages/index.mdx`;
        const code = "index";
        const options = {
          projectDir: tmpDir,
          outputDir: `${tmpDir}/.output`,
          mode: "production" as const,
        };

        const outputPath = await writeCompiledFile(filePath, code, options);

        // Should not have double slashes from leading slash
        assertEquals(
          outputPath.includes("//"),
          false,
          "output path should not contain double slashes",
        );
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("rejects source paths outside the project instead of escaping the output", async () => {
      const tmpDir = await Deno.makeTempDir();
      const projectDir = `${tmpDir}/project`;
      const outsidePath = `${tmpDir}/outside.mdx`;
      await Deno.mkdir(projectDir);
      await Deno.writeTextFile(outsidePath, "# Outside");

      try {
        await assertRejects(
          () =>
            writeCompiledFile(outsidePath, "outside", {
              projectDir,
              outputDir: `${tmpDir}/output`,
              mode: "production",
            }),
          Error,
          "outside",
        );
        await assertRejects(
          () => Deno.stat(`${tmpDir}/output/outside.js`),
          Deno.errors.NotFound,
        );
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("rejects a source symlink that escapes the project", async () => {
      const tmpDir = await Deno.makeTempDir();
      const projectDir = `${tmpDir}/project`;
      const outsidePath = `${tmpDir}/outside.mdx`;
      const linkedPath = `${projectDir}/linked.mdx`;
      await Deno.mkdir(projectDir);
      await Deno.writeTextFile(outsidePath, "# Outside");
      await Deno.symlink(outsidePath, linkedPath);

      try {
        await assertRejects(
          () =>
            writeCompiledFile(linkedPath, "outside", {
              projectDir,
              outputDir: `${tmpDir}/output`,
              mode: "production",
            }),
          Error,
          "outside",
        );
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("does not leave temporary files after atomic publication", async () => {
      const tmpDir = await Deno.makeTempDir();
      const outputDir = `${tmpDir}/output`;
      try {
        await writeCompiledFile(`${tmpDir}/page.mdx`, "compiled", {
          projectDir: tmpDir,
          outputDir,
          mode: "production",
        });

        assertEquals(
          [...Deno.readDirSync(outputDir)].some((entry) => entry.name.includes(".tmp-")),
          false,
        );
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("uses owned authority and its exact filesystem for every output operation", async () => {
      const tmpDir = await Deno.makeTempDir();
      const delegate = createFileSystem();
      let stagePath: string | undefined;
      const ownedOperations: string[] = [];
      const fs = new Proxy(delegate, {
        get(target, property) {
          const value = Reflect.get(target, property);
          if (typeof value !== "function") return value;
          return async (...args: unknown[]): Promise<unknown> => {
            const firstPath = typeof args[0] === "string" ? args[0] : "";
            if (
              stagePath === undefined && property === "mkdir" &&
              firstPath.includes(".dist.veryfront-stage-")
            ) {
              stagePath = firstPath;
            } else if (stagePath !== undefined && firstPath.startsWith(stagePath)) {
              ownedOperations.push(String(property));
            }
            return await Reflect.apply(value, target, args);
          };
        },
      }) as FileSystem;
      const publication = await createBuildPublication(`${tmpDir}/dist`, false, { fs });
      if (publication.dryRun) throw new Error("Expected a live publication");
      try {
        const outputPath = await writeCompiledFile(
          `${tmpDir}/pages/blog/post.mdx`,
          "compiled",
          {
            projectDir: tmpDir,
            outputDir: `${tmpDir}/forged-output`,
            mode: "production",
          },
          {
            ownedOutput: {
              output: publication.outputOwnership,
              fileSystem: fs,
            },
          },
        );

        assertEquals(outputPath, `${publication.buildDir}/pages/blog/post.js`);
        for (const operation of ["lstat", "mkdir", "writeTextFile", "rename", "remove"]) {
          assertEquals(ownedOperations.includes(operation), true, `missing exact ${operation}`);
        }
        await assertRejects(() => Deno.lstat(`${tmpDir}/forged-output`), Deno.errors.NotFound);
      } finally {
        await publication.cleanup();
        await Deno.remove(tmpDir, { recursive: true });
      }
    });
  });
});
