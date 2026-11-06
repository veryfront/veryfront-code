import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Message } from "../types.ts";
import { AgentRuntime } from "./index.ts";
import { scriptedModel } from "./model-runtime.test-helpers.ts";

const input: Message[] = [{
  id: "user",
  role: "user",
  parts: [{ type: "text", text: "Say hello" }],
}];

describe("direct AgentRuntime construction with tools: false", () => {
  for (const mode of ["generate", "stream"] as const) {
    it(`ignores startup tools and skill and runs text-only (${mode})`, async () => {
      const model = scriptedModel([{ text: "hello" }], {
        modelId: "veryfront-cloud/openai/closed-selector",
      });
      const runtime = new AgentRuntime("closed-selector", {
        model: "veryfront-cloud/openai/closed-selector",
        system: "Answer directly.",
        security: false,
        maxSteps: 1,
        tools: false,
        skills: ["support"],
        bootstrapSkill: "support",
        bootstrapTools: ["load_skill"],
        optionalBootstrapTools: ["tool_search"],
        toolResultContext: true,
        knowledge: true,
      }, { resolveModelRuntime: () => model });

      if (mode === "generate") {
        const result = await runtime.generate(input);
        assertEquals(result.text, "hello");
      } else {
        await new Response(await runtime.stream(input)).text();
      }
      assertEquals(model.callCount, 1);
      const tools = (model.calls[0] as { tools?: unknown[] } | undefined)?.tools ?? [];
      assertEquals(tools, []);
    });
  }
});
