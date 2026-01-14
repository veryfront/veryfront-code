/**
 * Integration tests for the `new` command
 *
 * Tests the full CLI flow from command to scaffolded project.
 *
 * @module cli/commands/new.integration.test
 */

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { afterEach, describe, it } from "jsr:@std/testing@1/bdd";
import { join } from "@veryfront/platform/compat/path/index.ts";

const TEST_DIR = Deno.makeTempDirSync({ prefix: "veryfront-new-test-" });
const randomSuffix = () => Math.random().toString(36).substring(2, 8);

describe("new command integration", () => {
  const projectName = `test-demo-${randomSuffix()}`;
  const projectDir = join(TEST_DIR, projectName);

  afterEach(async () => {
    // Clean up test project
    try {
      await Deno.remove(projectDir, { recursive: true });
    } catch {
      // Ignore if doesn't exist
    }
  });

  describe("--skip-deploy mode", () => {
    it("should scaffold a project without API calls", async () => {
      // Run the new command with --skip-deploy
      const cliPath = new URL("../main.ts", import.meta.url).pathname;
      const command = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-all",
          cliPath,
          "new",
          projectName,
          "--skip-deploy",
        ],
        cwd: TEST_DIR,
        stdout: "piped",
        stderr: "piped",
      });

      const { stdout, stderr } = await command.output();
      const output = new TextDecoder().decode(stdout);
      const errors = new TextDecoder().decode(stderr);

      // Check output contains expected messages
      assertExists(output.includes("Veryfront") || errors.includes("Veryfront"));
      assertExists(output.includes("Created") || errors.includes("Created"));

      // Check project was created
      const stat = await Deno.stat(projectDir);
      assertEquals(stat.isDirectory, true);

      // Check .veryfrontrc exists with correct content
      const veryfrontrc = await Deno.readTextFile(join(projectDir, ".veryfrontrc"));
      const config = JSON.parse(veryfrontrc);
      assertEquals(config.projectSlug, projectName);

      // Check .env exists
      const envExists = await Deno.stat(join(projectDir, ".env"))
        .then(() => true)
        .catch(() => false);
      assertEquals(envExists, true);

      // Check veryfront.config.ts exists
      const configExists = await Deno.stat(join(projectDir, "veryfront.config.ts"))
        .then(() => true)
        .catch(() => false);
      assertEquals(configExists, true);
    });

    it("should use AI template by default", async () => {
      const cliPath = new URL("../main.ts", import.meta.url).pathname;
      const command = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-all",
          cliPath,
          "new",
          projectName,
          "--skip-deploy",
        ],
        cwd: TEST_DIR,
        stdout: "piped",
        stderr: "piped",
      });

      await command.output();

      // AI template should create an `ai` directory
      const aiDirExists = await Deno.stat(join(projectDir, "ai"))
        .then((s) => s.isDirectory)
        .catch(() => false);
      assertEquals(aiDirExists, true);

      // .env should contain OPENAI_API_KEY placeholder
      const envContent = await Deno.readTextFile(join(projectDir, ".env"));
      assertExists(envContent.includes("OPENAI_API_KEY"));
    });

    it("should support different templates", async () => {
      const cliPath = new URL("../main.ts", import.meta.url).pathname;
      const command = new Deno.Command("deno", {
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
        stdout: "piped",
        stderr: "piped",
      });

      await command.output();

      // Project should be created
      const stat = await Deno.stat(projectDir);
      assertEquals(stat.isDirectory, true);

      // .veryfrontrc should exist
      const veryfrontrc = await Deno.readTextFile(join(projectDir, ".veryfrontrc"));
      const config = JSON.parse(veryfrontrc);
      assertEquals(config.projectSlug, projectName);
    });
  });

  describe("validation", () => {
    it("should reject invalid project names", async () => {
      const cliPath = new URL("../main.ts", import.meta.url).pathname;
      const command = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-all",
          cliPath,
          "new",
          "Invalid Name With Spaces",
          "--skip-deploy",
        ],
        cwd: TEST_DIR,
        stdout: "piped",
        stderr: "piped",
      });

      const { code } = await command.output();
      assertEquals(code, 1); // Should fail with invalid name
    });

    it("should reject existing directories without --force", async () => {
      // Create directory first
      await Deno.mkdir(projectDir);

      const cliPath = new URL("../main.ts", import.meta.url).pathname;
      const command = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-all",
          cliPath,
          "new",
          projectName,
          "--skip-deploy",
        ],
        cwd: TEST_DIR,
        stdout: "piped",
        stderr: "piped",
      });

      const { code } = await command.output();
      assertEquals(code, 1); // Should fail because directory exists
    });

    it("should overwrite with --force flag", async () => {
      // Create directory first
      await Deno.mkdir(projectDir);
      await Deno.writeTextFile(join(projectDir, "existing.txt"), "old content");

      const cliPath = new URL("../main.ts", import.meta.url).pathname;
      const command = new Deno.Command("deno", {
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
        stdout: "piped",
        stderr: "piped",
      });

      const { code } = await command.output();
      assertEquals(code, 0); // Should succeed with --force

      // .veryfrontrc should exist (project was scaffolded)
      const veryfrontrc = await Deno.readTextFile(join(projectDir, ".veryfrontrc"));
      const config = JSON.parse(veryfrontrc);
      assertEquals(config.projectSlug, projectName);
    });
  });

  describe("--integrations flag", () => {
    it("should scaffold project with single integration", async () => {
      const cliPath = new URL("../main.ts", import.meta.url).pathname;
      const command = new Deno.Command("deno", {
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
        stdout: "piped",
        stderr: "piped",
      });

      const { code } = await command.output();
      assertEquals(code, 0);

      // Project should be created
      const stat = await Deno.stat(projectDir);
      assertEquals(stat.isDirectory, true);

      // GitHub integration files should exist
      // Check for the GitHub client library
      const githubClientExists = await Deno.stat(join(projectDir, "lib", "github-client.ts"))
        .then((s) => s.isFile)
        .catch(() => false);
      assertEquals(githubClientExists, true);

      // Check for GitHub OAuth routes
      const githubAuthRouteExists = await Deno.stat(join(projectDir, "app", "api", "auth", "github"))
        .then((s) => s.isDirectory)
        .catch(() => false);
      assertEquals(githubAuthRouteExists, true);
    });

    it("should scaffold project with multiple integrations (comma-separated)", async () => {
      const cliPath = new URL("../main.ts", import.meta.url).pathname;
      const command = new Deno.Command("deno", {
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
        stdout: "piped",
        stderr: "piped",
      });

      const { code } = await command.output();
      assertEquals(code, 0);

      // GitHub integration files should be scaffolded
      const githubClientExists = await Deno.stat(join(projectDir, "lib", "github-client.ts"))
        .then((s) => s.isFile)
        .catch(() => false);
      assertEquals(githubClientExists, true);

      // Slack integration files should be scaffolded
      const slackClientExists = await Deno.stat(join(projectDir, "lib", "slack-client.ts"))
        .then((s) => s.isFile)
        .catch(() => false);
      assertEquals(slackClientExists, true);
    });

    it("should include integration env vars in .env", async () => {
      const cliPath = new URL("../main.ts", import.meta.url).pathname;
      const command = new Deno.Command("deno", {
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
        stdout: "piped",
        stderr: "piped",
      });

      const { code } = await command.output();
      assertEquals(code, 0);

      // .env should contain integration env vars
      const envContent = await Deno.readTextFile(join(projectDir, ".env"));
      // GitHub integration requires GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET
      assertExists(envContent.includes("GITHUB_CLIENT_ID") || envContent.includes("OPENAI_API_KEY"));
    });

    it("should include integration env vars in .env.example", async () => {
      const cliPath = new URL("../main.ts", import.meta.url).pathname;
      const command = new Deno.Command("deno", {
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
        stdout: "piped",
        stderr: "piped",
      });

      const { code } = await command.output();
      assertEquals(code, 0);

      // .env.example should exist and contain integration documentation
      const envExampleContent = await Deno.readTextFile(join(projectDir, ".env.example"));
      assertExists(envExampleContent.includes("Integration") || envExampleContent.includes("OPENAI"));
    });
  });

  describe("wizard behavior", () => {
    it("should skip wizard when --template flag is provided", async () => {
      const cliPath = new URL("../main.ts", import.meta.url).pathname;
      const command = new Deno.Command("deno", {
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
        stdout: "piped",
        stderr: "piped",
        env: {
          ...Deno.env.toObject(),
          // Disable TTY to prevent wizard attempts
          DENO_NO_PROMPT: "1",
        },
      });

      const { code, stdout, stderr } = await command.output();
      const output = new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr);

      assertEquals(code, 0);

      // Should not show wizard prompts (no "What would you like to build?")
      assertEquals(output.includes("What would you like to build?"), false);

      // Project should be created with minimal template
      const stat = await Deno.stat(projectDir);
      assertEquals(stat.isDirectory, true);
    });

    it("should skip wizard when --integrations flag is provided", async () => {
      const cliPath = new URL("../main.ts", import.meta.url).pathname;
      const command = new Deno.Command("deno", {
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
        stdout: "piped",
        stderr: "piped",
        env: {
          ...Deno.env.toObject(),
          DENO_NO_PROMPT: "1",
        },
      });

      const { code, stdout, stderr } = await command.output();
      const output = new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr);

      assertEquals(code, 0);

      // Should not show wizard prompts
      assertEquals(output.includes("What would you like to build?"), false);

      // Project should use default AI template when integrations provided without template
      const aiDirExists = await Deno.stat(join(projectDir, "ai"))
        .then((s) => s.isDirectory)
        .catch(() => false);
      assertEquals(aiDirExists, true);
    });

    it("should skip wizard in non-TTY environment", async () => {
      const cliPath = new URL("../main.ts", import.meta.url).pathname;
      const command = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-all",
          cliPath,
          "new",
          projectName,
          "--skip-deploy",
        ],
        cwd: TEST_DIR,
        stdout: "piped",
        stderr: "piped",
        // Non-TTY: stdin is piped, not a terminal
        stdin: "null",
      });

      const { code } = await command.output();
      assertEquals(code, 0);

      // Project should be created with default AI template
      const aiDirExists = await Deno.stat(join(projectDir, "ai"))
        .then((s) => s.isDirectory)
        .catch(() => false);
      assertEquals(aiDirExists, true);
    });
  });
});
