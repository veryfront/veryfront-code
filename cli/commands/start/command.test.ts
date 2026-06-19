import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { readTextFile } from "veryfront/platform";
import { selectStartProject, shouldSkipProjectDirectory, startCommand } from "./command.ts";
import { startHelp } from "./command-help.ts";
import type { StartOptions } from "./command.ts";

describe("commands/start/command", () => {
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

  describe("shouldSkipProjectDirectory", () => {
    it("skips private and hidden project folders", () => {
      assertEquals(shouldSkipProjectDirectory(".cache"), true);
      assertEquals(shouldSkipProjectDirectory("_legacy-templates"), true);
      assertEquals(shouldSkipProjectDirectory("analytics-dashboard"), false);
    });
  });

  describe("production MCP boundary", () => {
    it("does not start the CLI MCP server from production start", async () => {
      const source = await readTextFile("cli/commands/start/command.ts");

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
});
