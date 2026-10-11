import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimePromptMessage } from "veryfront/provider/shared";
import {
  __resetVeryfrontCloudCatalogForTests,
  __setVeryfrontCloudCatalogForTests,
} from "#veryfront/provider/veryfront-cloud/catalog-client.ts";
import { resolveVeryfrontCloudModelThinking } from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import { buildGoogleGenerateContentRequest } from "../../../../../extensions/ext-llm-google/src/google-request-builder.ts";
import { buildAnthropicMessagesRequest } from "../../../../../extensions/ext-llm-anthropic/src/anthropic-request-builder.ts";

const prompt: RuntimePromptMessage[] = [{
  role: "user",
  content: [{ type: "text", text: "Think carefully." }],
}];

describe("provider reasoning request builder intrinsic boundaries", () => {
  afterEach(() => {
    __resetVeryfrontCloudCatalogForTests();
  });

  it("keeps explicit Google thinking budgets when Number.isSafeInteger is replaced", () => {
    const nativeNumberIsSafeInteger = Number.isSafeInteger;
    const replacements: Array<typeof Number.isSafeInteger> = [
      () => {
        throw new Error("poisoned Number.isSafeInteger");
      },
      () => false,
    ];

    try {
      for (const replacement of replacements) {
        Number.isSafeInteger = replacement;
        const body = buildGoogleGenerateContentRequest(
          "google",
          {
            prompt,
            reasoning: { enabled: true, budgetTokens: 1024 },
          },
          createWarningCollector(),
        );

        assertEquals(body.generationConfig?.thinkingConfig, {
          includeThoughts: true,
          thinkingBudget: 1024,
        });
      }
    } finally {
      Number.isSafeInteger = nativeNumberIsSafeInteger;
    }
  });

  it("keeps neutral Google thinking config when Object.keys is replaced", () => {
    const nativeObjectKeys = Object.keys;

    try {
      Object.keys = (() => []) as typeof Object.keys;
      const body = buildGoogleGenerateContentRequest(
        "google",
        {
          prompt,
          reasoning: { enabled: true, effort: "high" },
        },
        createWarningCollector(),
      );

      assertEquals(body.generationConfig?.thinkingConfig, {
        includeThoughts: true,
        thinkingBudget: 8192,
      });
    } finally {
      Object.keys = nativeObjectKeys;
    }
  });

  it("keeps native Google provider options when Object.assign is replaced", () => {
    const nativeObjectAssign = Object.assign;

    try {
      Object.assign = ((target: object) => target) as typeof Object.assign;
      const body = buildGoogleGenerateContentRequest(
        "google",
        {
          prompt,
          reasoning: { enabled: true, budgetTokens: 1024 },
          providerOptions: {
            google: {
              cachedContent: "cachedContents/request-1",
              generationConfig: {
                temperature: 0.2,
                thinkingConfig: { includeThoughts: true, thinkingBudget: 2048 },
              },
            },
          },
        },
        createWarningCollector(),
      );

      assertEquals(body.cachedContent, "cachedContents/request-1");
      assertEquals(body.generationConfig?.temperature, 0.2);
      assertEquals(body.generationConfig?.thinkingConfig, {
        includeThoughts: true,
        thinkingBudget: 2048,
      });
    } finally {
      Object.assign = nativeObjectAssign;
    }
  });

  it("keeps Anthropic thinking budgets when Number.isSafeInteger is replaced", () => {
    const nativeNumberIsSafeInteger = Number.isSafeInteger;
    const replacements: Array<typeof Number.isSafeInteger> = [
      () => {
        throw new Error("poisoned Number.isSafeInteger");
      },
      () => false,
    ];

    try {
      for (const replacement of replacements) {
        Number.isSafeInteger = replacement;
        const neutral = buildAnthropicMessagesRequest(
          "claude-sonnet-4-6",
          "anthropic",
          {
            prompt,
            maxOutputTokens: 4096,
            reasoning: { enabled: true, budgetTokens: 4096 },
          },
          false,
          createWarningCollector(),
        );
        const native = buildAnthropicMessagesRequest(
          "claude-sonnet-4-6",
          "anthropic",
          {
            prompt,
            maxOutputTokens: 4096,
            providerOptions: {
              anthropic: { thinking: { type: "enabled", budget_tokens: 2048 } },
            },
          },
          false,
          createWarningCollector(),
        );

        assertEquals(neutral.thinking, { type: "enabled", budget_tokens: 4096 });
        assertEquals(neutral.max_tokens, 8192);
        assertEquals(native.thinking, { type: "enabled", budget_tokens: 2048 });
        assertEquals(native.max_tokens, 6144);
      }
    } finally {
      Number.isSafeInteger = nativeNumberIsSafeInteger;
    }
  });

  it("keeps Anthropic thinking max tokens when Math.min is replaced", () => {
    const nativeMathMin = Math.min;

    try {
      Math.min = (() => 1) as typeof Math.min;
      const summed = buildAnthropicMessagesRequest(
        "claude-sonnet-4-6",
        "anthropic",
        {
          prompt,
          maxOutputTokens: 4096,
          reasoning: { enabled: true, budgetTokens: 4096 },
        },
        false,
        createWarningCollector(),
      );
      const capped = buildAnthropicMessagesRequest(
        "claude-sonnet-4-6",
        "anthropic",
        {
          prompt,
          maxOutputTokens: 64_000,
          reasoning: { enabled: true, budgetTokens: 4096 },
        },
        false,
        createWarningCollector(),
      );

      assertEquals(summed.thinking, { type: "enabled", budget_tokens: 4096 });
      assertEquals(summed.max_tokens, 8192);
      assertEquals(capped.thinking, { type: "enabled", budget_tokens: 4096 });
      assertEquals(capped.max_tokens, 64_000);
    } finally {
      Math.min = nativeMathMin;
    }
  });

  it("keeps served Veryfront Cloud thinking budgets when Number.isSafeInteger is replaced", () => {
    __setVeryfrontCloudCatalogForTests({
      models: [{
        id: "claude-sonnet-4-6",
        modelId: "anthropic/claude-sonnet-4-6",
        provider: "anthropic",
        surface: "anthropic",
        aliases: [],
        capabilities: {
          thinking: true,
          reasoning_mode: "budget",
          reasoning_budget_tokens: 4096,
        },
      }],
    });
    const nativeNumberIsSafeInteger = Number.isSafeInteger;
    const replacements: Array<typeof Number.isSafeInteger> = [
      () => {
        throw new Error("poisoned Number.isSafeInteger");
      },
      () => false,
    ];

    try {
      for (const replacement of replacements) {
        Number.isSafeInteger = replacement;
        assertEquals(resolveVeryfrontCloudModelThinking("anthropic/claude-sonnet-4-6"), {
          enabled: true,
          budgetTokens: 4096,
        });
      }
    } finally {
      Number.isSafeInteger = nativeNumberIsSafeInteger;
    }
  });
});

function createWarningCollector() {
  const warnings: Array<{
    type: "unsupported-setting" | "other";
    setting?: string;
    details?: string;
    provider: string;
  }> = [];

  return {
    push(warning: {
      type: "unsupported-setting" | "other";
      setting?: string;
      details?: string;
      provider: string;
    }) {
      warnings.push(warning);
    },
    drain() {
      return warnings.slice();
    },
  };
}
