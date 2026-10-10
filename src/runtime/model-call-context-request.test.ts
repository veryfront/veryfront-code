import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { seedServedCatalogForTests } from "#veryfront/provider/veryfront-cloud/catalog-client.test-helpers.ts";
import { __resetVeryfrontCloudCatalogForTests } from "#veryfront/provider/veryfront-cloud/catalog-client.ts";
import type { ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import { createWarningCollector } from "#veryfront/provider/shared/index.ts";
import {
  resolveVeryfrontCloudOpenAIChatFunctionToolReasoning,
  resolveVeryfrontCloudOpenAITransport,
} from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import {
  buildModelCallContextRequest,
  snapshotModelCallProviderOptions,
} from "#veryfront/runtime/model-call-context-request.ts";
import { registerVeryfrontCloudModelFacts } from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import { buildOpenAIChatRequest } from "../../extensions/ext-llm-openai/src/openai-chat-request-builder.ts";
import { buildOpenAIResponsesRequest } from "../../extensions/ext-llm-openai/src/openai-responses-request-builder.ts";
import { buildAnthropicMessagesRequest } from "../../extensions/ext-llm-anthropic/src/anthropic-request-builder.ts";
import { buildGoogleGenerateContentRequest } from "../../extensions/ext-llm-google/src/google-request-builder.ts";
import {
  createOpenAIModelRuntime,
  createOpenAIResponsesRuntime,
} from "../../extensions/ext-llm-openai/src/openai-provider.ts";

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
  it("snapshots Google controls once for capture and the native wire builder", () => {
    let reads = 0;
    const providerOptions = new Proxy({}, {
      getOwnPropertyDescriptor(_target, key) {
        if (key !== "google") return undefined;
        reads += 1;
        return {
          configurable: true,
          enumerable: true,
          writable: true,
          value: { generationConfig: { maxOutputTokens: reads === 1 ? 111 : 777 } },
        };
      },
    });
    const options = snapshotModelCallProviderOptions(
      { provider: "google", modelId: "gemini-synthetic" },
      { prompt, providerOptions },
    );
    const projected = buildModelCallContextRequest({ provider: "google" }, options);
    const body = buildGoogleGenerateContentRequest("google", options, createWarningCollector());
    assertEquals(projected?.maxOutputTokens, 111);
    assertEquals(body.generationConfig?.maxOutputTokens, 111);
    assertEquals(reads, 1);
  });

  it("preserves ignored provider buckets without evaluating accessors", () => {
    let getterReads = 0;
    const unused = { callback() {} };
    const providerOptions = { openai: { max_tokens: 111 }, unused };
    Object.defineProperty(providerOptions, "other", {
      configurable: true,
      enumerable: true,
      get() {
        getterReads += 1;
        throw new Error("unused provider getter must not run");
      },
    });
    const options = snapshotModelCallProviderOptions(
      { provider: "openai", modelId: "gpt-4o", openAITransport: "chat-completions" },
      { prompt, providerOptions },
    );
    const body = buildOpenAIChatRequest(
      "gpt-4o",
      "openai",
      options,
      false,
      createWarningCollector(),
    );
    assertEquals(body.max_completion_tokens, 111);
    assert(options.providerOptions.unused === unused);
    assertEquals(
      Object.getOwnPropertyDescriptor(options.providerOptions, "other"),
      Object.getOwnPropertyDescriptor(providerOptions, "other"),
    );
    assertEquals(getterReads, 0);
  });

  it("preserves non-enumerable array indices used in native provider controls", () => {
    const stop = ["original"];
    Object.defineProperty(stop, "0", { enumerable: false });
    const options = snapshotModelCallProviderOptions(
      { provider: "openai", modelId: "gpt-4o", openAITransport: "chat-completions" },
      { prompt, providerOptions: { openai: { stop } } },
    );
    const body = buildOpenAIChatRequest(
      "gpt-4o",
      "openai",
      options,
      false,
      createWarningCollector(),
    );
    assertEquals(body.stop, ["original"]);
    assertEquals(
      buildModelCallContextRequest({ provider: "openai", modelId: "gpt-4o" }, options)
        ?.stopSequences,
      ["original"],
    );
  });

  beforeEach(seedServedCatalogForTests);
  afterEach(__resetVeryfrontCloudCatalogForTests);
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

  it("keeps chat controls for a non-native provider with a reasoning-style model id", () => {
    // A provider that is not native to the OpenAI surface is pinned to chat
    // completions, whatever its model IDs look like, so the recorded context
    // must keep the chat-only controls the request carries.
    for (
      const [modelProvider, modelId] of [
        ["acme-labs", "gpt-5.4"],
        ["mistral", "mistral-large"],
        ["moonshotai", "o3"],
      ] as const
    ) {
      const options: ModelRuntimeCallOptions = {
        prompt,
        seed: 7,
        stopSequences: ["STOP"],
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

      assertEquals(projected?.seed, 7);
      assertEquals(projected?.stopSequences, ["STOP"]);
      assertEquals(projected?.seed, body.seed);
      assertEquals(projected?.stopSequences, body.stop);
    }
  });

  it("records the reasoning a non-native provider sends alongside a function tool", () => {
    // OpenAI's own gpt-5.4 drops reasoning when a function tool is present. That
    // capability is OpenAI's: another provider on the same wire surface builds
    // its request without it, so the recorded context must match that request.
    const options: ModelRuntimeCallOptions = {
      prompt,
      tools,
      reasoning: { enabled: true, effort: "high" },
    };
    const projected = buildModelCallContextRequest({
      provider: "veryfront-cloud",
      modelProvider: "acme-labs",
      modelId: "gpt-5.4",
    }, options);
    const body = buildOpenAIChatRequest(
      "gpt-5.4",
      "veryfront-cloud",
      options,
      false,
      createWarningCollector(),
    );

    assertEquals(body.reasoning_effort, "high");
    assertEquals(projected?.reasoning, { enabled: true, effort: "high" });
  });

  it("still drops chat controls for a native provider on the Responses transport", () => {
    // The native provider keeps its old classification: a reasoning-style ID
    // selects Responses, which carries neither of these controls.
    const options: ModelRuntimeCallOptions = {
      prompt,
      seed: 7,
      stopSequences: ["STOP"],
    };
    const projected = buildModelCallContextRequest({
      provider: "veryfront-cloud",
      modelProvider: "openai",
      modelId: "gpt-5.4-nano",
    }, options);

    assertEquals(projected?.seed, undefined);
    assertEquals(projected?.stopSequences, undefined);
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

  it("ignores undispatched underlying buckets for served Anthropic and Google models", () => {
    const anthropicModel = { provider: "veryfront-cloud", modelProvider: "acme", modelId: "m1" };
    registerVeryfrontCloudModelFacts(anthropicModel as never, () =>
      ({
        provider: "acme",
        surface: "anthropic",
        native: false,
        transportPlan: "chat-completions",
      }) as never);
    const anthropicOptions = snapshotModelCallProviderOptions(anthropicModel, {
      prompt,
      providerOptions: {
        anthropic: { max_tokens: 111, thinking: { type: "enabled", budget_tokens: 1000 } },
        "veryfront-cloud": { max_tokens: 222, thinking: { type: "enabled", budget_tokens: 2000 } },
        acme: { max_tokens: 999, thinking: { type: "enabled", budget_tokens: 9000 } },
      },
    });
    const anthropicProjected = buildModelCallContextRequest(anthropicModel, anthropicOptions);
    const anthropicBody = buildAnthropicMessagesRequest(
      "m1",
      "veryfront-cloud",
      anthropicOptions,
      false,
      createWarningCollector(),
    );

    assertEquals(anthropicProjected?.maxOutputTokens, 222);
    assertEquals(anthropicProjected?.reasoning, { enabled: true, budgetTokens: 2000 });
    assertEquals(anthropicBody.max_tokens, 222);
    assertEquals(anthropicBody.thinking, { type: "enabled", budget_tokens: 2000 });

    const googleModel = { provider: "veryfront-cloud", modelProvider: "acme", modelId: "m2" };
    registerVeryfrontCloudModelFacts(googleModel as never, () =>
      ({
        provider: "acme",
        surface: "google",
        native: false,
        transportPlan: "chat-completions",
      }) as never);
    const googleOptions = snapshotModelCallProviderOptions(googleModel, {
      prompt,
      providerOptions: {
        google: { generationConfig: { maxOutputTokens: 111 } },
        "veryfront-cloud": { generationConfig: { maxOutputTokens: 222 } },
        acme: { generationConfig: { maxOutputTokens: 999 } },
      },
    });
    const googleProjected = buildModelCallContextRequest(googleModel, googleOptions);
    const googleBody = buildGoogleGenerateContentRequest(
      "veryfront-cloud",
      googleOptions,
      createWarningCollector(),
    );

    assertEquals(googleProjected?.maxOutputTokens, 222);
    assertEquals(googleBody.generationConfig?.maxOutputTokens, 222);
  });

  it("records native controls by served surface for a newly served provider", () => {
    const options: ModelRuntimeCallOptions = {
      prompt,
      providerOptions: {
        anthropic: { thinking: { type: "adaptive" }, output_config: { effort: "high" } },
      },
    };
    const project = (modelProvider: string) => {
      const model = { provider: "veryfront-cloud", modelProvider, modelId: "m1" };
      registerVeryfrontCloudModelFacts(model as never, () =>
        ({
          provider: modelProvider,
          surface: "anthropic",
          native: false,
          transportPlan: "chat-completions",
        }) as never);
      return buildModelCallContextRequest(model, options);
    };

    // A provider served on the Anthropic surface records what anthropic/* records.
    assertEquals(project("acme"), project("anthropic"));
    assertEquals(project("acme")?.reasoning?.enabled, true);
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

  it("records the effective OpenAI output token budget after native overrides", () => {
    const responseOptions: ModelRuntimeCallOptions = {
      prompt,
      maxOutputTokens: 100,
      providerOptions: {
        openai: { max_output_tokens: 111, max_tokens: 999 },
        "veryfront-cloud": { max_output_tokens: 222, max_tokens: 888 },
      },
    };
    const responseProjected = buildModelCallContextRequest({
      provider: "veryfront-cloud",
      modelProvider: "openai",
      modelId: "o3",
    }, responseOptions);
    const responseBody = buildOpenAIResponsesRequest(
      "o3",
      "veryfront-cloud",
      responseOptions,
      false,
      createWarningCollector(),
    );
    assertEquals(responseBody.max_output_tokens, 222);
    assertEquals(responseProjected?.maxOutputTokens, responseBody.max_output_tokens);

    const nativeChatOptions: ModelRuntimeCallOptions = {
      prompt,
      maxOutputTokens: 100,
      providerOptions: {
        "openai-compatible": { max_completion_tokens: 111 },
        openai: { max_tokens: 333, max_output_tokens: 999 },
      },
    };
    const nativeChatProjected = buildModelCallContextRequest({
      provider: "openai",
      modelProvider: "openai",
      modelId: "gpt-4o",
      openAITransport: "chat-completions",
    }, nativeChatOptions);
    const nativeChatBody = buildOpenAIChatRequest(
      "gpt-4o",
      "openai",
      nativeChatOptions,
      false,
      createWarningCollector(),
    );
    assertEquals(nativeChatBody.max_completion_tokens, 333);
    assertEquals(nativeChatProjected?.maxOutputTokens, nativeChatBody.max_completion_tokens);

    const nativeCompletionOptions: ModelRuntimeCallOptions = {
      prompt,
      maxOutputTokens: 100,
      providerOptions: { openai: { max_completion_tokens: 444 } },
    };
    const nativeCompletionProjected = buildModelCallContextRequest({
      provider: "openai",
      modelProvider: "openai",
      modelId: "gpt-4o",
      openAITransport: "chat-completions",
    }, nativeCompletionOptions);
    const nativeCompletionBody = buildOpenAIChatRequest(
      "gpt-4o",
      "openai",
      nativeCompletionOptions,
      false,
      createWarningCollector(),
    );
    assertEquals(nativeCompletionBody.max_completion_tokens, 444);
    assertEquals(
      nativeCompletionProjected?.maxOutputTokens,
      nativeCompletionBody.max_completion_tokens,
    );

    const nativeAliasCollisionOptions: ModelRuntimeCallOptions = {
      prompt,
      maxOutputTokens: 100,
      providerOptions: { openai: { max_tokens: 333, max_completion_tokens: 444 } },
    };
    const nativeAliasCollisionProjected = buildModelCallContextRequest({
      provider: "openai",
      modelProvider: "openai",
      modelId: "gpt-4o",
      openAITransport: "chat-completions",
    }, nativeAliasCollisionOptions);
    const nativeAliasCollisionBody = buildOpenAIChatRequest(
      "gpt-4o",
      "openai",
      nativeAliasCollisionOptions,
      false,
      createWarningCollector(),
    );
    assertEquals(nativeAliasCollisionBody.max_completion_tokens, 444);
    assertEquals(
      nativeAliasCollisionProjected?.maxOutputTokens,
      nativeAliasCollisionBody.max_completion_tokens,
    );

    const compatibleChatOptions: ModelRuntimeCallOptions = {
      prompt,
      maxOutputTokens: 100,
      providerOptions: { "veryfront-cloud": { max_tokens: 555, max_completion_tokens: 444 } },
    };
    const compatibleChatProjected = buildModelCallContextRequest({
      provider: "veryfront-cloud",
      modelProvider: "mistral",
      modelId: "mistral-large",
    }, compatibleChatOptions);
    const compatibleChatBody = buildOpenAIChatRequest(
      "mistral-large",
      "veryfront-cloud",
      compatibleChatOptions,
      false,
      createWarningCollector(),
    );
    assertEquals(compatibleChatBody.max_tokens, 555);
    assertEquals(compatibleChatBody.max_completion_tokens, 444);
    assertEquals(compatibleChatProjected?.maxOutputTokens, compatibleChatBody.max_tokens);

    const compatibleCompletionOnlyOptions: ModelRuntimeCallOptions = {
      prompt,
      maxOutputTokens: 100,
      providerOptions: { "veryfront-cloud": { max_completion_tokens: 444 } },
    };
    const compatibleCompletionOnlyProjected = buildModelCallContextRequest({
      provider: "veryfront-cloud",
      modelProvider: "mistral",
      modelId: "mistral-large",
    }, compatibleCompletionOnlyOptions);
    const compatibleCompletionOnlyBody = buildOpenAIChatRequest(
      "mistral-large",
      "veryfront-cloud",
      compatibleCompletionOnlyOptions,
      false,
      createWarningCollector(),
    );
    assertEquals(compatibleCompletionOnlyBody.max_tokens, 100);
    assertEquals(compatibleCompletionOnlyBody.max_completion_tokens, 444);
    assertEquals(
      compatibleCompletionOnlyProjected?.maxOutputTokens,
      compatibleCompletionOnlyBody.max_tokens,
    );

    const directAmbiguousOptions: ModelRuntimeCallOptions = {
      prompt,
      maxOutputTokens: 100,
      providerOptions: { openai: { max_output_tokens: 666, max_tokens: 777 } },
    };
    const directAmbiguousProjected = buildModelCallContextRequest({
      provider: "openai",
      modelProvider: "openai",
      modelId: "gpt-4o",
      openAITransport: "auto",
    }, directAmbiguousOptions);
    const directAmbiguousChatBody = buildOpenAIChatRequest(
      "gpt-4o",
      "openai",
      directAmbiguousOptions,
      false,
      createWarningCollector(),
    );
    const directAmbiguousResponsesBody = buildOpenAIResponsesRequest(
      "gpt-4o",
      "openai",
      directAmbiguousOptions,
      false,
      createWarningCollector(),
    );
    assertEquals(directAmbiguousChatBody.max_completion_tokens, 777);
    assertEquals(directAmbiguousResponsesBody.max_output_tokens, 666);
    assertEquals(
      directAmbiguousProjected?.maxOutputTokens,
      directAmbiguousChatBody.max_completion_tokens,
    );

    const directHostedToolProjected = buildModelCallContextRequest({
      provider: "openai",
      modelProvider: "openai",
      modelId: "gpt-4o",
      openAITransport: "auto",
    }, {
      ...directAmbiguousOptions,
      tools: [{ type: "provider", id: "openai.web_search", name: "web_search", args: {} }],
    });
    assertEquals(
      directHostedToolProjected?.maxOutputTokens,
      directAmbiguousResponsesBody.max_output_tokens,
    );

    const directUnknownTransportProjected = buildModelCallContextRequest({
      provider: "openai",
      modelProvider: "custom-openai",
      modelId: "custom-gpt",
    }, directAmbiguousOptions);
    assertEquals(directAmbiguousChatBody.max_completion_tokens, 777);
    assertEquals(directAmbiguousResponsesBody.max_output_tokens, 666);
    assertEquals(directUnknownTransportProjected?.maxOutputTokens, 100);

    const pinnedReasoningChatProjected = buildModelCallContextRequest({
      provider: "openai",
      modelProvider: "openai",
      modelId: "o3",
      openAITransport: "chat-completions",
    }, directAmbiguousOptions);
    const pinnedReasoningChatBody = buildOpenAIChatRequest(
      "o3",
      "openai",
      directAmbiguousOptions,
      false,
      createWarningCollector(),
    );
    assertEquals(
      pinnedReasoningChatProjected?.maxOutputTokens,
      pinnedReasoningChatBody.max_completion_tokens,
    );

    const pinnedResponsesProjected = buildModelCallContextRequest({
      provider: "openai",
      modelProvider: "openai",
      modelId: "gpt-4o",
      openAITransport: "responses",
    }, directAmbiguousOptions);
    assertEquals(
      pinnedResponsesProjected?.maxOutputTokens,
      directAmbiguousResponsesBody.max_output_tokens,
    );

    const customChatRuntime = createOpenAIModelRuntime({
      apiKey: "test-api-key",
      name: "custom-openai-label",
      providerName: "openai",
    }, "gpt-4o");
    const customChatProjected = buildModelCallContextRequest(
      customChatRuntime,
      directAmbiguousOptions,
    );
    assertEquals(customChatRuntime.provider, "custom-openai-label");
    assertEquals(customChatRuntime.modelProvider, "openai");
    assertEquals(
      customChatProjected?.maxOutputTokens,
      directAmbiguousChatBody.max_completion_tokens,
    );

    const customResponsesRuntime = createOpenAIResponsesRuntime({
      apiKey: "test-api-key",
      name: "custom-openai-label",
      providerName: "openai",
    }, "gpt-4o");
    const customResponsesProjected = buildModelCallContextRequest(
      customResponsesRuntime,
      directAmbiguousOptions,
    );
    assertEquals(customResponsesRuntime.provider, "custom-openai-label");
    assertEquals(customResponsesRuntime.modelProvider, "openai");
    assertEquals(
      customResponsesProjected?.maxOutputTokens,
      directAmbiguousResponsesBody.max_output_tokens,
    );

    const customProviderOptions: ModelRuntimeCallOptions = {
      prompt,
      maxOutputTokens: 100,
      providerOptions: {
        openai: { max_tokens: 333 },
        moonshotai: { max_tokens: 555 },
      },
    };
    const customProviderRuntime = createOpenAIModelRuntime({
      apiKey: "test-api-key",
      name: "custom-moonshot-label",
      providerName: "moonshotai",
    }, "kimi-k2.5");
    const customProviderProjected = buildModelCallContextRequest(
      customProviderRuntime,
      customProviderOptions,
    );
    const customProviderBody = buildOpenAIChatRequest(
      "kimi-k2.5",
      "moonshotai",
      customProviderOptions,
      false,
      createWarningCollector(),
    );
    assertEquals(customProviderRuntime.provider, "custom-moonshot-label");
    assertEquals(customProviderRuntime.modelProvider, "moonshotai");
    assertEquals(customProviderBody.max_tokens, 555);
    assertEquals(customProviderProjected?.maxOutputTokens, customProviderBody.max_tokens);

    const customProviderReasoningRuntime = createOpenAIModelRuntime({
      apiKey: "test-api-key",
      name: "custom-moonshot-label",
      providerName: "moonshotai",
    }, "o3");
    const customProviderReasoningProjected = buildModelCallContextRequest(
      customProviderReasoningRuntime,
      { temperature: 0.4 },
    );
    const customProviderReasoningBody = buildOpenAIChatRequest(
      "o3",
      "moonshotai",
      { prompt, temperature: 0.4 },
      false,
      createWarningCollector(),
    );
    assertEquals(customProviderReasoningBody.reasoning_effort, undefined);
    assertEquals(customProviderReasoningBody.temperature, undefined);
    assertEquals(customProviderReasoningProjected?.reasoning, undefined);
    assertEquals(
      customProviderReasoningProjected?.temperature,
      customProviderReasoningBody.temperature,
    );

    const explicitUndefinedResponseOptions: ModelRuntimeCallOptions = {
      prompt,
      maxOutputTokens: 100,
      providerOptions: { "veryfront-cloud": { max_output_tokens: undefined } },
    };
    const explicitUndefinedResponseProjected = buildModelCallContextRequest({
      provider: "veryfront-cloud",
      modelProvider: "openai",
      modelId: "o3",
    }, explicitUndefinedResponseOptions);
    const explicitUndefinedResponseBody = buildOpenAIResponsesRequest(
      "o3",
      "veryfront-cloud",
      explicitUndefinedResponseOptions,
      false,
      createWarningCollector(),
    );
    assertEquals(explicitUndefinedResponseBody.max_output_tokens, undefined);
    assertEquals(explicitUndefinedResponseProjected?.maxOutputTokens, undefined);

    const explicitUndefinedChatOptions: ModelRuntimeCallOptions = {
      prompt,
      maxOutputTokens: 100,
      providerOptions: { openai: { max_tokens: undefined } },
    };
    const explicitUndefinedChatProjected = buildModelCallContextRequest({
      provider: "openai",
      modelProvider: "openai",
      modelId: "gpt-4o",
      openAITransport: "chat-completions",
    }, explicitUndefinedChatOptions);
    const explicitUndefinedChatBody = buildOpenAIChatRequest(
      "gpt-4o",
      "openai",
      explicitUndefinedChatOptions,
      false,
      createWarningCollector(),
    );
    assertEquals(explicitUndefinedChatBody.max_completion_tokens, undefined);
    assertEquals(explicitUndefinedChatProjected?.maxOutputTokens, undefined);
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
        for (const stream of [false, true]) {
          const body = buildAnthropicMessagesRequest(
            "claude-haiku-4-5",
            provider,
            options,
            stream,
            createWarningCollector(),
          ) as unknown as Record<string, unknown>;
          assertEquals(projected?.maxOutputTokens, body.max_tokens);
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

  it("matches Anthropic thinking token expansion and model caps", () => {
    for (
      const options of [
        {
          modelId: "claude-haiku-4-5",
          maxOutputTokens: 64,
          reasoning: { enabled: true, budgetTokens: 2048 },
        },
        {
          modelId: "claude-3-haiku",
          maxOutputTokens: 4000,
          reasoning: { enabled: true, budgetTokens: 2048 },
        },
      ] as const
    ) {
      const callOptions = {
        prompt,
        maxOutputTokens: options.maxOutputTokens,
        reasoning: options.reasoning,
      };
      const model = {
        provider: "anthropic",
        modelProvider: "anthropic",
        modelId: options.modelId,
      };
      const projected = buildModelCallContextRequest(model, callOptions);
      const body = buildAnthropicMessagesRequest(
        options.modelId,
        "anthropic",
        callOptions,
        false,
        createWarningCollector(),
      );

      assertEquals(projected?.maxOutputTokens, body.max_tokens);
    }
  });

  it("matches default Anthropic wire limits for hosted reasoning cases", () => {
    const cases: { modelId: string; options: ModelRuntimeCallOptions; expected: number }[] = [
      {
        modelId: "claude-opus-4-8",
        options: { prompt, providerOptions: { anthropic: { thinking: { type: "adaptive" } } } },
        expected: 128_000,
      },
      {
        modelId: "claude-sonnet-4-6",
        options: {
          prompt,
          providerOptions: { anthropic: { thinking: { type: "enabled", budget_tokens: 2048 } } },
        },
        expected: 64_000,
      },
      ...[{}, { enabled: false }, { enabled: true, budgetTokens: 1024 }].map((reasoning) => ({
        modelId: "claude-synthetic",
        options: {
          prompt,
          reasoning,
          providerOptions: { anthropic: { thinking: { type: "enabled", budget_tokens: 2048 } } },
        },
        expected: 4096,
      })),
    ];
    for (const { modelId, options, expected } of cases) {
      const captured = buildModelCallContextRequest({
        provider: "veryfront-cloud",
        modelProvider: "anthropic",
        modelId,
      }, options);
      for (const stream of [false, true]) {
        const body = buildAnthropicMessagesRequest(
          modelId,
          "veryfront-cloud",
          options,
          stream,
          createWarningCollector(),
        );
        assertEquals(body.max_tokens, expected);
        assertEquals(captured?.maxOutputTokens, body.max_tokens);
      }
    }
  });

  it("preserves explicit undefined native Anthropic token overrides", () => {
    const options: ModelRuntimeCallOptions = {
      prompt,
      maxOutputTokens: 64,
      providerOptions: { anthropic: { max_tokens: undefined } },
    };
    const projected = buildModelCallContextRequest({
      provider: "anthropic",
      modelProvider: "anthropic",
      modelId: "claude-haiku-4-5",
    }, options);
    const body = buildAnthropicMessagesRequest(
      "claude-haiku-4-5",
      "anthropic",
      options,
      false,
      createWarningCollector(),
    );
    assertEquals(body.max_tokens, undefined);
    assertEquals(projected?.maxOutputTokens, body.max_tokens);
  });

  it("matches direct Anthropic native max_tokens overrides to the exact wire body", () => {
    const options: ModelRuntimeCallOptions = {
      prompt,
      maxOutputTokens: 64,
      providerOptions: {
        anthropic: { max_tokens: 512 },
      },
    };
    const projected = buildModelCallContextRequest({
      provider: "anthropic",
      modelProvider: "anthropic",
      modelId: "claude-haiku-4-5",
    }, options);
    const body = buildAnthropicMessagesRequest(
      "claude-haiku-4-5",
      "anthropic",
      options,
      false,
      createWarningCollector(),
    );

    assertEquals(body.max_tokens, 512);
    assertEquals(projected?.maxOutputTokens, body.max_tokens);
  });

  it("shares neutral Anthropic controls between capture and the native wire builder", () => {
    const model = { provider: "anthropic", modelId: "claude-haiku-4-5" };
    const stopSequences = ["original"];
    const reasoning = { enabled: true, budgetTokens: 2048 };
    const options = snapshotModelCallProviderOptions(model, {
      prompt,
      maxOutputTokens: 8192,
      stopSequences,
      reasoning,
    });
    const projected = buildModelCallContextRequest(model, options);
    stopSequences[0] = "mutated";
    reasoning.budgetTokens = 4096;
    const body = buildAnthropicMessagesRequest(
      model.modelId,
      model.provider,
      options,
      false,
      createWarningCollector(),
    );
    assertEquals(projected?.stopSequences, ["original"]);
    assertEquals(body.stop_sequences, ["original"]);
    assertEquals(projected?.reasoning, { enabled: true, budgetTokens: 2048 });
    assertEquals(body.thinking, { type: "enabled", budget_tokens: 2048 });
  });

  it("snapshots direct Anthropic controls once for capture and the native wire builder", () => {
    const anthropic = { max_tokens: 512, thinking: { type: "enabled", budget_tokens: 2048 } };
    const options = snapshotModelCallProviderOptions(
      {
        provider: "anthropic",
        modelProvider: "anthropic",
        modelId: "claude-haiku-4-5",
      },
      {
        prompt,
        maxOutputTokens: 64,
        providerOptions: { anthropic },
      },
    );
    anthropic.max_tokens = 768;
    anthropic.thinking.budget_tokens = 4096;

    const model = {
      provider: "anthropic",
      modelProvider: "anthropic",
      modelId: "claude-haiku-4-5",
    };
    const projected = buildModelCallContextRequest(model, options);
    const body = buildAnthropicMessagesRequest(
      "claude-haiku-4-5",
      "anthropic",
      options,
      false,
      createWarningCollector(),
    );

    assertEquals(body.max_tokens, 512);
    assertEquals(projected?.maxOutputTokens, 512);
    assertEquals(projected?.reasoning, { enabled: true, budgetTokens: 2048 });
  });

  it("matches non-enumerable Anthropic provider buckets accepted by the request builder", () => {
    const providerOptions: NonNullable<ModelRuntimeCallOptions["providerOptions"]> = {};
    Object.defineProperty(providerOptions, "anthropic", {
      value: { max_tokens: 768 },
      enumerable: false,
      configurable: true,
      writable: true,
    });
    const options: ModelRuntimeCallOptions = {
      prompt,
      maxOutputTokens: 64,
      providerOptions,
    };
    const projected = buildModelCallContextRequest({
      provider: "anthropic",
      modelProvider: "anthropic",
      modelId: "claude-haiku-4-5",
    }, options);
    const body = buildAnthropicMessagesRequest(
      "claude-haiku-4-5",
      "anthropic",
      options,
      false,
      createWarningCollector(),
    );

    assertEquals(body.max_tokens, 768);
    assertEquals(projected?.maxOutputTokens, body.max_tokens);
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
      maxOutputTokens: 64_000,
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

  it("rejects Google accessor provider buckets before dispatch and persistence", () => {
    let getterCalls = 0;
    const providerOptions = Object.defineProperty({}, "google", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return {
          generationConfig: {
            maxOutputTokens: 999,
            temperature: 0.1,
            thinkingConfig: { thinkingBudget: 999 },
          },
        };
      },
    });
    const options: ModelRuntimeCallOptions = {
      prompt,
      temperature: 0.4,
      maxOutputTokens: 64,
      reasoning: { enabled: true, budgetTokens: 1024 },
      providerOptions,
    };

    assertThrows(
      () =>
        buildModelCallContextRequest({
          provider: "veryfront-cloud",
          modelProvider: "google",
          modelId: "gemini-synthetic",
        }, options),
      TypeError,
      'Provider options for "google" must be a data property',
    );
    assertThrows(
      () =>
        buildGoogleGenerateContentRequest(
          "veryfront-cloud",
          options,
          createWarningCollector(),
        ),
      TypeError,
      'Provider options for "google" must be a data property',
    );
    assertEquals(getterCalls, 0);
  });

  it("rejects OpenAI accessor provider buckets before dispatch and persistence", () => {
    let getterCalls = 0;
    const providerOptions = Object.defineProperty({}, "openai", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return {
          max_tokens: 777,
          max_output_tokens: 888,
          reasoning: { effort: "high" },
          reasoning_effort: "low",
        };
      },
    });
    const options: ModelRuntimeCallOptions = {
      prompt,
      maxOutputTokens: 64,
      reasoning: { enabled: true, effort: "medium" },
      providerOptions,
    };

    assertThrows(
      () =>
        buildModelCallContextRequest({
          provider: "openai",
          modelProvider: "openai",
          modelId: "gpt-4o",
          openAITransport: "chat-completions",
        }, options),
      TypeError,
      'Provider options for "openai" must be a data property',
    );
    assertThrows(
      () =>
        buildOpenAIChatRequest(
          "gpt-4o",
          "openai",
          options,
          false,
          createWarningCollector(),
        ),
      TypeError,
      'Provider options for "openai" must be a data property',
    );
    assertThrows(
      () =>
        buildOpenAIResponsesRequest(
          "gpt-5.4-mini",
          "openai",
          options,
          false,
          createWarningCollector(),
        ),
      TypeError,
      'Provider options for "openai" must be a data property',
    );
    assertEquals(getterCalls, 0);
  });

  it("uses OpenAI provider bucket descriptors instead of proxy get traps", () => {
    let getTrapCalls = 0;
    const providerOptions = new Proxy({}, {
      getOwnPropertyDescriptor(_target, key) {
        if (key !== "openai") return undefined;
        return {
          configurable: true,
          enumerable: true,
          value: { max_tokens: 111, reasoning_effort: "low" },
          writable: true,
        };
      },
      get(_target, key) {
        if (key === "openai") {
          getTrapCalls += 1;
          return { max_tokens: 777, reasoning_effort: "high" };
        }
        return undefined;
      },
      ownKeys() {
        return ["openai"];
      },
    }) as Record<string, unknown>;
    const options: ModelRuntimeCallOptions = { prompt, providerOptions };

    const projected = buildModelCallContextRequest({
      provider: "openai",
      modelProvider: "openai",
      modelId: "gpt-4o",
      openAITransport: "chat-completions",
    }, options);
    const chatBody = buildOpenAIChatRequest(
      "gpt-4o",
      "openai",
      options,
      false,
      createWarningCollector(),
    );
    const responseBody = buildOpenAIResponsesRequest(
      "gpt-5.4-mini",
      "openai",
      options,
      false,
      createWarningCollector(),
    );

    assertEquals(projected?.maxOutputTokens, 111);
    assertEquals(projected?.reasoning, { enabled: true, effort: "low" });
    assertEquals(chatBody.max_completion_tokens, 111);
    assertEquals(chatBody.reasoning_effort, "low");
    assertEquals(responseBody.max_tokens, 111);
    assertEquals(responseBody.reasoning_effort, "low");
    assertEquals(getTrapCalls, 0);
  });

  it("rejects OpenAI native option accessors before dispatch and persistence", () => {
    let getterCalls = 0;
    const openai = Object.defineProperty({}, "max_tokens", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 777;
      },
    });
    const options: ModelRuntimeCallOptions = {
      prompt,
      providerOptions: { openai },
    };

    assertThrows(
      () =>
        buildModelCallContextRequest({
          provider: "openai",
          modelProvider: "openai",
          modelId: "gpt-4o",
          openAITransport: "chat-completions",
        }, options),
      TypeError,
      'Provider options for "openai" must contain data properties',
    );
    assertThrows(
      () =>
        buildOpenAIChatRequest(
          "gpt-4o",
          "openai",
          options,
          false,
          createWarningCollector(),
        ),
      TypeError,
      'Provider options for "openai" must contain data properties',
    );
    assertThrows(
      () =>
        buildOpenAIResponsesRequest(
          "gpt-5.4-mini",
          "openai",
          options,
          false,
          createWarningCollector(),
        ),
      TypeError,
      'Provider options for "openai" must contain data properties',
    );
    assertEquals(getterCalls, 0);
  });

  it("sanitizes OpenAI provider option enumeration failures before capture and dispatch", () => {
    const privateFailure = "private-provider-enumeration-sentinel";
    const buckets = [
      new Proxy({}, {
        ownKeys() {
          throw new Error(privateFailure);
        },
      }),
      new Proxy({ max_tokens: 111 }, {
        getOwnPropertyDescriptor() {
          throw new Error(privateFailure);
        },
      }),
    ];
    for (const openai of buckets) {
      const options: ModelRuntimeCallOptions = { prompt, providerOptions: { openai } };
      const calls = [
        () =>
          buildModelCallContextRequest({
            provider: "openai",
            modelProvider: "openai",
            modelId: "gpt-4o",
            openAITransport: "chat-completions",
          }, options),
        () => buildOpenAIChatRequest("gpt-4o", "openai", options, false, createWarningCollector()),
        () =>
          buildOpenAIResponsesRequest(
            "gpt-5.4-mini",
            "openai",
            options,
            false,
            createWarningCollector(),
          ),
      ];
      for (const call of calls) {
        const message = 'Provider options for "openai" could not be enumerated';
        const error = assertThrows(call, TypeError, message);
        assert(error instanceof TypeError);
        assertEquals(error.message, message);
        assertEquals(error.cause, undefined);
      }
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
