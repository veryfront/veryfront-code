import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteHostSecret, getHostEnv } from "#cli/process-env";
import { saveToken } from "../../auth/token-store.ts";
import {
  createGlobalErrorLogContext,
  hasProxyCredentials,
  hydrateStartRuntimeAuth,
  selectStartProject,
  shouldSkipProjectDirectory,
  startCommand,
} from "./command.ts";
import { startHelp } from "./command-help.ts";
import type { StartOptions } from "./command.ts";

const ENV_KEYS = [
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_PROJECT_SLUG",
  "VERYFRONT_SERVICE_LAYER",
  "XDG_CONFIG_HOME",
] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, Deno.env.get(key)]));
let tempDirs: string[] = [];

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) Deno.env.delete(key);
    else Deno.env.set(key, value);
  }
  deleteHostSecret("VERYFRONT_API_TOKEN");
}

describe("commands/start/command", () => {
  afterEach(async () => {
    restoreEnv();
    await Promise.all(tempDirs.map((dir) => Deno.remove(dir, { recursive: true })));
    tempDirs = [];
  });

  describe("startCommand", () => {
    it("is exported as a function", () => {
      assertExists(startCommand);
      assertEquals(typeof startCommand, "function");
    });

    it("is an async function", () => {
      assertEquals(startCommand.constructor.name, "AsyncFunction");
    });

    it("accepts a single StartOptions parameter", () => {
      assertEquals(startCommand.length, 1);
    });
  });

  describe("global error logging", () => {
    it("withholds stacks from user-facing start output", () => {
      const error = new Error("render failed");
      error.stack = "Error: render failed\n    at <PROJECT_ROOT>/app.ts:1:1";

      assertEquals(
        createGlobalErrorLogContext(error, "unhandledRejection", false),
        {
          message: "render failed",
          type: "unhandledRejection",
          fatal: false,
        },
      );
    });
  });

  describe("StartOptions interface", () => {
    it("supports all required fields", () => {
      const options: StartOptions = {
        port: 8080,
        projectPath: null,
        headless: false,
      };
      assertEquals(options.port, 8080);
      assertEquals(options.projectPath, null);
      assertEquals(options.headless, false);
    });

    it("accepts a string project path", () => {
      const options: StartOptions = {
        port: 8080,
        projectPath: "/path/to/project",
        headless: false,
      };
      assertEquals(options.projectPath, "/path/to/project");
    });

    it("accepts headless mode enabled", () => {
      const options: StartOptions = {
        port: 3000,
        projectPath: null,
        headless: true,
      };
      assertEquals(options.headless, true);
    });

    it("accepts custom port values", () => {
      const options: StartOptions = {
        port: 4000,
        projectPath: null,
        headless: false,
      };
      assertEquals(options.port, 4000);
    });
  });

  describe("selectStartProject", () => {
    it("uses the explicit default project when present", () => {
      const selected = selectStartProject({
        projects: new Map([
          ["alpha", "/repo/projects/alpha"],
          ["beta", "/repo/projects/beta"],
        ]),
        examples: new Map(),
        defaultProject: "beta",
      }, "/repo");

      assertEquals(selected, {
        projectDir: "/repo/projects/beta",
        projectSlug: "beta",
      });
    });

    it("uses a discovered project instead of the collection root", () => {
      const selected = selectStartProject({
        projects: new Map([
          ["zeta", "/repo/projects/zeta"],
          ["alpha", "/repo/projects/alpha"],
        ]),
        examples: new Map(),
        defaultProject: null,
      }, "/repo");

      assertEquals(selected, {
        projectDir: "/repo/projects/alpha",
        projectSlug: "alpha",
      });
    });

    it("falls back to examples when no projects are discovered", () => {
      const selected = selectStartProject({
        projects: new Map(),
        examples: new Map([
          ["demo", "/repo/examples/demo"],
        ]),
        defaultProject: null,
      }, "/repo");

      assertEquals(selected, {
        projectDir: "/repo/examples/demo",
        projectSlug: "demo",
      });
    });

    it("uses the current directory only when no project was discovered", () => {
      const selected = selectStartProject({
        projects: new Map(),
        examples: new Map(),
        defaultProject: null,
      }, "/repo");

      assertEquals(selected, {
        projectDir: "/repo",
        projectSlug: undefined,
      });
    });
  });

  describe("hydrateStartRuntimeAuth", () => {
    async function setupProject(): Promise<string> {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-start-project-" });
      const configHome = await Deno.makeTempDir({ prefix: "vf-start-config-" });
      tempDirs.push(projectDir, configHome);
      for (const key of ENV_KEYS) Deno.env.delete(key);
      Deno.env.set("XDG_CONFIG_HOME", configHome);
      await saveToken("stored-token");
      return projectDir;
    }

    it("does not turn a discovered directory slug into cloud authorization scope", async () => {
      const projectDir = await setupProject();

      const linkedProjectSlug = await hydrateStartRuntimeAuth({
        projectDir,
        projectSlug: "directory-slug",
      });

      assertEquals(linkedProjectSlug, undefined);
      // The stored login token is kept out of the process environment that
      // locally served project code can read.
      assertEquals(Deno.env.get("VERYFRONT_API_TOKEN"), undefined);
      assertEquals(getHostEnv("VERYFRONT_API_TOKEN"), "stored-token");
      assertEquals(Deno.env.get("VERYFRONT_PROJECT_SLUG"), undefined);
      assertEquals(Deno.env.get("VERYFRONT_SERVICE_LAYER"), "cloud");
    });

    it("uses a persisted project link for cloud authorization scope", async () => {
      const projectDir = await setupProject();
      await Deno.writeTextFile(
        `${projectDir}/veryfront.json`,
        JSON.stringify({ projectSlug: "linked-project" }),
      );

      const linkedProjectSlug = await hydrateStartRuntimeAuth({
        projectDir,
        projectSlug: "directory-slug",
      });

      assertEquals(linkedProjectSlug, "linked-project");
      assertEquals(Deno.env.get("VERYFRONT_PROJECT_SLUG"), "linked-project");
    });
  });

  describe("shouldSkipProjectDirectory", () => {
    it("skips private and hidden project folders", () => {
      assertEquals(shouldSkipProjectDirectory(".cache"), true);
      assertEquals(shouldSkipProjectDirectory("_legacy-templates"), true);
      assertEquals(shouldSkipProjectDirectory("analytics-dashboard"), false);
    });
  });

  describe("production MCP boundary", () => {
    it("does not start the CLI MCP server from production start", async () => {
      const source = await Deno.readTextFile(new URL("./command.ts", import.meta.url));

      assertEquals(source.includes("../../mcp"), false);
      assertEquals(source.includes("createMCPServer"), false);
    });

    it("does not advertise a production CLI MCP port", () => {
      const optionText = startHelp.options?.map((option) => option.flag).join("\n") ?? "";
      const helpText = JSON.stringify(startHelp);

      assertEquals(optionText.includes("mcp-port"), false);
      assertEquals(helpText.includes("9999"), false);
    });
  });

  describe("proxy engagement", () => {
    const read = (values: Record<string, string>) => (name: string) => values[name];

    it("stays off when nothing is configured", () => {
      assertEquals(hasProxyCredentials(read({})), false);
    });

    it("stays off for blank credentials", () => {
      assertEquals(
        hasProxyCredentials(read({
          VERYFRONT_PROXY_API_CLIENT_ID: "  ",
          VERYFRONT_PROXY_API_CLIENT_SECRET: "",
        })),
        false,
      );
    });

    it("stays off for a plain login token, so being logged in does not force proxy mode", () => {
      assertEquals(hasProxyCredentials(read({ VERYFRONT_API_TOKEN: "vf_login_token" })), false);
    });

    it("stays off with only half of a client credential pair", () => {
      assertEquals(
        hasProxyCredentials(read({ VERYFRONT_PROXY_API_CLIENT_ID: "id" })),
        false,
      );
      assertEquals(
        hasProxyCredentials(read({ VERYFRONT_PROXY_API_CLIENT_SECRET: "secret" })),
        false,
      );
    });

    it("engages for a complete client credential pair", () => {
      assertEquals(
        hasProxyCredentials(read({
          VERYFRONT_PROXY_API_CLIENT_ID: "id",
          VERYFRONT_PROXY_API_CLIENT_SECRET: "secret",
        })),
        true,
      );
    });

    it("engages for a credential pair even alongside a login token", () => {
      assertEquals(
        hasProxyCredentials(read({
          VERYFRONT_PROXY_API_CLIENT_ID: "id",
          VERYFRONT_PROXY_API_CLIENT_SECRET: "secret",
          VERYFRONT_API_TOKEN: "vf_login_token",
        })),
        true,
      );
    });
  });
});
