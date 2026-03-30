import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { introspectionTools } from "./introspection-tools.ts";

describe("Introspection MCP Tools", () => {
  it("exports vf_get_schema tool", () => {
    const tool = introspectionTools.find((t) => t.name === "vf_get_schema");
    assertEquals(tool !== undefined, true);
  });

  it("exports vf_get_project_info tool", () => {
    const tool = introspectionTools.find((t) => t.name === "vf_get_project_info");
    assertEquals(tool !== undefined, true);
  });
});
