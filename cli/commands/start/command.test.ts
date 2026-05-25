import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { readTextFile } from "veryfront/platform";
import { startCommand } from "./command.ts";
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
