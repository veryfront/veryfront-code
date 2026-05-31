import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { Tool } from "#veryfront/tool/types.ts";
import type { Agent } from "../types.ts";
import { RunResumeSessionManager } from "../runtime/index.ts";
import { type AgUiResumeValue, buildMergedAgUiTools } from "./tool-shared.ts";

const inputSchema = defineSchema((v) =>
  v.object({
    min: v.number(),
    max: v.number(),
  })
);

describe("buildMergedAgUiTools", () => {
  it("preserves concrete source tools when forwarded metadata uses the same name", async () => {
    const sourceTool: Tool = {
      id: "number-generator",
      type: "function",
      description: "Generates a random number.",
      inputSchema: inputSchema(),
      inputSchemaJson: {
        type: "object",
        required: ["min", "max"],
        properties: {
          min: { type: "number" },
          max: { type: "number" },
        },
      },
      execute: async () => ({ randomNumber: 7 }),
    };
    const agent = {
      config: {
        tools: {
          "number-generator": sourceTool,
        },
      },
    } as unknown as Agent;
    const sessionManager = new RunResumeSessionManager<AgUiResumeValue>();

    const mergedTools = buildMergedAgUiTools(agent, "run_1", [
      {
        name: "number-generator",
        description: "Forwarded project tool metadata.",
        parameters: { type: "object", properties: {} },
      },
      { name: "studio_open_preview" },
    ], sessionManager) as Record<string, Tool>;

    const preservedTool = mergedTools["number-generator"]!;
    assertEquals(preservedTool, sourceTool);
    assertEquals(await preservedTool.execute?.({ min: 1, max: 100 }), {
      randomNumber: 7,
    });
    assertEquals(typeof mergedTools.studio_open_preview?.execute, "function");
  });

  it("preserves source-declared tool references when forwarded metadata uses the same name", () => {
    const agent = {
      config: {
        tools: {
          "number-generator": true,
        },
      },
    } as unknown as Agent;
    const sessionManager = new RunResumeSessionManager<AgUiResumeValue>();

    const mergedTools = buildMergedAgUiTools(agent, "run_1", [
      {
        name: "number-generator",
        description: "Forwarded project tool metadata.",
        parameters: { type: "object", properties: {} },
      },
    ], sessionManager) as Record<string, Tool | boolean>;

    assertEquals(mergedTools["number-generator"], true);
  });
});
