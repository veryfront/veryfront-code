import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { exists, makeTempDir, remove } from "#veryfront/testing/deno-compat.ts";
import { join } from "veryfront/platform/path";
import { chdir, cwd } from "#cli/process-lifecycle";
import { parseCliArgs } from "#cli/shared/args";
import { setJsonMode, setOutputPath } from "#cli/shared/json-output";
import { handleInitCommand } from "#cli/commands/init/handler";
import type { InitCommandResult } from "#cli/commands/init/init-command";

const originalLog = console.log;

function successfulInitResult(projectDir: string): InitCommandResult {
  return {
    cancelled: false,
    projectDir,
    projectName: "json-app",
    createdPaths: ["app/page.tsx"],
    packageManager: "npm",
    dependencyInstallation: "skipped",
    gitInitialization: "skipped",
    setupTips: [],
    template: "minimal",
    runtime: "node",
    deployment: { status: "skipped" },
  };
}

afterEach(() => {
  console.log = originalLog;
  setJsonMode(false);
  setOutputPath(null);
});

describe("init handler JSON output", () => {
  it("redacts absolute projectDir in JSON success output", async () => {
    const logs: string[] = [];
    const parentDir = await makeTempDir({ prefix: "veryfront-init-handler-json-" });
    const previousCwd = cwd();
    const name = "json-app";
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    setJsonMode(true);

    try {
      chdir(parentDir);
      await handleInitCommand(
        parseCliArgs([
          "init",
          name,
          "--template",
          "minimal",
          "--skip-install",
          "--yes",
          "--json",
        ]),
      );

      const parsed = JSON.parse(logs.join("\n")) as {
        success: boolean;
        data: { projectDir: string; projectName: string };
      };

      assertEquals(parsed.success, true);
      assertEquals(parsed.data.projectDir, name);
      assertEquals(parsed.data.projectName, name);
      assertEquals(logs.join("\n").includes(parentDir), false);
      assertEquals(await exists(join(parentDir, name, "app", "page.tsx")), true);
    } finally {
      chdir(previousCwd);
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("uses config-file defaults while keeping JSON projectDir relative", async () => {
    const logs: string[] = [];
    const parentDir = await makeTempDir({ prefix: "veryfront-init-handler-config-" });
    const previousCwd = cwd();
    const name = "config-json-app";
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    setJsonMode(true);

    try {
      await Deno.writeTextFile(
        join(parentDir, "init.json"),
        `${
          JSON.stringify({
            name,
            template: "minimal",
            runtime: "deno",
            skipInstall: true,
            skipEnvPrompt: true,
          })
        }\n`,
      );

      chdir(parentDir);
      await handleInitCommand(
        parseCliArgs(["init", "--config", "init.json", "--yes", "--json"]),
      );

      const parsed = JSON.parse(logs.join("\n")) as {
        success: boolean;
        data: { projectDir: string; projectName: string; runtime: string };
      };

      assertEquals(parsed.success, true);
      assertEquals(parsed.data.projectDir, name);
      assertEquals(parsed.data.projectName, name);
      assertEquals(parsed.data.runtime, "deno");
      assertEquals(logs.join("\n").includes(parentDir), false);
      assertEquals(await exists(join(parentDir, name, "app", "page.tsx")), true);
      assertEquals(await exists(join(parentDir, name, "deno.json")), true);
    } finally {
      chdir(previousCwd);
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("classifies invalid init config JSON before scaffolding", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-init-handler-bad-config-" });
    const previousCwd = cwd();

    try {
      await Deno.writeTextFile(join(parentDir, "init.json"), "{bad json");
      chdir(parentDir);

      await assertRejects(
        () => handleInitCommand(parseCliArgs(["init", "--config", "init.json", "--yes"])),
        Error,
        "Invalid JSON syntax in config file",
      );

      assertEquals(await exists(join(parentDir, "app")), false);
    } finally {
      chdir(previousCwd);
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("classifies unreadable init config files before scaffolding", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-init-handler-missing-config-" });
    const previousCwd = cwd();

    try {
      chdir(parentDir);

      await assertRejects(
        () => handleInitCommand(parseCliArgs(["init", "--config", "missing.json", "--yes"])),
        Error,
        "Could not read file",
      );

      assertEquals(await exists(join(parentDir, "app")), false);
    } finally {
      chdir(previousCwd);
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("redacts absolute localProject paths in JSON deployment failures", async () => {
    const logs: string[] = [];
    const exitCodes: number[] = [];
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    setJsonMode(true);

    await handleInitCommand(
      parseCliArgs(["init", "json-app", "--yes", "--json", "--deploy"]),
      {
        cwd: () => "/workspace",
        exitProcess: (code) => {
          exitCodes.push(code);
        },
        initCommand: async () => ({
          ...successfulInitResult("/workspace/json-app"),
          deployment: { status: "failed", message: "Authentication required for --deploy." },
        }),
      },
    );

    const parsed = JSON.parse(logs.join("\n")) as {
      success: boolean;
      error: {
        context?: { localProject?: { projectDir: string; deployment: { status: string } } };
      };
    };

    assertEquals(parsed.success, false);
    assertEquals(parsed.error.context?.localProject?.projectDir, "json-app");
    assertEquals(parsed.error.context?.localProject?.deployment.status, "failed");
    assertEquals(logs.join("\n").includes("/workspace"), false);
    assertEquals(exitCodes, [1]);
  });
});
