/**
 * Integration tests for the `init` command
 *
 * Tests the full CLI flow from command to scaffolded project.
 *
 * @module cli/commands/init/init-deploy.integration.test
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import {
  env,
  makeTempDir,
  mkdir,
  remove,
  stat,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";
import { runCommand } from "#veryfront/compat/process.ts";

const TEST_DIR = await makeTempDir({ prefix: "veryfront-init-test-" });

function randomSuffix(): string {
  return Math.random().toString(36).substring(2, 8);
}

function getCliPath(): string {
  return new URL("../../main.ts", import.meta.url).pathname;
}

function runInitCommand(
  projectName: string,
  args: string[],
  options?: { env?: Record<string, string> },
): Promise<{ code: number; stdout?: string; stderr?: string }> {
  return runCommand("deno", {
    args: ["run", "--allow-all", getCliPath(), "init", projectName, ...args],
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

describe("init command integration", () => {
  const projectName = `test-init-${randomSuffix()}`;
  const projectDir = join(TEST_DIR, projectName);

  afterEach(async () => {
    await remove(projectDir, { recursive: true }).catch(() => {
      // Ignore if doesn't exist
    });
  });

  describe("scaffolding", () => {
    it("should scaffold a project locally", async () => {
      const result = await runInitCommand(projectName, [
        "-t",
        "chat",
        "--skip-install",
        "--skip-env-prompt",
      ]);

      assertEquals(result.code, 0);

      const statResult = await stat(projectDir);
      assertEquals(statResult.isDirectory, true);
    });

    it("should use chat template when specified", async () => {
      await runInitCommand(projectName, ["-t", "chat", "--skip-install", "--skip-env-prompt"]);

      assertEquals(await pathIsDirectory(join(projectDir, "agents")), true);
    });

    it("should support minimal template", async () => {
      await runInitCommand(projectName, ["-t", "minimal", "--skip-install", "--skip-env-prompt"]);

      const statResult = await stat(projectDir);
      assertEquals(statResult.isDirectory, true);
    });
  });

  describe("validation", () => {
    it("should reject existing directories without --force", async () => {
      await mkdir(projectDir);

      const result = await runInitCommand(projectName, [
        "-t",
        "chat",
        "--skip-install",
        "--skip-env-prompt",
      ]);
      assertEquals(result.code !== 0 || (result.stderr ?? "").includes("already exists"), true);
    });

    it("should overwrite with --force flag", async () => {
      await mkdir(projectDir);
      await writeTextFile(join(projectDir, "existing.txt"), "old content");

      const result = await runInitCommand(projectName, [
        "-t",
        "chat",
        "--force",
        "--skip-install",
        "--skip-env-prompt",
      ]);
      assertEquals(result.code, 0);
    });
  });

  describe("--integrations flag", () => {
    it("should scaffold project with single integration", async () => {
      const result = await runInitCommand(projectName, [
        "-t",
        "chat",
        "--integrations",
        "github",
        "--skip-install",
        "--skip-env-prompt",
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
      const result = await runInitCommand(projectName, [
        "-t",
        "chat",
        "--integrations",
        "github,slack",
        "--skip-install",
        "--skip-env-prompt",
      ]);

      assertEquals(result.code, 0);

      assertEquals(await pathIsFile(join(projectDir, "lib", "github-client.ts")), true);
      assertEquals(await pathIsFile(join(projectDir, "lib", "slack-client.ts")), true);
    });
  });

  describe("wizard behavior", () => {
    it("should skip wizard when --template flag is provided", async () => {
      const result = await runInitCommand(
        projectName,
        ["-t", "minimal", "--skip-install", "--skip-env-prompt"],
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

    it("should skip wizard in non-TTY environment", async () => {
      const result = await runInitCommand(projectName, [
        "-t",
        "chat",
        "--skip-install",
        "--skip-env-prompt",
      ]);

      assertEquals(result.code, 0);
      assertEquals(await pathIsDirectory(projectDir), true);
    });
  });
});
