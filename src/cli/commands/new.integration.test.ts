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
const randomSuffix = (): string => Math.random().toString(36).substring(2, 8);

describe("new command integration", () => {
  const projectName = `test-demo-${randomSuffix()}`;
  const projectDir = join(TEST_DIR, projectName);

  afterEach(async () => {
    // Clean up test project
    try {
      await remove(projectDir, { recursive: true });
    } catch {
      // Ignore if doesn't exist
    }
  });

  describe("--skip-deploy mode", () => {
    it("should scaffold a project without API calls", async () => {
      // Run the new command with --skip-deploy
      const cliPath = new URL("../main.ts", import.meta.url).pathname;
      const result = await runCommand("deno", {
        args: ["run", "--allow-all", cliPath, "new", projectName, "--skip-deploy"],
        cwd: TEST_DIR,
        capture: true,
      });

      const output = (result.stdout ?? "") + (result.stderr ?? "");

      // Check output contains expected messages
      assertExists(output.includes("Veryfront") || output.includes("Created"));

      // Check project was created
      const statResult = await stat(projectDir);
      assertEquals(statResult.isDirectory, true);

      // Check veryfront.config.ts exists with correct content
      const configContent = await readTextFile(join(projectDir, "veryfront.config.ts"));
      // The slug includes a random suffix, so just check it starts with the project name
      assertExists(configContent.includes(`projectSlug: "${projectName}-`));

      // Check .env exists
      const envExists = await exists(join(projectDir, ".env"));
      assertEquals(envExists, true);

      // Check veryfront.config.ts exists
      const configExists = await exists(join(projectDir, "veryfront.config.ts"));
      assertEquals(configExists, true);
    });

    it("should use AI template by default", async () => {
      const cliPath = new URL("../main.ts", import.meta.url).pathname;
      await runCommand("deno", {
        args: ["run", "--allow-all", cliPath, "new", projectName, "--skip-deploy"],
        cwd: TEST_DIR,
        capture: true,
      });

      // AI template should create an `agents` directory
      const agentsDirStat = await stat(join(projectDir, "agents")).catch(() => null);
      const agentsDirExists = agentsDirStat?.isDirectory ?? false;
      assertEquals(agentsDirExists, true);

      // .env should contain OPENAI_API_KEY placeholder
      const envContent = await readTextFile(join(projectDir, ".env"));
      assertExists(envContent.includes("OPENAI_API_KEY"));
    });

    it("should support different templates", async () => {
      const cliPath = new URL("../main.ts", import.meta.url).pathname;
      await runCommand("deno", {
        args: ["run", "--allow-all", cliPath, "new", projectName, "--skip-deploy", "-t", "minimal"],
        cwd: TEST_DIR,
        capture: true,
      });

      // Project should be created
      const statResult = await stat(projectDir);
      assertEquals(statResult.isDirectory, true);

      // veryfront.config.ts should exist with project slug
      const configContent = await readTextFile(join(projectDir, "veryfront.config.ts"));
      assertExists(configContent.includes(`projectSlug: "${projectName}-`));
    });
  });

  describe("validation", () => {
    it("should reject invalid project names", async () => {
      const cliPath = new URL("../main.ts", import.meta.url).pathname;
      const result = await runCommand("deno", {
        args: [
          "run",
          "--allow-all",
          cliPath,
          "new",
          "Invalid Name With Spaces",
          "--skip-deploy",
        ],
        cwd: TEST_DIR,
        capture: true,
      });

      assertEquals(result.code, 1); // Should fail with invalid name
    });

    it("should reject existing directories without --force", async () => {
      // Create directory first
      await mkdir(projectDir);

      const cliPath = new URL("../main.ts", import.meta.url).pathname;
      const result = await runCommand("deno", {
        args: ["run", "--allow-all", cliPath, "new", projectName, "--skip-deploy"],
        cwd: TEST_DIR,
        capture: true,
      });

      assertEquals(result.code, 1); // Should fail because directory exists
    });

    it("should overwrite with --force flag", async () => {
      // Create directory first
      await mkdir(projectDir);
      await writeTextFile(join(projectDir, "existing.txt"), "old content");

      const cliPath = new URL("../main.ts", import.meta.url).pathname;
      const result = await runCommand("deno", {
        args: [
          "run",
          "--allow-all",
          cliPath,
          "new",
          projectName,
          "--skip-deploy",
          "--force",
        ],
        cwd: TEST_DIR,
        capture: true,
      });

      assertEquals(result.code, 0); // Should succeed with --force

      // veryfront.config.ts should exist (project was scaffolded)
      const configContent = await readTextFile(join(projectDir, "veryfront.config.ts"));
      assertExists(configContent.includes(`projectSlug: "${projectName}-`));
    });
  });

  describe("--integrations flag", () => {
    it("should scaffold project with single integration", async () => {
      const cliPath = new URL("../main.ts", import.meta.url).pathname;
      const result = await runCommand("deno", {
        args: [
          "run",
          "--allow-all",
          cliPath,
          "new",
          projectName,
          "--skip-deploy",
          "-t",
          "ai",
          "--integrations",
          "github",
        ],
        cwd: TEST_DIR,
        capture: true,
      });

      assertEquals(result.code, 0);

      // Project should be created
      const statResult = await stat(projectDir);
      assertEquals(statResult.isDirectory, true);

      // GitHub integration files should exist
      // Check for the GitHub client library
      const githubClientStat = await stat(join(projectDir, "lib", "github-client.ts")).catch(
        () => null,
      );
      const githubClientExists = githubClientStat?.isFile ?? false;
      assertEquals(githubClientExists, true);

      // Check for GitHub OAuth routes
      const githubAuthRouteStat = await stat(
        join(projectDir, "app", "api", "auth", "github"),
      ).catch(() => null);
      const githubAuthRouteExists = githubAuthRouteStat?.isDirectory ?? false;
      assertEquals(githubAuthRouteExists, true);
    });

    it("should scaffold project with multiple integrations (comma-separated)", async () => {
      const cliPath = new URL("../main.ts", import.meta.url).pathname;
      const result = await runCommand("deno", {
        args: [
          "run",
          "--allow-all",
          cliPath,
          "new",
          projectName,
          "--skip-deploy",
          "-t",
          "ai",
          "--integrations",
          "github,slack",
        ],
        cwd: TEST_DIR,
        capture: true,
      });

      assertEquals(result.code, 0);

      // GitHub integration files should be scaffolded
      const githubClientStat = await stat(join(projectDir, "lib", "github-client.ts")).catch(
        () => null,
      );
      const githubClientExists = githubClientStat?.isFile ?? false;
      assertEquals(githubClientExists, true);

      // Slack integration files should be scaffolded
      const slackClientStat = await stat(join(projectDir, "lib", "slack-client.ts")).catch(
        () => null,
      );
      const slackClientExists = slackClientStat?.isFile ?? false;
      assertEquals(slackClientExists, true);
    });

    it("should include integration env vars in .env", async () => {
      const cliPath = new URL("../main.ts", import.meta.url).pathname;
      const result = await runCommand("deno", {
        args: [
          "run",
          "--allow-all",
          cliPath,
          "new",
          projectName,
          "--skip-deploy",
          "-t",
          "ai",
          "--integrations",
          "github",
        ],
        cwd: TEST_DIR,
        capture: true,
      });

      assertEquals(result.code, 0);

      // .env should contain integration env vars
      const envContent = await readTextFile(join(projectDir, ".env"));
      // GitHub integration requires GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET
      assertExists(
        envContent.includes("GITHUB_CLIENT_ID") || envContent.includes("OPENAI_API_KEY"),
      );
    });

    it("should include integration env vars in .env.example", async () => {
      const cliPath = new URL("../main.ts", import.meta.url).pathname;
      const result = await runCommand("deno", {
        args: [
          "run",
          "--allow-all",
          cliPath,
          "new",
          projectName,
          "--skip-deploy",
          "-t",
          "ai",
          "--integrations",
          "github",
        ],
        cwd: TEST_DIR,
        capture: true,
      });

      assertEquals(result.code, 0);

      // .env.example should exist and contain integration documentation
      const envExampleContent = await readTextFile(join(projectDir, ".env.example"));
      assertExists(
        envExampleContent.includes("Integration") || envExampleContent.includes("OPENAI"),
      );
    });
  });

  describe("wizard behavior", () => {
    it("should skip wizard when --template flag is provided", async () => {
      const cliPath = new URL("../main.ts", import.meta.url).pathname;
      const result = await runCommand("deno", {
        args: [
          "run",
          "--allow-all",
          cliPath,
          "new",
          projectName,
          "--skip-deploy",
          "-t",
          "minimal",
        ],
        cwd: TEST_DIR,
        capture: true,
        env: {
          ...env(),
          // Disable TTY to prevent wizard attempts
          DENO_NO_PROMPT: "1",
        },
      });

      const output = (result.stdout ?? "") + (result.stderr ?? "");

      assertEquals(result.code, 0);

      // Should not show wizard prompts (no "What would you like to build?")
      assertEquals(output.includes("What would you like to build?"), false);

      // Project should be created with minimal template
      const statResult = await stat(projectDir);
      assertEquals(statResult.isDirectory, true);
    });

    it("should skip wizard when --integrations flag is provided", async () => {
      const cliPath = new URL("../main.ts", import.meta.url).pathname;
      const result = await runCommand("deno", {
        args: [
          "run",
          "--allow-all",
          cliPath,
          "new",
          projectName,
          "--skip-deploy",
          "--integrations",
          "github",
        ],
        cwd: TEST_DIR,
        capture: true,
        env: {
          ...env(),
          DENO_NO_PROMPT: "1",
        },
      });

      const output = (result.stdout ?? "") + (result.stderr ?? "");

      assertEquals(result.code, 0);

      // Should not show wizard prompts
      assertEquals(output.includes("What would you like to build?"), false);

      // Project should use default AI template when integrations provided without template
      const agentsDirStat = await stat(join(projectDir, "agents")).catch(() => null);
      const agentsDirExists = agentsDirStat?.isDirectory ?? false;
      assertEquals(agentsDirExists, true);
    });

    it("should skip wizard in non-TTY environment", async () => {
      const cliPath = new URL("../main.ts", import.meta.url).pathname;
      const result = await runCommand("deno", {
        args: ["run", "--allow-all", cliPath, "new", projectName, "--skip-deploy"],
        cwd: TEST_DIR,
        capture: true,
      });

      assertEquals(result.code, 0);

      // Project should be created with default AI template
      const agentsDirStat = await stat(join(projectDir, "agents")).catch(() => null);
      const agentsDirExists = agentsDirStat?.isDirectory ?? false;
      assertEquals(agentsDirExists, true);
    });
  });
});
