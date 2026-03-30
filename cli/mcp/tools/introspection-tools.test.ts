import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { introspectionTools } from "./introspection-tools.ts";

describe("Introspection MCP Tools", () => {
  it("exports vf_get_schema tool", () => {
    const tool = introspectionTools.find((t) => t.name === "vf_get_schema");
    assertEquals(tool !== undefined, true);
    assertEquals(typeof tool?.description, "string");
    assertEquals(typeof tool?.execute, "function");
  });

  it("exports vf_get_project_info tool", () => {
    const tool = introspectionTools.find((t) => t.name === "vf_get_project_info");
    assertEquals(tool !== undefined, true);
    assertEquals(typeof tool?.description, "string");
    assertEquals(typeof tool?.execute, "function");
  });

  it("vf_get_schema returns schema with commands", async () => {
    const tool = introspectionTools.find((t) => t.name === "vf_get_schema")!;
    const result = await tool.execute({}) as { version: string; commands: unknown[] };
    assertEquals(typeof result.version, "string");
    assertEquals(Array.isArray(result.commands), true);
  });

  it("vf_get_schema filters by command name", async () => {
    const tool = introspectionTools.find((t) => t.name === "vf_get_schema")!;
    const result = await tool.execute({ command: "deploy" }) as { name: string };
    assertEquals(result.name, "deploy");
  });

  it("vf_get_schema returns error for unknown command", async () => {
    const tool = introspectionTools.find((t) => t.name === "vf_get_schema")!;
    const result = await tool.execute({ command: "nonexistent" }) as { error: string };
    assertEquals(typeof result.error, "string");
  });

  it("vf_get_schema filters by category", async () => {
    const tool = introspectionTools.find((t) => t.name === "vf_get_schema")!;
    const result = await tool.execute({ category: "auth" }) as {
      commands: { name: string; category: string }[];
    };
    assertEquals(Array.isArray(result.commands), true);
    for (const cmd of result.commands) {
      assertEquals(cmd.category, "auth");
    }
    assertEquals(result.commands.length > 0, true);
  });

  it("all tools have inputSchema", () => {
    for (const tool of introspectionTools) {
      assertEquals(tool.inputSchema !== undefined, true);
    }
  });
});
