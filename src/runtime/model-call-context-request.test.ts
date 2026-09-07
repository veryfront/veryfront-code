import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import { createWarningCollector } from "#veryfront/provider/shared/index.ts";
import {
  resolveVeryfrontCloudOpenAIChatFunctionToolReasoning,
  resolveVeryfrontCloudOpenAITransport,
} from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import { buildModelCallContextRequest } from "#veryfront/runtime/model-call-context-request.ts";
import { buildOpenAIChatRequest } from "../../extensions/ext-llm-openai/src/openai-chat-request-builder.ts";

const prompt: ModelRuntimeCallOptions["prompt"] = [{
  role: "user",
  content: [{ type: "text", text: "Synthetic request" }],
}];
const tools: ModelRuntimeCallOptions["tools"] = [{
  type: "function",
  name: "lookup",
  inputSchema: { type: "object", properties: {} },
}];
const nativeTools = [{
  type: "function",
  function: { name: "lookup", parameters: { type: "object", properties: {} } },
}];

describe("model call request projection", () => {
  for (const modelId of ["gpt-5.4", "gpt-5.5"]) {
    it(`matches ${modelId} Cloud Chat reasoning with and without function tools`, () => {
      const catalogId = `openai/${modelId}`;
      assertEquals(resolveVeryfrontCloudOpenAITransport(catalogId), "chat-completions");
      const capabilities = {
        reasoningWithFunctionTools: resolveVeryfrontCloudOpenAIChatFunctionToolReasoning(catalogId),
      };
      for (
        const [reasoning, expectedEffort] of [
          [undefined, "medium"],
          [{ enabled: true, effort: "max" }, "high"],
          [{ enabled: false }, undefined],
        ] as const
      ) {
        for (const useTools of [false, true]) {
          const options: ModelRuntimeCallOptions = {
            prompt,
            reasoning,
            ...(useTools ? { tools } : {}),
          };
          const projected = buildModelCallContextRequest({
            provider: "veryfront-cloud",
            modelProvider: "openai",
            modelId,
          }, options);
          const effort = useTools ? undefined : expectedEffort;
          assertEquals(projected?.reasoning, {
            enabled: effort !== undefined,
            ...(effort !== undefined ? { effort } : {}),
          });
          for (const stream of [false, true]) {
            const body = buildOpenAIChatRequest(
              modelId,
              "veryfront-cloud",
              options,
              stream,
              createWarningCollector(),
              capabilities,
            );
            assertEquals(body.reasoning_effort, effort);
            assertEquals(projected?.reasoning?.effort, body.reasoning_effort);
            assertEquals(projected?.reasoning?.enabled, body.reasoning_effort !== undefined);
            assertEquals(body.tools?.[0]?.function.name, useTools ? "lookup" : undefined);
          }
        }
      }
    });

    for (
      const { name, options: toolOptions, hasFunctionTools } of [
        {
          name: "adds native function tools",
          options: { providerOptions: { "veryfront-cloud": { tools: nativeTools } } },
          hasFunctionTools: true,
        },
        {
          name: "clears neutral tools with an empty native list",
          options: { tools, providerOptions: { "veryfront-cloud": { tools: [] } } },
          hasFunctionTools: false,
        },
        {
          name: "clears neutral tools with an explicit undefined native list",
          options: { tools, providerOptions: { "veryfront-cloud": { tools: undefined } } },
          hasFunctionTools: false,
        },
        {
          name: "uses native tools from the OpenAI bucket",
          options: { providerOptions: { openai: { tools: nativeTools } } },
          hasFunctionTools: true,
        },
        {
          name: "lets the Cloud bucket clear OpenAI native tools",
          options: {
            providerOptions: { openai: { tools: nativeTools }, "veryfront-cloud": { tools: [] } },
          },
          hasFunctionTools: false,
        },
      ]
    ) {
      it(`matches ${modelId} reasoning when the request ${name}`, () => {
        for (
          const [reasoning, expectedEffort] of [
            [undefined, "medium"],
            [{ enabled: true, effort: "max" }, "high"],
            [{ enabled: false }, undefined],
          ] as const
        ) {
          const options: ModelRuntimeCallOptions = { prompt, reasoning, ...toolOptions };
          const projected = buildModelCallContextRequest({
            provider: "veryfront-cloud",
            modelProvider: "openai",
            modelId,
          }, options);
          const effort = hasFunctionTools ? undefined : expectedEffort;
          for (const stream of [false, true]) {
            const body = buildOpenAIChatRequest(
              modelId,
              "veryfront-cloud",
              options,
              stream,
              createWarningCollector(),
              {
                reasoningWithFunctionTools: resolveVeryfrontCloudOpenAIChatFunctionToolReasoning(
                  `openai/${modelId}`,
                ),
              },
            );
            assertEquals(body.reasoning_effort, effort);
            assertEquals(body.tools?.[0]?.function.name, hasFunctionTools ? "lookup" : undefined);
            assertEquals(projected?.reasoning?.effort, body.reasoning_effort);
            assertEquals(projected?.reasoning?.enabled, body.reasoning_effort !== undefined);
          }
        }
      });
    }
  }

  it("retains reasoning for direct OpenAI and Cloud models without the Chat restriction", () => {
    for (
      const [provider, modelId] of [
        ["openai", "gpt-5.4"],
        ["openai", "gpt-5.5"],
        ["veryfront-cloud", "gpt-5.4-nano"],
        ["veryfront-cloud", "o3"],
      ]
    ) {
      assertEquals(
        buildModelCallContextRequest({ provider, modelProvider: "openai", modelId }, {
          tools,
          reasoning: { enabled: true, effort: "max" },
        })?.reasoning,
        { enabled: true, effort: "high" },
      );
    }
  });
});
