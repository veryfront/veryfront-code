import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { seedServedCatalogForTests } from "#veryfront/provider/veryfront-cloud/catalog-client.test-helpers.ts";
import { __resetVeryfrontCloudCatalogForTests } from "#veryfront/provider/veryfront-cloud/catalog-client.ts";
import type { ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import { createWarningCollector } from "#veryfront/provider/shared/index.ts";
import { buildModelCallContextRequest } from "#veryfront/runtime/model-call-context-request.ts";
import { buildGoogleGenerateContentRequest } from "../../../../../extensions/ext-llm-google/src/google-request-builder.ts";
import { buildOpenAIChatRequest } from "../../../../../extensions/ext-llm-openai/src/openai-chat-request-builder.ts";
import { buildOpenAIResponsesRequest } from "../../../../../extensions/ext-llm-openai/src/openai-responses-request-builder.ts";

const prompt: ModelRuntimeCallOptions["prompt"] = [{
  role: "user",
  content: [{ type: "text", text: "Synthetic request" }],
}];
const sampling = { temperature: 0.4, topP: 0.8, presencePenalty: 0.3, frequencyPenalty: 0.1 };

describe("model call request projection intrinsic boundaries", () => {
  beforeEach(seedServedCatalogForTests);
  afterEach(__resetVeryfrontCloudCatalogForTests);

  it("records provider controls when Object.keys is replaced before dispatch", () => {
    const nativeObjectKeys = Object.keys;
    Object.keys = (() => []) as typeof Object.keys;
    try {
      const options: ModelRuntimeCallOptions = {
        prompt,
        ...sampling,
        maxOutputTokens: 64,
        topK: 9,
        seed: 7,
        stopSequences: ["STOP"],
        reasoning: { enabled: true, budgetTokens: 1024 },
        providerOptions: {
          google: {
            generationConfig: {
              maxOutputTokens: 128,
              temperature: 0.2,
              topP: 0.6,
              topK: 4,
              seed: 3,
              stopSequences: ["NATIVE_STOP"],
              thinkingConfig: { thinkingBudget: 1024, includeThoughts: true },
            },
          },
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
      assertEquals(body.generationConfig?.maxOutputTokens, 128);
      assertEquals(body.generationConfig?.temperature, 0.2);
      assertEquals(body.generationConfig?.topP, 0.6);
      assertEquals(body.generationConfig?.topK, 4);
      assertEquals(body.generationConfig?.stopSequences, ["NATIVE_STOP"]);
      assertEquals(body.generationConfig?.seed, 3);
      assertEquals(projected, {
        maxOutputTokens: 128,
        temperature: 0.2,
        topP: 0.6,
        topK: 4,
        stopSequences: ["NATIVE_STOP"],
        seed: 3,
        reasoning: { enabled: true, budgetTokens: 1024 },
      });
    } finally {
      Object.keys = nativeObjectKeys;
    }
  });

  it("preserves native OpenAI provider options when Map is replaced before dispatch", () => {
    // JSON.parse defines "__proto__" as an own data property without touching the prototype.
    const parsedOpenAIOptions: unknown = JSON.parse(
      '{"max_tokens":777,"__proto__":"literal-proto"}',
    );
    if (
      typeof parsedOpenAIOptions !== "object" || parsedOpenAIOptions === null ||
      Array.isArray(parsedOpenAIOptions)
    ) {
      throw new Error("expected a JSON object fixture");
    }
    const nativeOpenAIOptions: Record<string, unknown> = {
      ...parsedOpenAIOptions,
      seed: undefined,
    };
    const protoDescriptor = Object.getOwnPropertyDescriptor(nativeOpenAIOptions, "__proto__");
    assertEquals(protoDescriptor?.value, "literal-proto");
    assertEquals(protoDescriptor?.enumerable, true);
    assertEquals(Object.getPrototypeOf(nativeOpenAIOptions), Object.prototype);
    const options: ModelRuntimeCallOptions = {
      prompt,
      maxOutputTokens: 100,
      seed: 42,
      providerOptions: {
        "openai-compatible": { max_tokens: 111 },
        openai: nativeOpenAIOptions,
      },
    };
    const nativeMap = globalThis.Map;
    const nativeMapSet = Map.prototype.set;
    const nativeMapForEach = Map.prototype.forEach;
    let projected: ReturnType<typeof buildModelCallContextRequest>;
    try {
      globalThis.Map = function (): never {
        throw new Error("patched Map constructor");
      } as unknown as typeof Map;
      nativeMap.prototype.set = function (): never {
        throw new Error("patched Map.set");
      };
      nativeMap.prototype.forEach = function (): never {
        throw new Error("patched Map.forEach");
      };
      projected = buildModelCallContextRequest({
        provider: "openai",
        modelProvider: "openai",
        modelId: "gpt-4o",
        openAITransport: "chat-completions",
      }, options);
    } finally {
      nativeMap.prototype.set = nativeMapSet;
      nativeMap.prototype.forEach = nativeMapForEach;
      globalThis.Map = nativeMap;
    }

    assertEquals(projected?.maxOutputTokens, 777);
    assertEquals(projected?.seed, undefined);
  });

  it("preserves native OpenAI Chat token aliases when Array iteration is replaced before dispatch", () => {
    const options: ModelRuntimeCallOptions = {
      prompt,
      maxOutputTokens: 100,
      providerOptions: {
        "openai-compatible": { max_completion_tokens: 222 },
        openai: { max_tokens: 333, max_output_tokens: 999 },
      },
    };
    const warmup = buildModelCallContextRequest({
      provider: "openai",
      modelProvider: "openai",
      modelId: "gpt-4o",
      openAITransport: "chat-completions",
    }, options);
    assertEquals(warmup?.maxOutputTokens, 333);

    const originalArrayIterator = Array.prototype[Symbol.iterator];
    let projectedMaxOutputTokens: number | undefined;
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true,
      value() {
        throw new Error("patched array iterator");
      },
    });
    try {
      projectedMaxOutputTokens = buildModelCallContextRequest({
        provider: "openai",
        modelProvider: "openai",
        modelId: "gpt-4o",
        openAITransport: "chat-completions",
      }, options)?.maxOutputTokens;
    } finally {
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        configurable: true,
        writable: true,
        value: originalArrayIterator,
      });
    }

    assertEquals(projectedMaxOutputTokens, 333);
  });

  it("preserves OpenAI request builder buckets when descriptor intrinsics are replaced", () => {
    let getTrapCalls = 0;
    const originalArrayIterator = Array.prototype[Symbol.iterator];
    const providerOptions = new Proxy({}, {
      getOwnPropertyDescriptor(_target, key) {
        if (key !== "openai") return undefined;
        return {
          configurable: true,
          enumerable: true,
          value: { max_tokens: 111, max_output_tokens: 222 },
          writable: true,
        };
      },
      get(_target, key) {
        if (key === "openai") {
          getTrapCalls += 1;
          return { max_tokens: 777, max_output_tokens: 888 };
        }
        return undefined;
      },
      ownKeys() {
        return ["openai"];
      },
    }) as Record<string, unknown>;
    const options: ModelRuntimeCallOptions = { prompt, providerOptions };
    const nativeDescriptor = Object.getOwnPropertyDescriptor;
    const nativeHasOwn = Object.hasOwn;
    let chatMaxOutputTokens: number | undefined;
    let responsesMaxOutputTokens: number | undefined;
    Object.getOwnPropertyDescriptor = function (): never {
      throw new Error("patched descriptor");
    };
    Object.hasOwn = () => false;
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true,
      value() {
        const values = Array.isArray(this) ? this : [];
        if (
          values[0] === "openai-compatible" ||
          values[0] === "openai" ||
          values[0] === "max_tokens" ||
          values[0] === "max_output_tokens"
        ) {
          throw new Error("patched OpenAI provider option iterator");
        }
        return originalArrayIterator.call(this);
      },
    });
    try {
      const chatBody = buildOpenAIChatRequest(
        "gpt-4o",
        "openai",
        options,
        false,
        createWarningCollector(),
      );
      chatMaxOutputTokens = chatBody.max_completion_tokens;
      const responsesBody = buildOpenAIResponsesRequest(
        "gpt-5.4-mini",
        "openai",
        options,
        false,
        createWarningCollector(),
      );
      responsesMaxOutputTokens = responsesBody.max_output_tokens;
    } finally {
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        configurable: true,
        writable: true,
        value: originalArrayIterator,
      });
      Object.hasOwn = nativeHasOwn;
      Object.getOwnPropertyDescriptor = nativeDescriptor;
    }

    assertEquals(chatMaxOutputTokens, 111);
    assertEquals(responsesMaxOutputTokens, 222);
    assertEquals(getTrapCalls, 0);
  });

  it("preserves native Anthropic controls when Array iteration is replaced before dispatch", () => {
    const options: ModelRuntimeCallOptions = {
      prompt,
      ...sampling,
      maxOutputTokens: 64,
      topK: 9,
      seed: 7,
      stopSequences: ["neutral"],
      providerOptions: {
        anthropic: {
          max_tokens: 512,
          temperature: 0.1,
          top_p: 0.2,
          top_k: 3,
          seed: 4,
          presence_penalty: 0.5,
          frequency_penalty: 0.6,
          stop_sequences: ["native"],
        },
      },
    };
    const originalArrayIterator = Array.prototype[Symbol.iterator];
    let projected: ReturnType<typeof buildModelCallContextRequest>;
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true,
      value() {
        throw new Error("patched array iterator");
      },
    });
    try {
      projected = buildModelCallContextRequest({
        provider: "anthropic",
        modelProvider: "anthropic",
        modelId: "claude-synthetic",
      }, options);
    } finally {
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        configurable: true,
        writable: true,
        value: originalArrayIterator,
      });
    }

    assertEquals(projected, {
      maxOutputTokens: 512,
      temperature: 0.1,
      topP: 0.2,
      topK: 3,
      seed: 4,
      presencePenalty: 0.5,
      frequencyPenalty: 0.6,
      stopSequences: ["native"],
    });
  });

  it("preserves Google generation config controls when Array iteration is replaced before dispatch", () => {
    const options: ModelRuntimeCallOptions = {
      prompt,
      ...sampling,
      maxOutputTokens: 64,
      topK: 9,
      seed: 7,
      stopSequences: ["neutral"],
      providerOptions: {
        google: {
          generationConfig: {
            maxOutputTokens: 128,
            temperature: 0.2,
            topP: 0.6,
            topK: 4,
            seed: 3,
            presencePenalty: 0.7,
            frequencyPenalty: 0.8,
            stopSequences: ["NATIVE_STOP"],
          },
        },
      },
    };
    const originalArrayIterator = Array.prototype[Symbol.iterator];
    let projected: ReturnType<typeof buildModelCallContextRequest>;
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true,
      value() {
        throw new Error("patched array iterator");
      },
    });
    try {
      projected = buildModelCallContextRequest({
        provider: "veryfront-cloud",
        modelProvider: "google",
        modelId: "gemini-synthetic",
      }, options);
    } finally {
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        configurable: true,
        writable: true,
        value: originalArrayIterator,
      });
    }

    assertEquals(projected, {
      maxOutputTokens: 128,
      temperature: 0.2,
      topP: 0.6,
      topK: 4,
      seed: 3,
      presencePenalty: 0.7,
      frequencyPenalty: 0.8,
      stopSequences: ["NATIVE_STOP"],
    });
  });

  it("preserves native OpenAI Chat token aliases when RegExp matching is replaced before dispatch", () => {
    const nativeRegExpExec = RegExp.prototype.exec;
    const nativeRegExpTest = RegExp.prototype.test;

    try {
      const options: ModelRuntimeCallOptions = {
        prompt,
        maxOutputTokens: 100,
        providerOptions: { openai: { max_completion_tokens: 444 } },
      };
      const body = buildOpenAIChatRequest(
        "gpt-4o",
        "openai",
        options,
        false,
        createWarningCollector(),
      );
      assertEquals(body.max_completion_tokens, 444);

      RegExp.prototype.exec = (() => null) as typeof RegExp.prototype.exec;
      RegExp.prototype.test = (() => false) as typeof RegExp.prototype.test;
      const projected = buildModelCallContextRequest({
        provider: "openai",
        modelProvider: "openai",
        modelId: "gpt-4o",
        openAITransport: "chat-completions",
      }, options);

      assertEquals(projected?.maxOutputTokens, body.max_completion_tokens);
    } finally {
      RegExp.prototype.exec = nativeRegExpExec;
      RegExp.prototype.test = nativeRegExpTest;
    }
  });

  it("preserves Google thinking budgets when Number.isSafeInteger is replaced before dispatch", () => {
    const nativeNumberIsSafeInteger = Number.isSafeInteger;
    const replacements: Array<typeof Number.isSafeInteger> = [
      () => {
        throw new Error("poisoned Number.isSafeInteger");
      },
      () => false,
    ];

    try {
      const options: ModelRuntimeCallOptions = {
        prompt,
        ...sampling,
        reasoning: { enabled: true, budgetTokens: 1024 },
        providerOptions: {
          google: {
            generationConfig: {
              thinkingConfig: { thinkingBudget: 4096, includeThoughts: true },
            },
          },
        },
      };
      const body = buildGoogleGenerateContentRequest(
        "veryfront-cloud",
        options,
        createWarningCollector(),
      );
      assertEquals(body.generationConfig?.thinkingConfig, {
        thinkingBudget: 4096,
        includeThoughts: true,
      });

      for (const replacement of replacements) {
        Number.isSafeInteger = replacement;
        const projected = buildModelCallContextRequest({
          provider: "veryfront-cloud",
          modelProvider: "google",
          modelId: "gemini-synthetic",
        }, options);

        assertEquals(projected?.reasoning, { enabled: true, budgetTokens: 4096 });
      }
    } finally {
      Number.isSafeInteger = nativeNumberIsSafeInteger;
    }
  });

  it("preserves Anthropic thinking budgets when Number.isInteger is replaced before dispatch", () => {
    const nativeNumberIsInteger = Number.isInteger;
    const replacements: Array<typeof Number.isInteger> = [
      () => {
        throw new Error("poisoned Number.isInteger");
      },
      () => false,
    ];

    try {
      for (const replacement of replacements) {
        Number.isInteger = replacement;
        const projected = buildModelCallContextRequest({
          provider: "veryfront-cloud",
          modelProvider: "anthropic",
          modelId: "claude-synthetic",
        }, {
          ...sampling,
          providerOptions: {
            anthropic: {
              thinking: { type: "enabled", budget_tokens: 2048 },
            },
          },
        });

        assertEquals(projected, {
          reasoning: { enabled: true, budgetTokens: 2048 },
        });
      }
    } finally {
      Number.isInteger = nativeNumberIsInteger;
    }
  });
});
