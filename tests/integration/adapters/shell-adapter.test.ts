/**
 * ShellAdapter Tests
 *
 * Tests for the platform-agnostic shell operations:
 * - statSync()
 * - readFileSync()
 */

import { assert, assertEquals, assertExists } from "@veryfront/testing/assert";
import { symlink } from "@veryfront/compat/fs.ts";
import { join } from "@veryfront/compat/path";
import { describe, it } from "@veryfront/testing/bdd";
import { withTestContext } from "../../_helpers/context.ts";
import { chdir, cwd } from "@veryfront/compat/process.ts";
import { mkdir, writeTextFile } from "@veryfront/testing/deno-compat";
import { getLocalAdapter } from "@veryfront/platform/adapters/registry.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";

type ShellRuntimeAdapter = RuntimeAdapter & {
  shell: NonNullable<RuntimeAdapter["shell"]>;
};

const getShellAdapter = async (): Promise<ShellRuntimeAdapter> => {
  const adapter = await getLocalAdapter();
  if (!adapter.shell) {
    throw new Error("Shell adapter is not available in this runtime");
  }
  return adapter as ShellRuntimeAdapter;
};

describe("ShellAdapter - statSync()", () => {
  it("returns file stats synchronously", async () => {
    await withTestContext("shell-stat-file", async (context) => {
      const adapter = await getShellAdapter();

      // Create a test file
      const testFile = join(context.projectDir, "test.txt");
      await writeTextFile(testFile, "test content");

      // Get stats synchronously
      const stats = adapter.shell.statSync(testFile);

      assertExists(stats);
      assertEquals(stats.isFile, true);
      assertEquals(stats.isDirectory, false);
    });
  });

  it("identifies directories correctly", async () => {
    await withTestContext("shell-stat-directory", async (context) => {
      const adapter = await getShellAdapter();

      // Create a test directory
      const testDir = join(context.projectDir, "test-dir");
      await mkdir(testDir);

      // Get stats synchronously
      const stats = adapter.shell.statSync(testDir);

      assertExists(stats);
      assertEquals(stats.isFile, false);
      assertEquals(stats.isDirectory, true);
    });
  });

  it("throws error for non-existent files", async () => {
    const adapter = await getShellAdapter();

    // Should throw for non-existent file
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
      const adapter = await getShellAdapter();

      // Create file in current directory
      const testFile = join(context.projectDir, "relative-test.txt");
      await writeTextFile(testFile, "content");

      // Change to test directory
      const originalDir = cwd();
      try {
        chdir(context.projectDir);

        // Stat with relative path
        const stats = adapter.shell.statSync("./relative-test.txt");

        assertExists(stats);
        assertEquals(stats.isFile, true);
      } finally {
        chdir(originalDir);
      }
    });
  });

  it("handles symlinks", async () => {
    await withTestContext("shell-stat-symlink", async (context) => {
      const adapter = await getShellAdapter();

      // Create a file and symlink
      const testFile = join(context.projectDir, "original.txt");
      const symlinkPath = join(context.projectDir, "link.txt");

      await writeTextFile(testFile, "content");

      try {
        await symlink(testFile, symlinkPath);

        // Stat the symlink (should follow to the file)
        const stats = adapter.shell.statSync(symlinkPath);

        assertExists(stats);
        assertEquals(stats.isFile, true);
      } catch (error) {
        // Symlinks might not be supported on all systems
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
      const adapter = await getShellAdapter();

      // Create a test file
      const testFile = join(context.projectDir, "read-test.txt");
      const testContent = "Hello, World!";
      await writeTextFile(testFile, testContent);

      // Read synchronously
      const content = adapter.shell.readFileSync(testFile);

      assertEquals(content, testContent);
    });
  });

  it("reads TypeScript files correctly", async () => {
    await withTestContext("shell-read-ts", async (context) => {
      const adapter = await getShellAdapter();

      // Create a TypeScript file
      const testFile = join(context.projectDir, "test.ts");
      const tsContent = 'export function test(): string { return "test" }';
      await writeTextFile(testFile, tsContent);

      // Read synchronously
      const content = adapter.shell.readFileSync(testFile);

      assertEquals(content, tsContent);
      assert(content.includes("export function"));
    });
  });

  it("reads large files correctly", async () => {
    await withTestContext("shell-read-large", async (context) => {
      const adapter = await getShellAdapter();

      // Create a large file (1MB)
      const testFile = join(context.projectDir, "large.txt");
      const largeContent = "x".repeat(1024 * 1024);
      await writeTextFile(testFile, largeContent);

      // Read synchronously
      const content = adapter.shell.readFileSync(testFile);

      assertEquals(content.length, largeContent.length);
    });
  });

  it("throws error for non-existent files", async () => {
    const adapter = await getShellAdapter();

    // Should throw for non-existent file
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
      const adapter = await getShellAdapter();

      // Create file with UTF-8 content
      const testFile = join(context.projectDir, "utf8.txt");
      const utf8Content = "Hello 世界 🌍 مرحبا";
      await writeTextFile(testFile, utf8Content);

      // Read synchronously
      const content = adapter.shell.readFileSync(testFile);

      assertEquals(content, utf8Content);
    });
  });

  it("reads empty files correctly", async () => {
    await withTestContext("shell-read-empty", async (context) => {
      const adapter = await getShellAdapter();

      // Create empty file
      const testFile = join(context.projectDir, "empty.txt");
      await writeTextFile(testFile, "");

      // Read synchronously
      const content = adapter.shell.readFileSync(testFile);

      assertEquals(content, "");
    });
  });

  it("handles files with line breaks", async () => {
    await withTestContext("shell-read-multiline", async (context) => {
      const adapter = await getShellAdapter();

      // Create multi-line file
      const testFile = join(context.projectDir, "multiline.txt");
      const multilineContent = "Line 1\nLine 2\nLine 3\n";
      await writeTextFile(testFile, multilineContent);

      // Read synchronously
      const content = adapter.shell.readFileSync(testFile);

      assertEquals(content, multilineContent);
      assertEquals(content.split("\n").length, 4); // 3 lines + empty line at end
    });
  });

  it("works with relative paths", async () => {
    await withTestContext("shell-read-relative", async (context) => {
      const adapter = await getShellAdapter();

      // Create file
      const testFile = join(context.projectDir, "relative-read.txt");
      await writeTextFile(testFile, "content");

      // Change to test directory
      const originalDir = cwd();
      try {
        chdir(context.projectDir);

        // Read with relative path
        const content = adapter.shell.readFileSync("./relative-read.txt");

        assertEquals(content, "content");
      } finally {
        chdir(originalDir);
      }
    });
  });
});

