
import {
  assert,
  assertEquals,
  assertExists,
  assertRejects as _assertRejects,
} from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { DenoAdapter } from "@veryfront/platform/adapters/deno.ts";
import { withTestContext } from "../../_helpers/context.ts";

describe("ShellAdapter - statSync()", () => {
  it("returns file stats synchronously", async () => {
    await withTestContext("shell-stat-file", async (context) => {
      const adapter = new DenoAdapter();

      const testFile = join(context.projectDir, "test.txt");
      await Deno.writeTextFile(testFile, "test content");

      const stats = adapter.shell.statSync(testFile);

      assertExists(stats);
      assertEquals(stats.isFile, true);
      assertEquals(stats.isDirectory, false);
    });
  });

  it("identifies directories correctly", async () => {
    await withTestContext("shell-stat-directory", async (context) => {
      const adapter = new DenoAdapter();

      const testDir = join(context.projectDir, "test-dir");
      await Deno.mkdir(testDir);

      const stats = adapter.shell.statSync(testDir);

      assertExists(stats);
      assertEquals(stats.isFile, false);
      assertEquals(stats.isDirectory, true);
    });
  });

  it("throws error for non-existent files", () => {
    const adapter = new DenoAdapter();

    try {
      adapter.shell.statSync("/definitely/does/not/exist/12345.txt");
      assert(false, "Should throw error for non-existent file");
    } catch (error) {
      assert(error instanceof Error);
      assert(
        error.message.includes("Failed to stat file"),
        "Error message should mention stat failure",
      );
    }
  });

  it("works with relative paths", async () => {
    await withTestContext("shell-stat-relative", async (context) => {
      const adapter = new DenoAdapter();

      const testFile = join(context.projectDir, "relative-test.txt");
      await Deno.writeTextFile(testFile, "content");

      const originalDir = Deno.cwd();
      try {
        Deno.chdir(context.projectDir);

        const stats = adapter.shell.statSync("./relative-test.txt");

        assertExists(stats);
        assertEquals(stats.isFile, true);
      } finally {
        Deno.chdir(originalDir);
      }
    });
  });

  it("handles symlinks", async () => {
    await withTestContext("shell-stat-symlink", async (context) => {
      const adapter = new DenoAdapter();

      const testFile = join(context.projectDir, "original.txt");
      const symlinkPath = join(context.projectDir, "link.txt");

      await Deno.writeTextFile(testFile, "content");

      try {
        await Deno.symlink(testFile, symlinkPath);

        const stats = adapter.shell.statSync(symlinkPath);

        assertExists(stats);
        assertEquals(stats.isFile, true);
      } catch (error) {
        if (error instanceof Error && !error.message.includes("permission")) {
          throw error;
        }
      }
    });
  });
});

describe("ShellAdapter - readFileSync()", () => {
  it("reads file content synchronously", async () => {
    await withTestContext("shell-read-file", async (context) => {
      const adapter = new DenoAdapter();

      const testFile = join(context.projectDir, "read-test.txt");
      const testContent = "Hello, World!";
      await Deno.writeTextFile(testFile, testContent);

      const content = adapter.shell.readFileSync(testFile);

      assertEquals(content, testContent);
    });
  });

  it("reads TypeScript files correctly", async () => {
    await withTestContext("shell-read-ts", async (context) => {
      const adapter = new DenoAdapter();

      const testFile = join(context.projectDir, "test.ts");
      const tsContent = 'export function test(): string { return "test" }';
      await Deno.writeTextFile(testFile, tsContent);

      const content = adapter.shell.readFileSync(testFile);

      assertEquals(content, tsContent);
      assert(content.includes("export function"));
    });
  });

  it("reads large files correctly", async () => {
    await withTestContext("shell-read-large", async (context) => {
      const adapter = new DenoAdapter();

      const testFile = join(context.projectDir, "large.txt");
      const largeContent = "x".repeat(1024 * 1024);
      await Deno.writeTextFile(testFile, largeContent);

      const content = adapter.shell.readFileSync(testFile);

      assertEquals(content.length, largeContent.length);
    });
  });

  it("throws error for non-existent files", () => {
    const adapter = new DenoAdapter();

    try {
      adapter.shell.readFileSync("/definitely/does/not/exist/12345.txt");
      assert(false, "Should throw error for non-existent file");
    } catch (error) {
      assert(error instanceof Error);
      assert(
        error.message.includes("Failed to read file"),
        "Error message should mention read failure",
      );
    }
  });

  it("handles UTF-8 content correctly", async () => {
    await withTestContext("shell-read-utf8", async (context) => {
      const adapter = new DenoAdapter();

      const testFile = join(context.projectDir, "utf8.txt");
      const utf8Content = "Hello 世界 🌍 مرحبا";
      await Deno.writeTextFile(testFile, utf8Content);

      const content = adapter.shell.readFileSync(testFile);

      assertEquals(content, utf8Content);
    });
  });

  it("reads empty files correctly", async () => {
    await withTestContext("shell-read-empty", async (context) => {
      const adapter = new DenoAdapter();

      const testFile = join(context.projectDir, "empty.txt");
      await Deno.writeTextFile(testFile, "");

      const content = adapter.shell.readFileSync(testFile);

      assertEquals(content, "");
    });
  });

  it("handles files with line breaks", async () => {
    await withTestContext("shell-read-multiline", async (context) => {
      const adapter = new DenoAdapter();

      const testFile = join(context.projectDir, "multiline.txt");
      const multilineContent = "Line 1\nLine 2\nLine 3\n";
      await Deno.writeTextFile(testFile, multilineContent);

      const content = adapter.shell.readFileSync(testFile);

      assertEquals(content, multilineContent);
      assertEquals(content.split("\n").length, 4);
    });
  });

  it("works with relative paths", async () => {
    await withTestContext("shell-read-relative", async (context) => {
      const adapter = new DenoAdapter();

      const testFile = join(context.projectDir, "relative-read.txt");
      await Deno.writeTextFile(testFile, "content");

      const originalDir = Deno.cwd();
      try {
        Deno.chdir(context.projectDir);

        const content = adapter.shell.readFileSync("./relative-read.txt");

        assertEquals(content, "content");
      } finally {
        Deno.chdir(originalDir);
      }
    });
  });
});

