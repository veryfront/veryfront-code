import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { createWarningCollector } from "#veryfront/provider/shared/index.ts";
import { buildModelCallContextRequest } from "#veryfront/runtime/model-call-context-request.ts";
import type { ModelRuntimeCallOptions } from "veryfront/provider/types";
import { buildOpenAIChatRequest } from "./openai-chat-request-builder.ts";
import { buildOpenAIResponsesRequest } from "./openai-responses-request-builder.ts";

const prompt: ModelRuntimeCallOptions["prompt"] = [{
  role: "user",
  content: [{ type: "text", text: "Synthetic request" }],
}];
const tools: ModelRuntimeCallOptions["tools"] = [{
  type: "function",
  name: "lookup",
  inputSchema: { type: "object", properties: {} },
}];

it("records parallel tool control exactly as OpenAI chat and responses wire builders", () => {
  for (const transport of ["chat-completions", "responses"] as const) {
    for (const value of [false, true, undefined]) {
      for (const native of [undefined, false, true]) {
        const options = {
          prompt,
          tools,
          ...(value === undefined ? {} : { parallelToolCalls: value }),
          ...(native === undefined
            ? {}
            : { providerOptions: { openai: { parallel_tool_calls: native } } }),
        };
        const model = {
          provider: "openai",
          modelProvider: "openai",
          modelId: "gpt-4o",
          openAITransport: transport,
        };
        const projected = buildModelCallContextRequest(model, options);
        const wire = transport === "responses"
          ? buildOpenAIResponsesRequest(
            "gpt-4o",
            "openai",
            options,
            false,
            createWarningCollector(),
          )
          : buildOpenAIChatRequest("gpt-4o", "openai", options, false, createWarningCollector());
        assertEquals(projected?.parallelToolCalls, wire.parallel_tool_calls);
        assertEquals(projected?.parallelToolCalls, native ?? value);
        assertEquals(
          projected === undefined ? false : Object.hasOwn(projected, "parallelToolCalls"),
          native !== undefined || value !== undefined,
        );
      }
    }
  }
});
