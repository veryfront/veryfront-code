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
import { buildOpenAIResponsesRequest } from "../../extensions/ext-llm-openai/src/openai-responses-request-builder.ts";
import { buildAnthropicMessagesRequest } from "../../extensions/ext-llm-anthropic/src/anthropic-request-builder.ts";
import { buildGoogleGenerateContentRequest } from "../../extensions/ext-llm-google/src/google-request-builder.ts";

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
const sampling = { temperature: 0.4, topP: 0.8, presencePenalty: 0.3, frequencyPenalty: 0.1 };
const samplingFields = [
  ["temperature", "temperature"],
  ["topP", "top_p"],
  ["presencePenalty", "presence_penalty"],
  ["frequencyPenalty", "frequency_penalty"],
] as const;

describe("model call request projection", () => {
  it("matches OpenAI-compatible Cloud controls including Kimi fixed sampling", () => {
    for (
      const [modelProvider, modelId] of [["mistral", "mistral-large"], [
        "moonshotai",
        "kimi-k2.5",
      ]] as const
    ) {
      for (const native of [undefined, { temperature: 0.2, top_k: 3 }]) {
        const options = {
          prompt,
          ...sampling,
          topK: 9,
          providerOptions: native ? { "veryfront-cloud": native } : undefined,
        };
        const projected = buildModelCallContextRequest({
          provider: "veryfront-cloud",
          modelProvider,
          modelId,
        }, options);
        const body = buildOpenAIChatRequest(
          modelId,
          "veryfront-cloud",
          options,
          false,
          createWarningCollector(),
        );
        for (const [field, nativeField] of [...samplingFields, ["topK", "top_k"]] as const) {
          assertEquals(projected?.[field], (body as Record<string, unknown>)[nativeField]);
        }
      }
    }
  });

  it("matches managed OpenAI native reasoning precedence and tool suppression", () => {
    for (const modelId of ["gpt-5.4", "o3"]) {
      for (const nativeEffort of ["low", "none", undefined]) {
        const native = modelId === "o3"
          ? { reasoning: { effort: nativeEffort } }
          : { reasoning_effort: nativeEffort };
        const options = {
          prompt,
          ...sampling,
          reasoning: { enabled: true, effort: "high" as const },
          providerOptions: {
            openai: { reasoning_effort: "medium", reasoning: { effort: "medium" } },
            "veryfront-cloud": native,
          },
        };
        const projected = buildModelCallContextRequest({
          provider: "veryfront-cloud",
          modelProvider: "openai",
          modelId,
        }, options);
        const body = modelId === "o3"
          ? buildOpenAIResponsesRequest(
            modelId,
            "veryfront-cloud",
            options,
            false,
            createWarningCollector(),
          )
          : buildOpenAIChatRequest(
            modelId,
            "veryfront-cloud",
            options,
            false,
            createWarningCollector(),
            { reasoningWithFunctionTools: false },
          );
        assertEquals(
          modelId === "o3" ? (body.reasoning as { effort?: string }).effort : body.reasoning_effort,
          nativeEffort,
        );
        assertEquals(
          projected?.reasoning,
          nativeEffort === "low"
            ? { enabled: true, effort: "low" }
            : nativeEffort === "none"
            ? { enabled: false }
            : undefined,
        );
        assertEquals(projected?.temperature, body.temperature);
        if (modelId === "gpt-5.4") {
          assertEquals(
            buildModelCallContextRequest({
              provider: "veryfront-cloud",
              modelProvider: "openai",
              modelId,
            }, { ...options, tools })?.reasoning,
            { enabled: false },
          );
        }
      }
    }
  });

  it("projects compatible Cloud reasoning effort without an unsupported token budget", () => {
    for (
      const [modelProvider, modelId] of [["mistral", "mistral-large"], [
        "moonshotai",
        "kimi-k2.5",
      ]] as const
    ) {
      const options = {
        prompt,
        reasoning: { enabled: true, effort: "high" as const, budgetTokens: 2048 },
      };
      const body = buildOpenAIChatRequest(
        modelId,
        "veryfront-cloud",
        options,
        false,
        createWarningCollector(),
      );
      const projected = buildModelCallContextRequest({
        provider: "veryfront-cloud",
        modelProvider,
        modelId,
      }, options);
      assertEquals(body.reasoning_effort, "high");
      assertEquals(projected?.reasoning, { enabled: true, effort: "high" });
      assertEquals(projected?.reasoning?.effort, body.reasoning_effort);
      assertEquals(projected?.reasoning?.budgetTokens, undefined);
    }
  });

  it("omits neutral seeds from managed Responses while retaining native seeds", () => {
    for (const native of [undefined, { seed: 2 }]) {
      const options = {
        prompt,
        seed: 7,
        providerOptions: native ? { "veryfront-cloud": native } : undefined,
      };
      const projected = buildModelCallContextRequest({
        provider: "veryfront-cloud",
        modelProvider: "openai",
        modelId: "o3",
      }, options);
      const body = buildOpenAIResponsesRequest(
        "o3",
        "veryfront-cloud",
        options,
        false,
        createWarningCollector(),
      );
      assertEquals(projected?.seed, body.seed);
      assertEquals(projected?.seed, native?.seed);
    }
  });

  it("matches controls when managed web-search tools select Responses", () => {
    const options: ModelRuntimeCallOptions = {
      prompt,
      ...sampling,
      seed: 7,
      stopSequences: ["STOP"],
      tools: [{ type: "provider", id: "openai.web_search", name: "web_search", args: {} }],
      providerOptions: { "veryfront-cloud": { reasoning: { effort: "low" } } },
    };
    const projected = buildModelCallContextRequest({
      provider: "veryfront-cloud",
      modelProvider: "openai",
      modelId: "gpt-4o",
    }, options);
    const body = buildOpenAIResponsesRequest(
      "gpt-4o",
      "veryfront-cloud",
      options,
      false,
      createWarningCollector(),
    );
    for (
      const [field, nativeField] of [...samplingFields, ["seed", "seed"], [
        "stopSequences",
        "stop",
      ]] as const
    ) {
      assertEquals(projected?.[field], body[nativeField]);
    }
    assertEquals(projected?.reasoning, { enabled: true, effort: "low" });
  });

  it("omits adaptive effort overwritten by Anthropic structured output", () => {
    const options: ModelRuntimeCallOptions = {
      prompt,
      responseFormat: {
        type: "json_schema",
        name: "result",
        schema: { type: "object", properties: {} },
      },
      providerOptions: {
        anthropic: { thinking: { type: "adaptive" }, output_config: { effort: "high" } },
      },
    };
    const projected = buildModelCallContextRequest({
      provider: "veryfront-cloud",
      modelProvider: "anthropic",
      modelId: "claude-opus-4-7",
    }, options);
    const body = buildAnthropicMessagesRequest(
      "claude-opus-4-7",
      "veryfront-cloud",
      options,
      false,
      createWarningCollector(),
    );
    assertEquals(projected?.reasoning, { enabled: true });
    assertEquals((body.output_config as Record<string, unknown>).effort, undefined);
  });

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

  it("omits neutral sampling controls that both OpenAI builders reject", () => {
    for (const modelId of ["gpt-5.4", "gpt-5.5", "o3"]) {
      for (
        const reasoning of [undefined, { enabled: false }, {
          enabled: true,
          effort: "max",
        }] as const
      ) {
        const options: ModelRuntimeCallOptions = { prompt, tools, ...sampling, reasoning };
        const projected = buildModelCallContextRequest({
          provider: "veryfront-cloud",
          modelProvider: "openai",
          modelId,
        }, options);
        for (const stream of [false, true]) {
          const bodies = [
            buildOpenAIChatRequest(
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
            ),
            buildOpenAIResponsesRequest(
              modelId,
              "veryfront-cloud",
              options,
              stream,
              createWarningCollector(),
            ),
          ];
          for (const body of bodies) {
            for (const [field, nativeField] of samplingFields) {
              assertEquals((body as Record<string, unknown>)[nativeField], undefined);
              assertEquals(projected?.[field], (body as Record<string, unknown>)[nativeField]);
              assertEquals(Object.hasOwn(projected ?? {}, field), false);
            }
          }
        }
      }
    }
  });

  it("omits sampling when reasoning is explicitly enabled on a nonreasoning model", () => {
    const options: ModelRuntimeCallOptions = {
      prompt,
      ...sampling,
      reasoning: { enabled: true, effort: "high" },
    };
    const projected = buildModelCallContextRequest(
      { provider: "openai", modelId: "gpt-4o" },
      options,
    );
    for (const stream of [false, true]) {
      for (const build of [buildOpenAIChatRequest, buildOpenAIResponsesRequest]) {
        const body = build("gpt-4o", "openai", options, stream, createWarningCollector());
        for (const [field, nativeField] of samplingFields) {
          assertEquals((body as Record<string, unknown>)[nativeField], undefined);
          assertEquals(projected?.[field], (body as Record<string, unknown>)[nativeField]);
        }
      }
    }
  });

  it("retains regular OpenAI Chat sampling", () => {
    for (const reasoning of [undefined, { enabled: false }]) {
      const options = { prompt, ...sampling, reasoning };
      const projected = buildModelCallContextRequest(
        { provider: "openai", modelId: "gpt-4o" },
        options,
      );
      for (const stream of [false, true]) {
        const body = buildOpenAIChatRequest(
          "gpt-4o",
          "openai",
          options,
          stream,
          createWarningCollector(),
        );
        for (const [field, nativeField] of samplingFields) {
          assertEquals(projected?.[field], sampling[field]);
          assertEquals(projected?.[field], (body as Record<string, unknown>)[nativeField]);
        }
      }
    }
  });

  it("projects numeric native sampling overrides after neutral sampling is dropped", () => {
    const expected = { temperature: 0, topP: 0.6, presencePenalty: -0.2, frequencyPenalty: 0.5 };
    for (const provider of ["openai", "veryfront-cloud"]) {
      const options: ModelRuntimeCallOptions = {
        prompt,
        tools,
        ...sampling,
        providerOptions: {
          "openai-compatible": { temperature: 1 },
          openai: { temperature: 0.9, top_p: 0.6, presence_penalty: -0.2, frequency_penalty: 0.5 },
          [provider]: {
            temperature: 0,
            top_p: 0.6,
            presence_penalty: -0.2,
            frequency_penalty: 0.5,
          },
        },
      };
      const projected = buildModelCallContextRequest({
        provider,
        modelProvider: "openai",
        modelId: "gpt-5.5",
      }, options);
      for (const stream of [false, true]) {
        for (const build of [buildOpenAIChatRequest, buildOpenAIResponsesRequest]) {
          const body = build("gpt-5.5", provider, options, stream, createWarningCollector());
          for (const [field, nativeField] of samplingFields) {
            assertEquals((body as Record<string, unknown>)[nativeField], expected[field]);
            assertEquals(projected?.[field], (body as Record<string, unknown>)[nativeField]);
          }
        }
      }
    }
  });

  it("matches Anthropic control omissions and stop limits across effective thinking modes", () => {
    for (const provider of ["anthropic", "veryfront-cloud"]) {
      for (
        const [configuration, samplingKept] of [
          [{}, true],
          [{ reasoning: { enabled: false } }, true],
          [{ reasoning: { enabled: true, budgetTokens: 2048 } }, false],
          [{
            providerOptions: { anthropic: { thinking: { type: "enabled", budget_tokens: 2048 } } },
          }, false],
          [{
            reasoning: { enabled: false },
            providerOptions: { anthropic: { thinking: { type: "enabled", budget_tokens: 2048 } } },
          }, false],
          [{ providerOptions: { anthropic: { thinking: { type: "adaptive" } } } }, true],
          [{ providerOptions: { anthropic: { thinking: { type: "disabled" } } } }, true],
        ] as const
      ) {
        const options: ModelRuntimeCallOptions = {
          prompt,
          ...sampling,
          maxOutputTokens: 64,
          topK: 9,
          seed: 7,
          stopSequences: ["A", "B", "C", "D", "E"],
          ...configuration,
        };
        const projected = buildModelCallContextRequest({
          provider,
          modelProvider: "anthropic",
          modelId: "claude-haiku-4-5",
        }, options);
        assertEquals(projected?.maxOutputTokens, 64);
        for (const stream of [false, true]) {
          const body = buildAnthropicMessagesRequest(
            "claude-haiku-4-5",
            provider,
            options,
            stream,
            createWarningCollector(),
          ) as unknown as Record<string, unknown>;
          for (
            const [field, nativeField] of [...samplingFields, ["topK", "top_k"], [
              "seed",
              "seed",
            ]] as const
          ) {
            const expected = samplingKept && (field === "temperature" || field === "topP")
              ? sampling[field]
              : undefined;
            assertEquals(body[nativeField], expected);
            assertEquals(projected?.[field], body[nativeField]);
          }
          assertEquals(projected?.stopSequences, ["A", "B", "C", "D"]);
          assertEquals(projected?.stopSequences, body.stop_sequences);
        }
      }
    }
  });

  it("preserves Anthropic native control overrides after neutral filtering", () => {
    const options: ModelRuntimeCallOptions = {
      prompt,
      ...sampling,
      topK: 9,
      seed: 7,
      stopSequences: ["neutral"],
      providerOptions: {
        anthropic: { thinking: { type: "enabled", budget_tokens: 2048 }, temperature: 1 },
        "veryfront-cloud": {
          temperature: 0,
          top_p: 0.2,
          top_k: 17,
          seed: 0,
          presence_penalty: 0.7,
          frequency_penalty: -0.5,
          stop_sequences: ["native"],
        },
      },
    };
    const projected = buildModelCallContextRequest({
      provider: "veryfront-cloud",
      modelProvider: "anthropic",
      modelId: "claude-haiku-4-5",
    }, options);
    assertEquals(projected, {
      temperature: 0,
      topP: 0.2,
      topK: 17,
      seed: 0,
      presencePenalty: 0.7,
      frequencyPenalty: -0.5,
      stopSequences: ["native"],
      reasoning: { enabled: true, budgetTokens: 2048 },
    });
    for (const stream of [false, true]) {
      const body = buildAnthropicMessagesRequest(
        "claude-haiku-4-5",
        "veryfront-cloud",
        options,
        stream,
        createWarningCollector(),
      ) as unknown as Record<string, unknown>;
      for (
        const [field, nativeField] of [...samplingFields, ["topK", "top_k"], ["seed", "seed"], [
          "stopSequences",
          "stop_sequences",
        ]] as const
      ) {
        assertEquals(projected?.[field], body[nativeField]);
      }
    }
  });

  it("matches Google generation controls with and without neutral thinking", () => {
    for (
      const reasoning of [undefined, { enabled: false }, {
        enabled: true,
        budgetTokens: 1024,
      }] as const
    ) {
      const options: ModelRuntimeCallOptions = {
        prompt,
        ...sampling,
        maxOutputTokens: 64,
        topK: 9,
        seed: 7,
        stopSequences: ["STOP"],
        reasoning,
      };
      const projected = buildModelCallContextRequest({
        provider: "veryfront-cloud",
        modelProvider: "google",
        modelId: "gemini-synthetic",
      }, options);
      const body = buildGoogleGenerateContentRequest(
        "veryfront-cloud",
        options,
        createWarningCollector(),
      );
      for (
        const [field] of [...samplingFields, ["maxOutputTokens"], ["topK"], ["seed"], [
          "stopSequences",
        ]] as const
      ) {
        assertEquals(projected?.[field], body.generationConfig?.[field]);
      }
      assertEquals(projected?.presencePenalty, undefined);
      assertEquals(projected?.frequencyPenalty, undefined);
      assertEquals(projected?.reasoning, reasoning);
    }
  });

  it("uses Google's replacement generationConfig for controls and representable thinking", () => {
    for (
      const thinkingConfig of [undefined, { thinkingBudget: 512 }, { thinkingBudget: -1 }, {
        thinkingLevel: "unrepresentable",
      }]
    ) {
      const generationConfig = {
        temperature: 0,
        presencePenalty: 0.7,
        frequencyPenalty: -0.5,
        ...(thinkingConfig ? { thinkingConfig } : {}),
      };
      const options: ModelRuntimeCallOptions = {
        prompt,
        ...sampling,
        maxOutputTokens: 64,
        topK: 9,
        seed: 7,
        stopSequences: ["neutral"],
        reasoning: { enabled: true, budgetTokens: 1024 },
        providerOptions: {
          google: { generationConfig: { topK: 3 } },
          "veryfront-cloud": { generationConfig },
        },
      };
      const projected = buildModelCallContextRequest({
        provider: "veryfront-cloud",
        modelProvider: "google",
        modelId: "gemini-synthetic",
      }, options);
      const body = buildGoogleGenerateContentRequest(
        "veryfront-cloud",
        options,
        createWarningCollector(),
      );
      for (
        const [field] of [...samplingFields, ["maxOutputTokens"], ["topK"], ["seed"], [
          "stopSequences",
        ]] as const
      ) {
        assertEquals(projected?.[field], body.generationConfig?.[field]);
      }
      assertEquals(
        projected?.reasoning,
        thinkingConfig?.thinkingBudget === -1
          ? { enabled: true, effort: "max" }
          : thinkingConfig?.thinkingBudget === 512
          ? { enabled: true, budgetTokens: 512 }
          : undefined,
      );
    }
  });

  it("omits OpenAI neutral topK while preserving copied native top_k and seed overrides", () => {
    for (const provider of ["openai", "veryfront-cloud"]) {
      for (const native of [undefined, { top_k: 0, seed: 2 }]) {
        const options: ModelRuntimeCallOptions = {
          prompt,
          topK: 9,
          ...(native ? { seed: 7, providerOptions: { [provider]: native } } : {}),
        };
        const projected = buildModelCallContextRequest({
          provider,
          modelProvider: "openai",
          modelId: "gpt-4o",
        }, options);
        for (const stream of [false, true]) {
          for (const build of [buildOpenAIChatRequest, buildOpenAIResponsesRequest]) {
            const body = build(
              "gpt-4o",
              provider,
              options,
              stream,
              createWarningCollector(),
            ) as unknown as Record<string, unknown>;
            assertEquals(projected?.topK, body.top_k);
            assertEquals(projected?.seed, body.seed);
            assertEquals(projected?.topK, native?.top_k);
          }
        }
      }
    }
  });

  it("omits empty neutral stop lists for known providers and preserves unknown provider controls", () => {
    for (const provider of ["openai", "anthropic", "google"]) {
      assertEquals(
        buildModelCallContextRequest({ provider, modelId: "synthetic" }, { stopSequences: [] })
          ?.stopSequences,
        undefined,
      );
    }
    const options = { ...sampling, topK: 9, seed: 7, stopSequences: [] };
    assertEquals(
      buildModelCallContextRequest({ provider: "custom", modelId: "synthetic" }, options),
      options,
    );
  });
});