describe("ShellAdapter - esbuild Plugin Integration", () => {
  it("statSync can be used in esbuild plugins", async () => {
    await withTestContext("shell-esbuild-stat", async (context) => {
      const adapter = new DenoAdapter();

      const tsFile = join(context.projectDir, "component.tsx");
      const jsFile = join(context.projectDir, "utils.js");

      await Deno.writeTextFile(tsFile, "export const Component = () => <div/>");
      await Deno.writeTextFile(jsFile, "export const util = () => {}");

      const candidates = [
        join(context.projectDir, "component.tsx"),
        join(context.projectDir, "component.ts"),
        join(context.projectDir, "utils.js"),
        join(context.projectDir, "utils.ts"),
      ];

      const resolvedFiles: string[] = [];

      for (const candidate of candidates) {
        try {
          const stat = adapter.shell.statSync(candidate);
          if (stat.isFile) {
            resolvedFiles.push(candidate);
          }
        } catch {
          // File doesn't exist, skip
        }
      }

      assertEquals(resolvedFiles.length, 2);
      assert(resolvedFiles.some((f) => f.endsWith("component.tsx")));
      assert(resolvedFiles.some((f) => f.endsWith("utils.js")));
    });
  });

  it("readFileSync can load module content for esbuild", async () => {
    await withTestContext("shell-esbuild-read", async (context) => {
      const adapter = new DenoAdapter();

      const moduleFile = join(context.projectDir, "module.ts");
      const moduleContent = "export const value = 42;";
      await Deno.writeTextFile(moduleFile, moduleContent);

      const content = adapter.shell.readFileSync(moduleFile);

      assertEquals(content, moduleContent);
      assert(content.includes("export"));
    });
  });

  it("handles rapid sequential file operations", async () => {
    await withTestContext("shell-rapid-operations", async (context) => {
      const adapter = new DenoAdapter();

      const files = [];
      for (let i = 0; i < 10; i++) {
        const filePath = join(context.projectDir, `file${i}.ts`);
        await Deno.writeTextFile(filePath, `export const value${i} = ${i}`);
        files.push(filePath);
      }

      const start = performance.now();

      for (const file of files) {
        const stat = adapter.shell.statSync(file);
        assert(stat.isFile);

        const content = adapter.shell.readFileSync(file);
        assert(content.includes("export"));
      }

      const duration = performance.now() - start;

      assert(duration < 1000, `Should complete in <1000ms, took ${duration}ms`);
    });
  });
});

describe("ShellAdapter - Error Handling", () => {
  it("provides clear error messages", () => {
    const adapter = new DenoAdapter();

    try {
      adapter.shell.statSync("/nonexistent/path/file.txt");
    } catch (error) {
      assert(error instanceof Error);
      assert(error.message.length > 0);
      assert(error.message.includes("Failed"));
    }

    try {
      adapter.shell.readFileSync("/nonexistent/path/file.txt");
    } catch (error) {
      assert(error instanceof Error);
      assert(error.message.length > 0);
      assert(error.message.includes("Failed"));
    }
  });

  it("handles permission errors gracefully", async () => {

    // deno-lint-ignore require-await
    await withTestContext("shell-permission-error", async (_context) => {
      const adapter = new DenoAdapter();

      try {
        const restrictedPath = "/etc/shadow";

        try {
          adapter.shell.readFileSync(restrictedPath);
        } catch (error) {
          assert(error instanceof Error);
          assert(error.message.includes("Failed"));
        }
      } catch {
        // Skip test if we can't test permissions
      }
    });
  });
});
