import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { agent } from "#veryfront/agent/index.ts";
import { tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";

describe("private SSE recovery strings", () => {
  it("recovers a streamed suffix without exposing private text to replaced string methods", async () => {
    const marker = "Created the assistant.";
    const model = scriptedModel([
      {
        parts: [
          { type: "text-delta", text: marker },
          { type: "tool-input-start", id: "synthetic-recovery", toolName: "studio_suggestions" },
          { type: "tool-input-delta", id: "synthetic-recovery", delta: "{}" },
          { type: "finish", finishReason: "tool-calls" },
        ],
      },
      { text: `${marker} It is ready.` },
    ]);
    const assistant = agent(
      {
        model: "hosted/synthetic-recovery",
        system: "Synthetic recovery instructions",
        maxSteps: 3,
        __vfToolLoadingMode: "eager",
        resolveModelTransport: () => ({ model }),
        tools: {
          studio_suggestions: tool({
            id: "studio_suggestions",
            description: "Capture synthetic suggestions",
            inputSchema: defineSchema((v) => v.object({}))(),
            execute: () => Promise.resolve({ suggestions: [] }),
          }),
        },
      } as Parameters<typeof agent>[0],
    );
    const startsWith = String.prototype.startsWith;
    const slice = String.prototype.slice;
    const includes = String.prototype.includes;
    let observations = 0;
    const chunks: string[] = [];
    try {
      String.prototype.startsWith = function (search, position) {
        if (Reflect.apply(includes, this, [marker])) observations++;
        return Reflect.apply(startsWith, this, [search, position]);
      };
      String.prototype.slice = function (start, end) {
        if (Reflect.apply(includes, this, [marker])) observations++;
        return Reflect.apply(slice, this, [start, end]);
      };
      const response = await assistant.stream({
        input: "Create an assistant",
        onChunk: (text) => chunks.push(text),
      });
      await response.toDataStreamResponse().text();
    } finally {
      String.prototype.startsWith = startsWith;
      String.prototype.slice = slice;
    }
    assertEquals(model.callCount, 2);
    assertEquals(chunks, [marker, " It is ready."]);
    assertEquals(observations, 0);
  });
});
