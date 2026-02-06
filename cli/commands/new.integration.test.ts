/**
 * Integration tests for the `new` command
 *
 * Tests the full CLI flow from command to scaffolded project.
 *
 * @module cli/commands/new.integration.test
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/platform/compat/path/index.ts";
import {
  env,
  exists,
  makeTempDir,
  mkdir,
  readTextFile,
  remove,
  stat,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";
import { runCommand } from "#veryfront/compat/process.ts";

const TEST_DIR = await makeTempDir({ prefix: "veryfront-new-test-" });

function randomSuffix(): string {
  return Math.random().toString(36).substring(2, 8);
}

function getCliPath(): string {
  return new URL("../main.ts", import.meta.url).pathname;
}

function runNewCommand(
  projectName: string,
  args: string[],
  options?: { env?: Record<string, string> },
): Promise<{ code: number; stdout?: string; stderr?: string }> {
  return runCommand("deno", {
    args: ["run", "--allow-all", getCliPath(), "new", projectName, ...args],
    cwd: TEST_DIR,
    capture: true,
    env: options?.env,
  });
}

async function pathIsDirectory(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  return info?.isDirectory ?? false;
}

async function pathIsFile(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  return info?.isFile ?? false;
}

describe("new command integration", () => {
  const projectName = `test-demo-${randomSuffix()}`;
  const projectDir = join(TEST_DIR, projectName);

  afterEach(async () => {
    await remove(projectDir, { recursive: true }).catch(() => {
      // Ignore if doesn't exist
    });
  });

  describe("local-first mode (default)", () => {
    it("should scaffold a project locally without auth", async () => {
      // In non-TTY mode, project is created locally without TUI
      const result = await runNewCommand(projectName, []);
      const output = (result.stdout ?? "") + (result.stderr ?? "");

      assertExists(output.includes("Veryfront") || output.includes("Created"));

      const statResult = await stat(projectDir);
      assertEquals(statResult.isDirectory, true);

      const configContent = await readTextFile(
        join(projectDir, "veryfront.config.ts"),
      );
      assertExists(configContent.includes(`projectSlug: "${projectName}-`));

      assertEquals(await exists(join(projectDir, ".env")), true);
      assertEquals(await exists(join(projectDir, "veryfront.config.ts")), true);
    });

    it("should use AI template by default", async () => {
      await runNewCommand(projectName, []);

      assertEquals(await pathIsDirectory(join(projectDir, "agents")), true);

      const envContent = await readTextFile(join(projectDir, ".env"));
      assertExists(envContent.includes("OPENAI_API_KEY"));
    });

    it("should support different templates", async () => {
      await runNewCommand(projectName, ["-t", "minimal"]);

      const statResult = await stat(projectDir);
      assertEquals(statResult.isDirectory, true);

      const configContent = await readTextFile(
        join(projectDir, "veryfront.config.ts"),
      );
      assertExists(configContent.includes(`projectSlug: "${projectName}-`));
    });
  });

  describe("validation", () => {
    it("should reject invalid project names", async () => {
      const result = await runCommand("deno", {
        args: [
          "run",
          "--allow-all",
          getCliPath(),
          "new",
          "Invalid Name With Spaces",
        ],
        cwd: TEST_DIR,
        capture: true,
      });

      assertEquals(result.code, 1);
    });

    it("should reject existing directories without --force", async () => {
      await mkdir(projectDir);

      const result = await runNewCommand(projectName, []);
      assertEquals(result.code, 1);
    });

    it("should overwrite with --force flag", async () => {
      await mkdir(projectDir);
      await writeTextFile(join(projectDir, "existing.txt"), "old content");

      const result = await runNewCommand(projectName, ["--force"]);
      assertEquals(result.code, 0);

      const configContent = await readTextFile(
        join(projectDir, "veryfront.config.ts"),
      );
      assertExists(configContent.includes(`projectSlug: "${projectName}-`));
    });
  });

  describe("--integrations flag", () => {
    it("should scaffold project with single integration", async () => {
      const result = await runNewCommand(projectName, [
        "-t",
        "ai",
        "--integrations",
        "github",
      ]);

      assertEquals(result.code, 0);

      const statResult = await stat(projectDir);
      assertEquals(statResult.isDirectory, true);

      assertEquals(await pathIsFile(join(projectDir, "lib", "github-client.ts")), true);
      assertEquals(
        await pathIsDirectory(join(projectDir, "app", "api", "auth", "github")),
        true,
      );
    });

    it("should scaffold project with multiple integrations (comma-separated)", async () => {
      const result = await runNewCommand(projectName, [
        "-t",
        "ai",
        "--integrations",
        "github,slack",
      ]);

      assertEquals(result.code, 0);

      assertEquals(await pathIsFile(join(projectDir, "lib", "github-client.ts")), true);
      assertEquals(await pathIsFile(join(projectDir, "lib", "slack-client.ts")), true);
    });

    it("should include integration env vars in .env", async () => {
      const result = await runNewCommand(projectName, [
        "-t",
        "ai",
        "--integrations",
        "github",
      ]);

      assertEquals(result.code, 0);

      const envContent = await readTextFile(join(projectDir, ".env"));
      assertExists(
        envContent.includes("GITHUB_CLIENT_ID") || envContent.includes("OPENAI_API_KEY"),
      );
    });

    it("should include integration env vars in .env.example", async () => {
      const result = await runNewCommand(projectName, [
        "-t",
        "ai",
        "--integrations",
        "github",
      ]);

      assertEquals(result.code, 0);

      const envExampleContent = await readTextFile(join(projectDir, ".env.example"));
      assertExists(
        envExampleContent.includes("Integration") || envExampleContent.includes("OPENAI"),
      );
    });
  });

  describe("wizard behavior", () => {
    it("should skip wizard when --template flag is provided", async () => {
      const result = await runNewCommand(
        projectName,
        ["-t", "minimal"],
        {
          env: {
            ...env(),
            DENO_NO_PROMPT: "1",
          },
        },
      );

      const output = (result.stdout ?? "") + (result.stderr ?? "");

      assertEquals(result.code, 0);
      assertEquals(output.includes("What would you like to build?"), false);
      assertEquals(await pathIsDirectory(projectDir), true);
    });

    it("should skip wizard when --integrations flag is provided", async () => {
      const result = await runNewCommand(
        projectName,
        ["--integrations", "github"],
        {
          env: {
            ...env(),
            DENO_NO_PROMPT: "1",
          },
        },
      );

      const output = (result.stdout ?? "") + (result.stderr ?? "");

      assertEquals(result.code, 0);
      assertEquals(output.includes("What would you like to build?"), false);
      assertEquals(await pathIsDirectory(join(projectDir, "agents")), true);
    });

    it("should skip wizard in non-TTY environment", async () => {
      const result = await runNewCommand(projectName, []);

      assertEquals(result.code, 0);
      assertEquals(await pathIsDirectory(join(projectDir, "agents")), true);
    });
  });
});
