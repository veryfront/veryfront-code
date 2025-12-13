import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { COMMANDS } from "./command-definitions.ts";

describe("command-definitions", () => {
  describe("COMMANDS export", () => {
    it("should export COMMANDS object", () => {
      assertExists(COMMANDS);
      assertEquals(typeof COMMANDS, "object");
    });

    it("should contain expected commands", () => {
      const expectedCommands = ["init", "dev", "build", "serve", "doctor", "clean", "routes", "analyze-chunks", "generate"];

      for (const cmd of expectedCommands) {
        assertExists(COMMANDS[cmd], `Missing command: ${cmd}`);
      }
    });

    it("should have proper command structure", () => {
      const cmd = COMMANDS["dev"];

      assertExists(cmd);
      assertExists(cmd.name);
      assertExists(cmd.description);
      assertExists(cmd.usage);
      assertExists(cmd.options);
      assertExists(cmd.examples);
    });

    it("should have init command with templates", () => {
      const initCmd = COMMANDS["init"];

      assertExists(initCmd);
      assertEquals(initCmd.name, "init");
      assertExists(initCmd.options);
      assertEquals(initCmd.options!.length > 0, true);
    });

    it("should have dev command with port option", () => {
      const devCmd = COMMANDS["dev"];

      assertExists(devCmd);
      assertEquals(devCmd.name, "dev");
      const portOption = devCmd.options?.find(opt => opt.flag.includes("port"));
      assertExists(portOption);
    });

    it("should have build command with output option", () => {
      const buildCmd = COMMANDS["build"];

      assertExists(buildCmd);
      assertEquals(buildCmd.name, "build");
      const outputOption = buildCmd.options?.find(opt => opt.flag.includes("output"));
      assertExists(outputOption);
    });
  });
});