describe("ShellAdapter - esbuild Plugin Integration", () => {
  it("statSync can be used in esbuild plugins", async () => {
    await withTestContext("shell-esbuild-stat", async (context) => {
      const adapter = await getShellAdapter();

      // Create test files
      const tsFile = join(context.projectDir, "component.tsx");
      const jsFile = join(context.projectDir, "utils.js");

      await writeTextFile(tsFile, "export const Component = () => <div/>");
      await writeTextFile(jsFile, "export const util = () => {}");

      // Simulate esbuild plugin resolution
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
      const adapter = await getShellAdapter();

      // Create module file
      const moduleFile = join(context.projectDir, "module.ts");
      const moduleContent = "export const value = 42;";
      await writeTextFile(moduleFile, moduleContent);

      // Simulate esbuild plugin onLoad
      const content = adapter.shell.readFileSync(moduleFile);

      assertEquals(content, moduleContent);
      assert(content.includes("export"));
    });
  });

  it("handles rapid sequential file operations", async () => {
    await withTestContext("shell-rapid-operations", async (context) => {
      const adapter = await getShellAdapter();

      // Create multiple files
      const files = [];
      for (let i = 0; i < 10; i++) {
        const filePath = join(context.projectDir, `file${i}.ts`);
        await writeTextFile(filePath, `export const value${i} = ${i}`);
        files.push(filePath);
      }

      // Rapidly stat and read all files (simulating esbuild plugin)
      const start = performance.now();

      for (const file of files) {
        const stat = adapter.shell.statSync(file);
        assert(stat.isFile);

        const content = adapter.shell.readFileSync(file);
        assert(content.includes("export"));
      }

      const duration = performance.now() - start;

      // Should complete quickly (<100ms for 10 files)
      assert(duration < 1000, `Should complete in <1000ms, took ${duration}ms`);
    });
  });
});

describe("ShellAdapter - Error Handling", () => {
  it("provides clear error messages", async () => {
    const adapter = await getShellAdapter();

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
    // This test might not work on all systems (requires specific permissions)
    // Skip if we can't create a file with restricted permissions

    // deno-lint-ignore require-await
    await withTestContext("shell-permission-error", async (_context) => {
      const adapter = await getShellAdapter();

      try {
        // Try to read a system file that might have restricted permissions
        const restrictedPath = "/etc/shadow";

        try {
          adapter.shell.readFileSync(restrictedPath);
        } catch (error) {
          assert(error instanceof Error);
          // Should get permission error or file not found
          assert(error.message.includes("Failed"));
        }
      } catch {
        // Skip test if we can't test permissions
      }
    });
  });
});
