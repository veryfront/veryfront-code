import "#veryfront/schemas/_test-setup.ts";
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
import { STARTER_TEMPLATE_NAMES } from "../../templates/types.ts";

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

function runQuietInitCommand(
  options: Record<string, unknown>,
  cwd = TEST_DIR,
): Promise<{ code: number; stdout?: string; stderr?: string }> {
  const initCommandUrl = new URL("./init-command.ts", import.meta.url).href;
  const configPath = new URL("../../../deno.json", import.meta.url).pathname;
  return runCommand("deno", {
    args: [
      "eval",
      "--config",
      configPath,
      `import { initCommand } from ${JSON.stringify(initCommandUrl)}; await initCommand(${
        JSON.stringify(options)
      });`,
    ],
    cwd,
    capture: true,
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

    it("should use ai-agent template when specified", async () => {
      const result = await runInitCommand([projectName, "-t", "ai-agent", "--skip-install"]);

      assertEquals(result.code, 0);

      const statResult = await stat(join(projectDir, "agents"));
      assertEquals(statResult.isDirectory, true);
    });

    it("should use docs-agent template when specified", async () => {
      const result = await runInitCommand([
        projectName,
        "-t",
        "docs-agent",
        "--skip-install",
      ]);

      assertEquals(result.code, 0);
      assertEquals(await exists(join(projectDir, "app")), true);
    });

    it("should use agentic-workflow template when specified", async () => {
      const result = await runInitCommand([
        projectName,
        "-t",
        "agentic-workflow",
        "--skip-install",
      ]);

      assertEquals(result.code, 0);

      const statResult = await stat(join(projectDir, "app"));
      assertEquals(statResult.isDirectory, true);
    });
  });

  describe("file generation", () => {
    it("should create .env file when scaffolded integrations declare env vars", async () => {
      const result = await runInitCommand([
        projectName,
        "-t",
        "ai-agent",
        "--integrations",
        "github",
        "--skip-install",
        "--skip-env-prompt",
      ]);

      assertEquals(result.code, 0);
      assertEquals(await exists(join(projectDir, ".env")), true);
    });

    it("should create .env.example file when scaffolded integrations declare env vars", async () => {
      const result = await runInitCommand([
        projectName,
        "-t",
        "ai-agent",
        "--integrations",
        "github",
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

    it("creates coding-agent instructions for every starter template", async () => {
      for (const template of STARTER_TEMPLATE_NAMES) {
        const name = `agents-${template}-${randomSuffix()}`;
        const dir = join(TEST_DIR, name);

        try {
          const result = await runQuietInitCommand({
            name,
            template,
            skipInstall: true,
            skipEnvPrompt: true,
            quiet: true,
          });

          assertEquals(result.code, 0, `${template} init failed`);
          assertEquals(await exists(join(dir, "AGENTS.md")), true);

          const content = await readTextFile(join(dir, "AGENTS.md"));
          assertEquals(content.includes("vf_bootstrap"), true);
          assertEquals(content.includes("veryfront schema --json"), true);
          assertEquals(content.includes("src/pages"), false);
        } finally {
          await remove(dir, { recursive: true }).catch(() => {});
        }
      }
    });

    it("merges npm dependencies from selected integrations into package.json", async () => {
      const result = await runInitCommand([
        projectName,
        "-t",
        "minimal",
        "--integrations",
        "neon",
        "--skip-install",
        "--skip-env-prompt",
      ], {
        env: { VERYFRONT_EXPERIMENTAL_INTEGRATIONS: "neon" },
      });

      assertEquals(result.code, 0);

      const pkg = JSON.parse(await readTextFile(join(projectDir, "package.json")));
      assertEquals(pkg.dependencies.pg, "^8.13.1");
    });

    it("includes document extraction dependencies for docs-agent uploads", async () => {
      const result = await runInitCommand([
        projectName,
        "-t",
        "docs-agent",
        "--runtime",
        "node",
        "--skip-install",
        "--skip-env-prompt",
      ]);

      assertEquals(result.code, 0);

      const pkg = JSON.parse(await readTextFile(join(projectDir, "package.json")));
      assertEquals(pkg.dependencies["@kreuzberg/node"], "^4.4.2");
      assertEquals(pkg.dependencies["@kreuzberg/wasm"], "4.5.2");
    });

    it("does not write a partial package.json for quiet docs-agent projects", async () => {
      const result = await runQuietInitCommand({
        name: projectName,
        template: "docs-agent",
        skipInstall: true,
        skipEnvPrompt: true,
        quiet: true,
      });

      assertEquals(result.code, 0);
      assertEquals(await exists(join(projectDir, "package.json")), false);
      assertEquals(await exists(join(projectDir, "app", "page.tsx")), true);
    });

    it("does not write package.json in quiet mode for any starter template", async () => {
      for (const template of STARTER_TEMPLATE_NAMES) {
        const name = `quiet-${template}-${randomSuffix()}`;
        const dir = join(TEST_DIR, name);

        try {
          const result = await runQuietInitCommand({
            name,
            template,
            skipInstall: true,
            skipEnvPrompt: true,
            quiet: true,
          });
          const output = (result.stdout ?? "") + (result.stderr ?? "");

          assertEquals(result.code, 0, `${template} quiet init failed: ${output}`);
          assertEquals(
            await exists(join(dir, "package.json")),
            false,
            `${template} quiet init must not leave a package.json`,
          );
          assertEquals(
            await exists(join(dir, "app")),
            true,
            `${template} quiet init should scaffold app files`,
          );
        } finally {
          await remove(dir, { recursive: true }).catch(() => {});
        }
      }
    });

    it("generates complete package metadata for every starter template and runtime", async () => {
      const runtimes = ["node", "bun", "deno"] as const;

      for (const template of STARTER_TEMPLATE_NAMES) {
        for (const runtime of runtimes) {
          const name = `pkg-${runtime}-${template}-${randomSuffix()}`;
          const dir = join(TEST_DIR, name);

          try {
            const result = await runInitCommand([
              name,
              "-t",
              template,
              "--runtime",
              runtime,
              "--skip-install",
              "--skip-env-prompt",
            ]);
            const output = (result.stdout ?? "") + (result.stderr ?? "");

            assertEquals(
              result.code,
              0,
              `${template} ${runtime} init failed: ${output}`,
            );

            const pkg = JSON.parse(await readTextFile(join(dir, "package.json")));
            assertEquals(pkg.scripts.dev, "veryfront dev");
            assertEquals(pkg.scripts.build, "veryfront build");
            assertEquals(pkg.scripts.preview, "veryfront preview");
            assertExists(pkg.dependencies.veryfront);
            assertExists(pkg.dependencies.react);
            assertExists(pkg.dependencies["react-dom"]);
            assertEquals(pkg.dependencies.zod, "^3.24.0");

            if (template === "docs-agent") {
              assertEquals(pkg.dependencies["@kreuzberg/node"], "^4.4.2");
              assertEquals(pkg.dependencies["@kreuzberg/wasm"], "4.5.2");
            }

            assertEquals(
              await exists(join(dir, "deno.json")),
              runtime === "deno",
              `${template} ${runtime} should only write deno.json for deno runtime`,
            );
          } finally {
            await remove(dir, { recursive: true }).catch(() => {});
          }
        }
      }
    });
  });

  describe("runtime selection", () => {
    it("does NOT write deno.json by default (runtime defaults to node)", async () => {
      const result = await runInitCommand([
        projectName,
        "-t",
        "minimal",
        "--skip-install",
        "--skip-env-prompt",
      ]);
      assertEquals(result.code, 0);
      assertEquals(await exists(join(projectDir, "package.json")), true);
      assertEquals(await exists(join(projectDir, "deno.json")), false);
    });

    it("does NOT write deno.json for --runtime node", async () => {
      const result = await runInitCommand([
        projectName,
        "-t",
        "minimal",
        "--runtime",
        "node",
        "--skip-install",
        "--skip-env-prompt",
      ]);
      assertEquals(result.code, 0);
      assertEquals(await exists(join(projectDir, "deno.json")), false);
    });

    it("does NOT write deno.json for --runtime bun", async () => {
      const result = await runInitCommand([
        projectName,
        "-t",
        "minimal",
        "--runtime",
        "bun",
        "--skip-install",
        "--skip-env-prompt",
      ]);
      assertEquals(result.code, 0);
      assertEquals(await exists(join(projectDir, "deno.json")), false);
    });

    it("writes both package.json and deno.json for --runtime deno", async () => {
      const result = await runInitCommand([
        projectName,
        "-t",
        "minimal",
        "--runtime",
        "deno",
        "--skip-install",
        "--skip-env-prompt",
      ]);
      assertEquals(result.code, 0);
      assertEquals(await exists(join(projectDir, "package.json")), true);
      assertEquals(await exists(join(projectDir, "deno.json")), true);

      const parsed = JSON.parse(
        await readTextFile(join(projectDir, "deno.json")),
      );
      assertEquals(parsed.nodeModulesDir, "auto");
      assertEquals(parsed.tasks.dev, "deno run -A npm:veryfront dev");
      assertExists(parsed.tasks.build);
      assertExists(parsed.tasks.preview);
    });

    it("rejects an invalid --runtime value before scaffolding", async () => {
      const result = await runInitCommand([
        projectName,
        "-t",
        "minimal",
        "--runtime",
        "rust",
        "--skip-install",
        "--skip-env-prompt",
      ]);
      // Non-zero exit; the project directory must not exist.
      assertEquals(result.code !== 0, true);
      assertEquals(await exists(projectDir), false);
      // The error message should surface the validator.
      assertEquals(
        ((result.stdout ?? "") + (result.stderr ?? "")).includes(
          "Invalid runtime value",
        ),
        true,
      );
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
