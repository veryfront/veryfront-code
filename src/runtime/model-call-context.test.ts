import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type {
  ModelCallContext,
  ModelCallMessage,
  ModelCallRecorder,
  ModelCallTool,
} from "./model-call-context.ts";

describe("model-call-context", () => {
  it("describes only the provider-agnostic prompt and resolved tools", async () => {
    const prompt: ModelCallMessage[] = [{
      role: "assistant",
      content: [{
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "search",
        input: { query: "Veryfront" },
      }],
    }];
    const tools: ModelCallTool[] = [{
      type: "provider",
      name: "web_search",
      id: "anthropic.web_search_20250305",
      args: { maxUses: 3 },
    }];
    const contexts: ModelCallContext[] = [];
    const recorder: ModelCallRecorder = (context) => {
      contexts.push(context);
    };

    await recorder({ prompt, tools });

    assertEquals(contexts, [{ prompt, tools }]);

    const providerPrivateReasoning: ModelCallMessage = {
      role: "assistant",
      content: [
        // @ts-expect-error signed provider reasoning is not part of ModelCallMessage
        { type: "reasoning", text: "private", signature: "signed" },
      ],
    };
    assertEquals(providerPrivateReasoning.role, "assistant");
  });
});
