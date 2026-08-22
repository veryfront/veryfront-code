import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getDevServerCommand } from "./template-runtime-e2e.ts";
import {
  getDevServerEnvironment,
  inspectModuleExports,
  startDevServer,
  stopDevServer,
} from "./runtime-e2e-helpers.ts";

describe("template runtime E2E commands", () => {
  it("exports the shared harness without running the E2E flow on import", async () => {
    assertEquals(
      await inspectModuleExports(
        new URL("./template-runtime-e2e.ts", import.meta.url),
        "template runtime",
      ),
      [
        "assertCondition",
        "ensureCommand",
        "getDevServerCommand",
        "installDependencies",
        "packNpmPackage",
        "parseCommaSeparatedFlag",
        "runChecked",
        "scaffoldProject",
        "startDevServer",
        "stopDevServer",
        "waitForRoute",
      ],
      "Template runtime module should export only shared harness helpers on import",
    );
  });

  it("passes the selected port through Deno task without a separator", () => {
    assertEquals(
      getDevServerCommand("deno", 4321),
      {
        command: "deno",
        args: ["task", "dev", "--port", "4321"],
      },
      "Deno dev command should pass the selected port directly to the task",
    );
  });

  it("preserves the script argument separator for npm and Bun", () => {
    assertEquals(
      getDevServerCommand("node", 4321),
      {
        command: "npm",
        args: ["run", "dev", "--", "--port", "4321"],
      },
      "Node dev command should preserve npm's script argument separator",
    );
    assertEquals(
      getDevServerCommand("bun", 4321),
      {
        command: "bun",
        args: ["run", "dev", "--", "--port", "4321"],
      },
      "Bun dev command should preserve Bun's script argument separator",
    );
  });

  it("merges child-only environment overrides with deterministic defaults", () => {
    assertEquals(
      getDevServerEnvironment({
        ANTHROPIC_API_KEY: "test-key",
        ANTHROPIC_BASE_URL: "http://127.0.0.1:4312/v1",
      }),
      {
        ANTHROPIC_API_KEY: "test-key",
        GOOGLE_API_KEY: "",
        GOOGLE_GENERATIVE_AI_API_KEY: "",
        LOG_FORMAT: "text",
        MISTRAL_API_KEY: "",
        NODE_ENV: "development",
        OPENAI_API_KEY: "",
        REVALIDATION_PER_PROJECT_LIMIT: "0",
        SSR_TRANSFORM_PER_PROJECT_LIMIT: "0",
        VF_DISABLE_LRU_INTERVAL: "1",
        VERYFRONT_API_TOKEN: "",
        ANTHROPIC_BASE_URL: "http://127.0.0.1:4312/v1",
      },
      "Dev server environment should blank competing credentials and isolate scenario overrides in the child process",
    );
  });

  it("terminates npm script descendants when stopping a Node dev server", async () => {
    if (Deno.build.os === "windows") return;

    const projectDir = await Deno.makeTempDir({
      prefix: "veryfront-runtime-server-cleanup-",
    });
    const pidFile = `${projectDir}/server.pid`;
    let descendantPid: number | undefined;
    let server: ReturnType<typeof startDevServer> | undefined;

    try {
      await Deno.writeTextFile(
        `${projectDir}/package.json`,
        `${JSON.stringify({ scripts: { dev: "node server.mjs" } })}\n`,
      );
      await Deno.writeTextFile(
        `${projectDir}/server.mjs`,
        [
          'import { writeFileSync } from "node:fs";',
          "writeFileSync(process.env.RUNTIME_E2E_PID_FILE, String(process.pid));",
          'process.on("SIGTERM", () => {});',
          "setTimeout(() => {}, 10_000);",
        ].join("\n"),
      );
      server = startDevServer(projectDir, "node", 4321, {
        RUNTIME_E2E_PID_FILE: pidFile,
      });

      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        try {
          descendantPid = Number(await Deno.readTextFile(pidFile));
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
      assertEquals(Number.isSafeInteger(descendantPid), true);

      await stopDevServer(server);
      assertEquals(await isProcessAlive(descendantPid!), false);
    } finally {
      if (server) await stopDevServer(server).catch(() => {});
      if (descendantPid && await isProcessAlive(descendantPid)) {
        Deno.kill(descendantPid, "SIGKILL");
      }
      await Deno.remove(projectDir, { recursive: true }).catch(() => {});
    }
  });
});

async function isProcessAlive(pid: number): Promise<boolean> {
  const status = await new Deno.Command("kill", {
    args: ["-0", String(pid)],
    stdout: "null",
    stderr: "null",
  }).output();
  return status.success;
}
