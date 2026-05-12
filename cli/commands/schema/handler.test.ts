import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateCommandSchema, generateSchema } from "./command.ts";

describe("Schema Command", () => {
  describe("generateSchema", () => {
    it("returns object with version and commands array", () => {
      const schema = generateSchema();
      assertEquals(typeof schema.version, "string");
      assertEquals(Array.isArray(schema.commands), true);
    });

    it("includes all registered commands", () => {
      const schema = generateSchema();
      const names = schema.commands.map((c: { name: string }) => c.name);
      assertEquals(names.includes("deploy"), true);
      assertEquals(names.includes("build"), true);
      assertEquals(names.includes("dev"), true);
      assertEquals(names.includes("schema"), true);
      assertEquals(names.includes("test"), true);
      assertEquals(names.includes("lint"), true);
      assertEquals(names.includes("skills"), true);
    });

    it("each command has required fields", () => {
      const schema = generateSchema();
      for (const cmd of schema.commands) {
        assertEquals(typeof cmd.name, "string");
        assertEquals(typeof cmd.category, "string");
        assertEquals(typeof cmd.description, "string");
        assertEquals(Array.isArray(cmd.flags), true);
        assertEquals(Array.isArray(cmd.examples), true);
        assertEquals(typeof cmd.usage, "string");
      }
    });

    it("filters by category", () => {
      const schema = generateSchema("auth");
      const names = schema.commands.map((c) => c.name);
      assertEquals(names.includes("login"), true);
      assertEquals(names.includes("logout"), true);
      assertEquals(names.includes("whoami"), true);
      assertEquals(names.includes("deploy"), false);
      assertEquals(names.includes("build"), false);
    });

    it("returns empty for nonexistent category", () => {
      const schema = generateSchema("nonexistent" as "auth");
      assertEquals(schema.commands.length, 0);
    });

    it("all commands have valid categories", () => {
      const validCategories = [
        "development",
        "deploy",
        "project",
        "files",
        "ai",
        "auth",
      ];
      const schema = generateSchema();
      for (const cmd of schema.commands) {
        assertEquals(
          validCategories.includes(cmd.category),
          true,
          `Command "${cmd.name}" has invalid category "${cmd.category}"`,
        );
      }
    });

    it("includes global flags in each command", () => {
      const schema = generateSchema();
      for (const cmd of schema.commands) {
        assertEquals(cmd.flags.includes("--json"), true);
        assertEquals(cmd.flags.includes("--help"), true);
        assertEquals(cmd.flags.includes("--yes"), true);
      }
    });
  });

  describe("generateCommandSchema", () => {
    it("returns schema for a known command", () => {
      const schema = generateCommandSchema("deploy");
      assertEquals(schema?.name, "deploy");
      assertEquals(schema?.category, "deploy");
    });

    it("returns null for unknown command", () => {
      const schema = generateCommandSchema("nonexistent-command-xyz");
      assertEquals(schema, null);
    });

    it("includes options for commands that have them", () => {
      const schema = generateCommandSchema("deploy");
      assertEquals(Array.isArray(schema?.options), true);
      assertEquals((schema?.options?.length ?? 0) > 0, true);
    });

    it("returns empty options for commands without them", () => {
      const schema = generateCommandSchema("mcp");
      assertEquals(Array.isArray(schema?.options), true);
    });
  });
});
