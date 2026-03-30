import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateSchema, generateCommandSchema } from "./command.ts";

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
    });

    it("each command has required fields", () => {
      const schema = generateSchema();
      for (const cmd of schema.commands) {
        assertEquals(typeof cmd.name, "string");
        assertEquals(typeof cmd.category, "string");
        assertEquals(typeof cmd.description, "string");
        assertEquals(Array.isArray(cmd.flags), true);
      }
    });
  });

  describe("generateCommandSchema", () => {
    it("returns schema for a known command", () => {
      const schema = generateCommandSchema("deploy");
      assertEquals(schema?.name, "deploy");
    });

    it("returns null for unknown command", () => {
      const schema = generateCommandSchema("nonexistent-command-xyz");
      assertEquals(schema, null);
    });
  });
});
