import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { seedServedCatalogForTests } from "#veryfront/provider/veryfront-cloud/catalog-client.test-helpers.ts";
import { __resetVeryfrontCloudCatalogForTests } from "#veryfront/provider/veryfront-cloud/catalog-client.ts";
import type { ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import { createWarningCollector } from "#veryfront/provider/shared/index.ts";
import { buildModelCallContextRequest } from "#veryfront/runtime/model-call-context-request.ts";
import { buildGoogleGenerateContentRequest } from "../../../../../extensions/ext-llm-google/src/google-request-builder.ts";
import { buildOpenAIChatRequest } from "../../../../../extensions/ext-llm-openai/src/openai-chat-request-builder.ts";

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
      assertEquals(body.generationConfig?.thinkingConfig?.thinkingBudget, 4096);

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
          prompt,
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
