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
import { VERSION } from "#cli/utils";
import { join } from "#veryfront/compat/path/index.ts";
import { exists, makeTempDir, readTextFile, remove, stat } from "#veryfront/testing/deno-compat.ts";
import { runCommand } from "#veryfront/compat/process.ts";
import { STARTER_TEMPLATE_NAMES } from "../../../templates/types.ts";
import type { InitOptions } from "./types.ts";

const TEST_DIR = await makeTempDir({ prefix: "veryfront-init-test-" });
const EXPECTED_FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#fff"/>
  <circle cx="32" cy="32" r="20" fill="#000"/>
</svg>
`;

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
  options: InitOptions,
  cwd = TEST_DIR,
  env?: Record<string, string>,
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
    env,
  });
}

async function createFakeNpm(
  mode: "success" | "failure",
): Promise<{ binDir: string; logPath: string }> {
  const binDir = await makeTempDir({ prefix: "veryfront-fake-npm-" });
  const logPath = join(binDir, "npm.log");
  const isWindows = Deno.build.os === "windows";
  const npmPath = join(binDir, isWindows ? "npm.cmd" : "npm");
  const script = isWindows
    ? [
      "@echo off",
      `>>"${logPath}" echo %CD% %*`,
      ...(mode === "success"
        ? [
          `>package-lock.json echo {"lockfileVersion":3,"packages":{}}`,
          "exit /b 0",
        ]
        : ["exit /b 42"]),
      "",
    ].join("\r\n")
    : `#!/usr/bin/env sh
printf '%s\\n' "$PWD $*" >> "${logPath}"
if [ "${mode}" = "success" ]; then
  printf '%s\\n' '{"lockfileVersion":3,"packages":{}}' > package-lock.json
  exit 0
