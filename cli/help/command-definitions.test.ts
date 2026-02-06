/**
 * Tests for command definitions
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { COMMANDS } from "./command-definitions.ts";

describe("command-definitions", () => {
  describe("COMMANDS", () => {
    it("is a non-empty object", () => {
      assertExists(COMMANDS);
      assertEquals(typeof COMMANDS, "object");
      assertEquals(Object.keys(COMMANDS).length > 0, true);
    });

    it("contains expected core commands", () => {
      assertExists(COMMANDS.init);
      assertExists(COMMANDS.dev);
      assertExists(COMMANDS.build);
      assertExists(COMMANDS.serve);
      assertExists(COMMANDS.doctor);
      assertExists(COMMANDS.clean);
      assertExists(COMMANDS.deploy);
    });

    it("each command has required properties", () => {
      for (const [key, cmd] of Object.entries(COMMANDS)) {
        assertExists(cmd.name, `${key} should have name`);
        assertExists(cmd.description, `${key} should have description`);
        assertExists(cmd.usage, `${key} should have usage`);
        assertExists(cmd.options, `${key} should have options array`);
        assertExists(cmd.examples, `${key} should have examples array`);
      }
    });

    it("command keys match command names", () => {
      for (const [key, cmd] of Object.entries(COMMANDS)) {
        assertEquals(key, cmd.name);
      }
    });
  });

  describe("init command", () => {
    const init = COMMANDS.init;

    it("has correct name and description", () => {
      assertEquals(init.name, "init");
      assertEquals(init.description, "Initialize a new Veryfront project");
    });

    it("has template option", () => {
      const templateOpt = init.options.find((o) => o.flag.includes("--template"));
      assertExists(templateOpt);
      assertEquals(templateOpt.default, "ai");
    });

    it("has examples", () => {
      assertEquals(init.examples.length > 0, true);
    });

    it("has notes", () => {
      assertExists(init.notes);
      assertEquals(init.notes!.length > 0, true);
    });
  });

  describe("dev command", () => {
    const dev = COMMANDS.dev;

    it("has correct name", () => {
      assertEquals(dev.name, "dev");
    });

    it("has port option with default", () => {
      const portOpt = dev.options.find((o) => o.flag.includes("--port"));
      assertExists(portOpt);
      assertEquals(portOpt.default, "3000");
    });
  });

  describe("build command", () => {
    const build = COMMANDS.build;

    it("has correct name", () => {
      assertEquals(build.name, "build");
    });

    it("has output option with default", () => {
      const outputOpt = build.options.find((o) => o.flag.includes("--output"));
      assertExists(outputOpt);
      assertEquals(outputOpt.default, ".veryfront/output");
    });
  });

  describe("login command", () => {
    const login = COMMANDS.login;

    it("has OAuth provider options", () => {
      const googleOpt = login.options.find((o) => o.flag.includes("--google"));
      const githubOpt = login.options.find((o) => o.flag.includes("--github"));
      const microsoftOpt = login.options.find((o) => o.flag.includes("--microsoft"));

      assertExists(googleOpt);
      assertExists(githubOpt);
      assertExists(microsoftOpt);
    });
  });

  describe("mcp command", () => {
    const mcp = COMMANDS.mcp;

    it("has correct name", () => {
      assertEquals(mcp.name, "mcp");
    });

    it("has no options", () => {
      assertEquals(mcp.options.length, 0);
    });

    it("has detailed notes about MCP tools", () => {
      assertExists(mcp.notes);
      const notesText = mcp.notes!.join(" ");
      assertEquals(notesText.includes("vf_list_templates"), true);
      assertEquals(notesText.includes("vf_create_project"), true);
    });
  });
});
