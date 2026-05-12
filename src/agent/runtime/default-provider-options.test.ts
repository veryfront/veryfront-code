import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveProviderOptionsWithDefaults } from "./default-provider-options.ts";

describe("resolveProviderOptionsWithDefaults", () => {
  it("enables Anthropic thinking by default for Anthropic models", () => {
    const result = resolveProviderOptionsWithDefaults(
      "anthropic/claude-opus-4-6",
      undefined,
    );

    assertEquals(result, {
      anthropic: {
        temperature: 1,
        thinking: { type: "enabled", budget_tokens: 2048 },
      },
    });
  });

  it("recognizes the veryfront-cloud prefix as Anthropic when applicable", () => {
    const result = resolveProviderOptionsWithDefaults(
      "veryfront-cloud/anthropic/claude-sonnet-4-6",
      undefined,
    );

    assertEquals(result, {
      anthropic: {
        temperature: 1,
        thinking: { type: "enabled", budget_tokens: 2048 },
      },
    });
  });

  it("does not enable thinking for non-Anthropic models", () => {
    assertEquals(
      resolveProviderOptionsWithDefaults("openai/gpt-5.2", undefined),
      undefined,
    );
    assertEquals(
      resolveProviderOptionsWithDefaults("google/gemini-2.5-pro", undefined),
      undefined,
    );
  });

  it("respects an existing anthropic.thinking config from the app instead of overriding", () => {
    const existing = {
      anthropic: {
        thinking: { type: "enabled" as const, budget_tokens: 8000 },
      },
    };

    const result = resolveProviderOptionsWithDefaults(
      "anthropic/claude-opus-4-6",
      existing,
    );

    assertEquals(result, existing);
  });

  it("respects an explicit opt-out (anthropic.thinking.type === 'disabled') from the app", () => {
    const existing = {
      anthropic: {
        thinking: { type: "disabled" as const },
      },
    };

    const result = resolveProviderOptionsWithDefaults(
      "anthropic/claude-opus-4-6",
      existing,
    );

    assertEquals(result, existing);
  });

  it("merges anthropic-thinking default into app providerOptions that don't mention thinking", () => {
    const existing = {
      anthropic: {
        cacheControl: { type: "ephemeral" as const },
      },
    };

    const result = resolveProviderOptionsWithDefaults(
      "anthropic/claude-opus-4-6",
      existing,
    );

    assertEquals(result, {
      anthropic: {
        cacheControl: { type: "ephemeral" },
        temperature: 1,
        thinking: { type: "enabled", budget_tokens: 2048 },
      },
    });
  });

  it("preserves a host-supplied anthropic.temperature instead of forcing 1", () => {
    const existing = {
      anthropic: {
        temperature: 0,
      },
    };

    const result = resolveProviderOptionsWithDefaults(
      "anthropic/claude-opus-4-6",
      existing,
    );

    assertEquals(result, {
      anthropic: {
        temperature: 0,
        thinking: { type: "enabled", budget_tokens: 2048 },
      },
    });
  });
});