fi
exit 42
`;
  await Deno.writeTextFile(npmPath, script);
  if (!isWindows) {
    await Deno.chmod(npmPath, 0o755);
  }
  return { binDir, logPath };
}

function withPath(binDir: string): Record<string, string> {
  const delimiter = Deno.build.os === "windows" ? ";" : ":";
  return {
    PATH: `${binDir}${delimiter}${Deno.env.get("PATH") ?? ""}`,
    GIT_AUTHOR_NAME: "Veryfront Test",
    GIT_AUTHOR_EMAIL: "test@veryfront.local",
    GIT_COMMITTER_NAME: "Veryfront Test",
    GIT_COMMITTER_EMAIL: "test@veryfront.local",
  };
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const result = await runCommand("git", {
    args,
    cwd,
    capture: true,
  });
  assertEquals(result.code, 0, (result.stdout ?? "") + (result.stderr ?? ""));
  return result.stdout ?? "";
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
      const result = await runInitCommand([
        projectName,
        "-t",
        "ai-agent",
        "--skip-install",
        "--color",
      ]);

      assertEquals(result.code, 0);
      assertEquals(result.stdout?.includes("\x1b[38;2;238;178;146m✓"), false);
      assertEquals(result.stdout?.includes("✓"), true);
      assertEquals(result.stdout?.includes("Creating new Veryfront project"), false);
      assertEquals(result.stdout?.includes("ready!"), false);
      assertEquals(result.stdout?.includes("Deploy:"), true);
      assertEquals(result.stdout?.includes("Project structure"), false);
      assertEquals(result.stdout?.includes("npm run deploy"), true);
      assertEquals(result.stdout?.includes("npx veryfront@latest deploy"), false);
      assertEquals(result.stdout?.includes("npx veryfront deploy"), false);
      assertEquals(result.stdout?.includes("Project files created"), false);
      assertEquals(result.stdout?.includes("Dependencies installed"), false);
      assertEquals(result.stdout?.includes("Git repository initialized"), false);
      assertEquals(result.stdout?.includes("OPENAI_API_KEY"), false);
      assertEquals(result.stdout?.includes("auto-discovered"), false);

      const statResult = await stat(join(projectDir, "agents"));
      assertEquals(statResult.isDirectory, true);
    });

    it("shows the generated project structure in verbose mode", async () => {
      const verboseName = `verbose-${randomSuffix()}`;
      const verboseDir = join(TEST_DIR, verboseName);

      try {
        const result = await runInitCommand([
          verboseName,
          "-t",
          "ai-agent",
          "--skip-install",
          "--verbose",
        ]);

        assertEquals(result.code, 0);
        assertEquals(result.stdout?.includes("Project structure"), true);
        assertEquals(result.stdout?.includes("app/"), true);
        assertEquals(result.stdout?.includes("agents/"), true);
        assertEquals(result.stdout?.includes("tools/"), true);
      } finally {
        await remove(verboseDir, { recursive: true }).catch(() => {});
      }
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
    it("commits the lockfile and leaves the scaffold clean after installing dependencies", async () => {
      const name = `git-lock-${randomSuffix()}`;
      const dir = join(TEST_DIR, name);
      const fakeNpm = await createFakeNpm("success");

      try {
        const result = await runQuietInitCommand(
          {
            name,
            template: "minimal",
            runtime: "node",
            initGit: true,
            skipEnvPrompt: true,
            quiet: true,
          },
          TEST_DIR,
          withPath(fakeNpm.binDir),
        );

        assertEquals(result.code, 0, (result.stdout ?? "") + (result.stderr ?? ""));
        assertEquals(
          await readTextFile(join(dir, "package-lock.json")),
          `{"lockfileVersion":3,"packages":{}}${Deno.build.os === "windows" ? "\r\n" : "\n"}`,
        );
        assertEquals(
          (await runGit(["ls-files", "package-lock.json"], dir)).trim(),
          "package-lock.json",
        );
        assertEquals(await runGit(["status", "--porcelain"], dir), "");
      } finally {
        await remove(dir, { recursive: true }).catch(() => {});
        await remove(fakeNpm.binDir, { recursive: true }).catch(() => {});
      }
    });

    it("does not leave a pending install spinner in non-interactive output", async () => {
      const name = `install-output-${randomSuffix()}`;
      const dir = join(TEST_DIR, name);
      const fakeNpm = await createFakeNpm("success");

      try {
        const result = await runInitCommand([
          name,
          "-t",
          "minimal",
          "--skip-env-prompt",
        ], {
          env: withPath(fakeNpm.binDir),
        });
        const output = (result.stdout ?? "") + (result.stderr ?? "");

        assertEquals(result.code, 0, output);
        assertEquals(output.includes("Installing dependencies"), false);
      } finally {
        await remove(dir, { recursive: true }).catch(() => {});
        await remove(fakeNpm.binDir, { recursive: true }).catch(() => {});
      }
    });

    it("does not invoke the package manager when install is skipped", async () => {
      const name = `skip-install-${randomSuffix()}`;
      const dir = join(TEST_DIR, name);
      const fakeNpm = await createFakeNpm("success");

      try {
        const result = await runQuietInitCommand(
          {
            name,
            template: "minimal",
            runtime: "node",
            initGit: true,
            skipInstall: true,
            skipEnvPrompt: true,
            quiet: true,
          },
          TEST_DIR,
          withPath(fakeNpm.binDir),
        );

        assertEquals(result.code, 0, (result.stdout ?? "") + (result.stderr ?? ""));
        assertEquals(await exists(fakeNpm.logPath), false);
        assertEquals(await exists(join(dir, "package-lock.json")), false);
        assertEquals(await runGit(["status", "--porcelain"], dir), "");
      } finally {
        await remove(dir, { recursive: true }).catch(() => {});
        await remove(fakeNpm.binDir, { recursive: true }).catch(() => {});
      }
    });

    it("commits generated files and reports npm install recovery when dependency install fails", async () => {
      const name = `failed-install-${randomSuffix()}`;
      const dir = join(TEST_DIR, name);
      const fakeNpm = await createFakeNpm("failure");

      try {
        const result = await runQuietInitCommand(
          {
            name,
            template: "minimal",
            runtime: "node",
            initGit: true,
            skipEnvPrompt: true,
          },
          TEST_DIR,
          withPath(fakeNpm.binDir),
        );
        const output = (result.stdout ?? "") + (result.stderr ?? "");

        assertEquals(result.code, 0, output);
        assertEquals(output.includes("Run 'npm install' manually to install dependencies."), true);
        assertEquals(await exists(join(dir, ".git")), true);
        assertEquals(
          (await runGit(["ls-files", "app/page.tsx", "package.json", ".gitignore"], dir))
            .trim()
            .split("\n")
            .sort(),
          [".gitignore", "app/page.tsx", "package.json"],
        );
        assertEquals(await runGit(["status", "--porcelain"], dir), "");
      } finally {
        await remove(dir, { recursive: true }).catch(() => {});
        await remove(fakeNpm.binDir, { recursive: true }).catch(() => {});
      }
    });

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
      assertEquals(await exists(join(projectDir, "public", "favicon.svg")), true);

      const packageJson = await readTextFile(join(projectDir, "package.json"));
      assertExists(packageJson.includes("veryfront"));
    });

    it("includes a favicon fallback in the default ai-agent starter", async () => {
      const result = await runInitCommand([projectName, "--skip-install"]);

      assertEquals(result.code, 0);
      assertEquals(await exists(join(projectDir, "public", "favicon.svg")), true);
      assertEquals(await exists(join(projectDir, "public", "favicon.ico")), false);
    });

    it("creates coding-agent instructions and the minimal favicon for every starter", async () => {
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
          assertEquals(content.includes("veryfront dev"), true);
          assertEquals(content.includes("veryfront schema --json"), true);
          assertEquals(content.includes("veryfront routes"), true);
          assertEquals(content.includes("src/pages"), false);
          assertEquals(
            await readTextFile(join(dir, "public", "favicon.svg")),
            EXPECTED_FAVICON,
          );
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
      assertEquals(
        pkg.dependencies["@veryfront/ext-document-kreuzberg"],
        pkg.dependencies.veryfront,
      );
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
            assertEquals(pkg.scripts.start, "veryfront serve");
            assertEquals(pkg.scripts.eval, "veryfront eval");
            assertEquals(pkg.scripts.deploy, "veryfront deploy");
            assertEquals(pkg.scripts.preview, undefined);
            assertExists(pkg.dependencies.veryfront);
            assertExists(pkg.dependencies.react);
            assertExists(pkg.dependencies["react-dom"]);
            assertEquals(pkg.dependencies.zod, undefined);

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
      assertEquals(parsed.tasks.dev, `deno run -A npm:veryfront@${VERSION} dev`);
      assertExists(parsed.tasks.build);
      assertExists(parsed.tasks.start);
      assertExists(parsed.tasks.eval);
      assertEquals(parsed.tasks.preview, undefined);
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
    it("should skip wizard and use ai-agent template when name is provided", async () => {
      // When a name is provided, wizard should be skipped
      const result = await runInitCommand([projectName, "--skip-install"]);

      assertEquals(result.code, 0);
      assertEquals(await exists(join(projectDir, "agents", "assistant.ts")), true);
      assertEquals(await exists(join(projectDir, "tools", "calculator.ts")), true);
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

  describe("--deploy authentication", () => {
    it("does not treat a parent config credential as the new project's stored session", async () => {
      const parentDir = await makeTempDir({ prefix: "veryfront-init-auth-parent-" });
      const name = `deploy-auth-${randomSuffix()}`;
      const projectDir = join(parentDir, name);
      const server = Deno.serve(
        { hostname: "127.0.0.1", port: 0, onListen: () => {} },
        () => {
          requests++;
          return Response.json({ id: "user-1", email: "dev@example.test" });
        },
      );
      const baseUrl = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;
      let requests = 0;

      try {
        await Deno.writeTextFile(
          join(parentDir, "veryfront.json"),
          `${
            JSON.stringify(
              {
                apiToken: "parent-config-token",
                apiUrl: baseUrl,
                projectSlug: "parent-project",
              },
              null,
              2,
            )
          }\n`,
        );

        const result = await runInitCommand(
          [
            name,
            "--template",
            "minimal",
            "--skip-install",
            "--skip-env-prompt",
            "--deploy",
            "--no-color",
          ],
          {
            cwd: parentDir,
            env: {
              VERYFRONT_API_TOKEN: "",
              XDG_CONFIG_HOME: join(parentDir, "config"),
              VERYFRONT_NO_UPDATE_CHECK: "1",
              CI: "1",
              NO_COLOR: "1",
            },
          },
        );
        const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

        assertEquals(result.code, 0);
        assertEquals(requests, 0);
        assertEquals(output.includes("Authentication required for --deploy."), true);
        assertEquals(output.includes("Could not read auth token."), false);
        assertEquals(await exists(join(projectDir, "app", "page.tsx")), true);
      } finally {
        await server.shutdown();
        await remove(parentDir, { recursive: true }).catch(() => {});
      }
    });

    it("deploys with a credential from the created project's config", async () => {
      const parentDir = await makeTempDir({ prefix: "veryfront-init-auth-project-" });
      const name = `deploy-auth-${randomSuffix()}`;
      const projectDir = join(parentDir, name);
      const requests: Array<{ path: string; authorization: string | null }> = [];
      const server = Deno.serve(
        { hostname: "127.0.0.1", port: 0, onListen: () => {} },
        (request) => {
          const url = new URL(request.url);
          requests.push({
            path: url.pathname,
            authorization: request.headers.get("authorization"),
          });
          if (url.pathname === "/me") {
            return Response.json({ id: "user-1", email: "dev@example.test" });
          }
          return Response.json({ error: "deployment unavailable" }, { status: 500 });
        },
      );
      const baseUrl = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;

      try {
        await Deno.mkdir(projectDir);
        await Deno.writeTextFile(
          join(projectDir, "veryfront.json"),
          `${
            JSON.stringify(
              {
                apiToken: "project-config-token",
                apiUrl: baseUrl,
                projectSlug: "created-project",
              },
              null,
              2,
            )
          }\n`,
        );

        const result = await runInitCommand(
          [
            name,
            "--template",
            "minimal",
            "--skip-install",
            "--skip-env-prompt",
            "--force",
            "--deploy",
            "--no-color",
          ],
          {
            cwd: parentDir,
            env: {
              VERYFRONT_API_TOKEN: "",
              XDG_CONFIG_HOME: join(parentDir, "config"),
              VERYFRONT_NO_UPDATE_CHECK: "1",
              CI: "1",
              NO_COLOR: "1",
            },
          },
        );
        const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

        assertEquals(result.code, 0);
        assertEquals(output.includes("Deploying project..."), true);
        assertEquals(output.includes("Could not read auth token."), false);
        assertEquals(output.includes("Deploy failed:"), true);
        assertEquals(output.includes("Your project was created locally."), true);
        assertEquals(output.includes("to deploy later."), true);
        assertEquals(requests[0], {
          path: "/me",
          authorization: "Bearer project-config-token",
        });
        assertEquals(
          requests.some((request) =>
            request.path !== "/me" &&
            request.authorization === "Bearer project-config-token"
          ),
          true,
        );
        assertEquals(await exists(join(projectDir, "app", "page.tsx")), true);
      } finally {
        await server.shutdown();
        await remove(parentDir, { recursive: true }).catch(() => {});
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

    it("does not emit ANSI when color is disabled", async () => {
      const result = await runInitCommand([
        projectName,
        "-t",
        "minimal",
        "--skip-install",
        "--no-color",
      ]);

      assertEquals(result.code, 0);
      assertEquals(result.stdout?.includes("\x1b["), false);
      assertEquals(result.stderr?.includes("\x1b["), false);
    });
  });
});
