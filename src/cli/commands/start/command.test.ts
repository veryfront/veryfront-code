import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { startCommand } from "./command.ts";
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
        mcpPort: 9999,
        projectPath: null,
        headless: false,
      };
      assertEquals(options.port, 8080);
      assertEquals(options.mcpPort, 9999);
      assertEquals(options.projectPath, null);
      assertEquals(options.headless, false);
    });

    it("accepts a string project path", () => {
      const options: StartOptions = {
        port: 8080,
        mcpPort: 9999,
        projectPath: "/path/to/project",
        headless: false,
      };
      assertEquals(options.projectPath, "/path/to/project");
    });

    it("accepts headless mode enabled", () => {
      const options: StartOptions = {
        port: 3000,
        mcpPort: 9000,
        projectPath: null,
        headless: true,
      };
      assertEquals(options.headless, true);
    });

    it("accepts custom port values", () => {
      const options: StartOptions = {
        port: 4000,
        mcpPort: 5000,
        projectPath: null,
        headless: false,
      };
      assertEquals(options.port, 4000);
      assertEquals(options.mcpPort, 5000);
    });
  });
});
