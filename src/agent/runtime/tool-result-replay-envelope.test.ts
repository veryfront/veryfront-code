import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChatToolResultOutput, ProviderModelMessage } from "#veryfront/chat/types.ts";
import type { ModelRuntime, ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import { generateText } from "#veryfront/runtime/runtime-bridge.ts";
import { createWarningCollector } from "#veryfront/provider/shared/index.ts";
import { convertProviderMessagesToAgentRuntimeMessages } from "./message-adapter.ts";
import { convertToTextGenerationRuntimeRequestMessages } from "./text-generation-runtime-message-converter.ts";
import { buildAnthropicMessagesRequest } from "../../../extensions/ext-llm-anthropic/src/anthropic-request-builder.ts";
import { buildGoogleGenerateContentRequest } from "../../../extensions/ext-llm-google/src/google-request-builder.ts";

const page = { calendars: [{ id: "demo" }], pagination: { nextPageToken: "opaque+/=cursor" } };

describe("tool output replay envelope", () => {
  for (
    const [name, output, expected] of [
      ["native page", { type: "json", value: page }, page],
      [
        "serialized JSON string",
        { type: "json", value: JSON.stringify(page) },
        JSON.stringify(page),
      ],
      ["plain text", { type: "text", value: "plain result" }, "plain result"],
      ["user type/value object", { type: "json", value: { type: "json", value: "user data" } }, {
        type: "json",
        value: "user data",
      }],
      ["business error-text object", {
        type: "json",
        value: { type: "error-text", value: "business data" },
      }, { type: "error-text", value: "business data" }],
      ["error", { type: "error-text", value: "provider failed" }, { error: "provider failed" }],
    ] as const
  ) {
    it(`consumes one owned envelope for ${name}`, async () => {
      const original: ProviderModelMessage[] = [
        {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "call", toolName: "lookup", input: {} }],
        },
        {
          role: "tool",
          content: [{
            type: "tool-result",
            toolCallId: "call",
            toolName: "lookup",
            output: output as ChatToolResultOutput,
          }],
        },
      ];
      const before = JSON.stringify(original);
      const messages = convertProviderMessagesToAgentRuntimeMessages(original);
      const prompt = convertToTextGenerationRuntimeRequestMessages(messages);
      const tool = prompt[1];
      if (tool?.role !== "tool") throw new Error("Expected tool output");
      assertEquals(tool.content[0]?.output, { type: "json", value: expected });
      let observed = false;
      const model: ModelRuntime = {
        provider: "test",
        modelId: "tool-envelope",
        specificationVersion: "v3",
        doStream: () => Promise.reject(new Error("unused")),
        doGenerate: (options) => {
          observed = true;
          const call = options as ModelRuntimeCallOptions;
          const anthropic = buildAnthropicMessagesRequest(
            "claude-synthetic",
            "anthropic",
            call,
            false,
            createWarningCollector(),
          );
          const google = buildGoogleGenerateContentRequest(
            "google",
            call,
            createWarningCollector(),
          );
          const googleContents = google.contents;
          assertEquals(googleContents[1]?.parts, [{
            functionResponse: {
              id: "call",
              name: "lookup",
              response: { result: expected },
            },
          }]);
          const anthropicMessages = anthropic.messages as Array<{ content: unknown[] }>;
          assertEquals(anthropicMessages[1]?.content, [{
            type: "tool_result",
            tool_use_id: "call",
            content: typeof expected === "string" ? expected : JSON.stringify(expected),
          }]);
          return Promise.resolve({
            content: [{ type: "text", text: "done" }],
            finishReason: "stop",
            usage: {},
          });
        },
      };
      await generateText({ model, messages: prompt });
      assertEquals(observed, true);
      assertEquals(JSON.stringify(original), before);
    });
  }
});
