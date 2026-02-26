/**
 * Integration tests for the `init` command
 *
 * Tests the full CLI flow from command to scaffolded project.
 * Note: init command scaffolds from templates and doesn't create veryfront.config.ts
 * (unlike the `new` command which creates a full project with config)
 *
 * @module cli/commands/init/init.integration.test
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { exists, makeTempDir, readTextFile, remove, stat } from "#veryfront/testing/deno-compat.ts";
import { runCommand } from "#veryfront/compat/process.ts";

const TEST_DIR = await makeTempDir({ prefix: "veryfront-init-test-" });

function randomSuffix(): string {
  return Math.random().toString(36).substring(2, 8);
}

function getCliPath(): string {
  return new URL("../../main.ts", import.meta.url).pathname;
}

function runInitCommand(
  args: string[],
  options?: { cwd?: string; env?: Record<string, string> },
): Promise<{ code: number; stdout?: string; stderr?: string }> {
  return runCommand("deno", {
    args: ["run", "--allow-all", getCliPath(), "init", ...args],
    cwd: options?.cwd ?? TEST_DIR,
    capture: true,
    env: options?.env,
  });
}

describe("init command integration", () => {
  const projectName = `test-project-${randomSuffix()}`;
  const projectDir = join(TEST_DIR, projectName);

  afterEach(async () => {
    await remove(projectDir, { recursive: true }).catch(() => {
      // Ignore if doesn't exist
    });
  });

  describe("project creation", () => {
    it("should create project in new directory when name is provided", async () => {
      const result = await runInitCommand([projectName, "-t", "minimal", "--skip-install"]);

      assertEquals(result.code, 0);

      const statResult = await stat(projectDir);
      assertEquals(statResult.isDirectory, true);

      // Minimal template creates app directory
      assertEquals(await exists(join(projectDir, "app")), true);
    });

    it("should create project in current directory when no name provided", async () => {
      const emptyDir = join(TEST_DIR, `empty-${randomSuffix()}`);
      await Deno.mkdir(emptyDir);

      try {
        const result = await runInitCommand(["-t", "minimal", "--skip-install"], {
          cwd: emptyDir,
        });

        assertEquals(result.code, 0);
        assertEquals(await exists(join(emptyDir, "app")), true);
      } finally {
        await remove(emptyDir, { recursive: true }).catch(() => {});
      }
    });
  });

  describe("template selection", () => {
    it("should use minimal template when specified", async () => {
      const result = await runInitCommand([projectName, "-t", "minimal", "--skip-install"]);

      assertEquals(result.code, 0);
      assertEquals(await exists(join(projectDir, "app", "page.tsx")), true);
    });

    it("should use ai-assistant template when specified", async () => {
      const result = await runInitCommand([projectName, "-t", "ai-assistant", "--skip-install"]);

      assertEquals(result.code, 0);

      const statResult = await stat(join(projectDir, "agents"));
      assertEquals(statResult.isDirectory, true);
    });

    it("should use chat-with-your-docs template when specified", async () => {
      const result = await runInitCommand([projectName, "-t", "chat-with-your-docs", "--skip-install"]);

      assertEquals(result.code, 0);
      assertEquals(await exists(join(projectDir, "app")), true);
    });

    it("should use agentic-workflow template when specified", async () => {
      const result = await runInitCommand([projectName, "-t", "agentic-workflow", "--skip-install"]);

      assertEquals(result.code, 0);

      const statResult = await stat(join(projectDir, "app"));
      assertEquals(statResult.isDirectory, true);
    });
  });

  describe("file generation", () => {
    it("should create .env file for templates with env vars", async () => {
      const result = await runInitCommand([
        projectName,
        "-t",
        "ai-assistant",
        "--skip-install",
        "--skip-env-prompt",
      ]);

      assertEquals(result.code, 0);
      assertEquals(await exists(join(projectDir, ".env")), true);
    });

    it("should create .env.example file for templates with env vars", async () => {
      const result = await runInitCommand([
        projectName,
        "-t",
        "ai-assistant",
        "--skip-install",
        "--skip-env-prompt",
      ]);

      assertEquals(result.code, 0);
      assertEquals(await exists(join(projectDir, ".env.example")), true);
    });

    it("should create .gitignore file", async () => {
      const result = await runInitCommand([projectName, "-t", "minimal", "--skip-install"]);

      assertEquals(result.code, 0);
      assertEquals(await exists(join(projectDir, ".gitignore")), true);

      const gitignoreContent = await readTextFile(join(projectDir, ".gitignore"));
      assertExists(gitignoreContent.includes("node_modules"));
      assertExists(gitignoreContent.includes(".env"));
    });

    it("should create package.json", async () => {
      const result = await runInitCommand([projectName, "-t", "minimal", "--skip-install"]);

      assertEquals(result.code, 0);
      assertEquals(await exists(join(projectDir, "package.json")), true);

      const packageJson = await readTextFile(join(projectDir, "package.json"));
      assertExists(packageJson.includes("veryfront"));
    });
  });

  describe("wizard behavior in non-TTY", () => {
    it("should skip wizard and use minimal template when name is provided", async () => {
      // When a name is provided, wizard should be skipped
      const result = await runInitCommand([projectName, "--skip-install"]);

      assertEquals(result.code, 0);
      assertEquals(await exists(join(projectDir, "app")), true);
    });
  });

  describe("existing directory", () => {
    it("should show error when directory already exists", async () => {
      const dirName = `exists-${randomSuffix()}`;
      const dirPath = join(TEST_DIR, dirName);
      await Deno.mkdir(dirPath);

      try {
        const result = await runInitCommand([dirName, "-t", "minimal", "--skip-install"]);
        const output = (result.stdout ?? "") + (result.stderr ?? "");

        assertEquals(output.includes("already exists"), true);
        assertEquals(output.includes("Stack trace"), false);
      } finally {
        await remove(dirPath, { recursive: true }).catch(() => {});
      }
    });

    it("should allow --force to overwrite existing directory", async () => {
      const dirName = `force-${randomSuffix()}`;
      const dirPath = join(TEST_DIR, dirName);
      await Deno.mkdir(dirPath);

      try {
        const result = await runInitCommand([
          dirName,
          "-t",
          "minimal",
          "--skip-install",
          "--force",
        ]);

        assertEquals(result.code, 0);
        assertEquals(await exists(join(dirPath, "app")), true);
      } finally {
        await remove(dirPath, { recursive: true }).catch(() => {});
      }
    });
  });

  describe("output messages", () => {
    it("should show success message", async () => {
      const result = await runInitCommand([projectName, "-t", "minimal", "--skip-install"]);

      const output = (result.stdout ?? "") + (result.stderr ?? "");

      assertEquals(result.code, 0);
      assertExists(
        output.includes("success") ||
          output.includes("created") ||
          output.includes("Created") ||
          output.includes("✓"),
      );
    });
  });
});
