import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  getForwardedHostedModelId,
  getForwardedHostedRuntimeOverrides,
  resolveHostedRuntimeRequestConfig,
  resolveHostedRuntimeThinkingOverride,
} from "./hosted-runtime-request-config.ts";
import type { RuntimeAgentMarkdownDefinition } from "./runtime-agent-definition.ts";

function createAgentConfig(
  overrides: Partial<RuntimeAgentMarkdownDefinition> = {},
): RuntimeAgentMarkdownDefinition {
  return {
    id: "veryfront",
    name: "Veryfront",
    description: "Veryfront agent",
    instructions: "Help the user.",
    model: "anthropic/claude-sonnet-4-6",
    thinking: { enabled: true, budgetTokens: 5000 },
    maxSteps: 12,
    ...overrides,
  };
}

Deno.test("getForwardedHostedModelId returns non-empty forwarded models", () => {
  assertEquals(getForwardedHostedModelId({ model: "opus" }), "opus");
  assertEquals(getForwardedHostedModelId({ model: "" }), undefined);
  assertEquals(getForwardedHostedModelId({ model: "   " }), undefined);
  assertEquals(getForwardedHostedModelId({ model: 42 }), undefined);
  assertEquals(getForwardedHostedModelId(undefined), undefined);
});

Deno.test("getForwardedHostedRuntimeOverrides parses non-empty forwarded runtime overrides", () => {
  assertEquals(getForwardedHostedRuntimeOverrides(undefined), undefined);
  assertEquals(getForwardedHostedRuntimeOverrides({ runtimeOverrides: "bad" }), undefined);
  assertEquals(getForwardedHostedRuntimeOverrides({ runtimeOverrides: null }), undefined);
  assertEquals(getForwardedHostedRuntimeOverrides({ runtimeOverrides: {} }), undefined);
  assertEquals(getForwardedHostedRuntimeOverrides({ runtimeOverrides: { thinking: 1000 } }), {
    thinking: 1000,
  });
});

Deno.test("resolveHostedRuntimeThinkingOverride applies optional thinking override", () => {
  const configuredThinking = { enabled: true, budgetTokens: 5000 };
  assertEquals(
    resolveHostedRuntimeThinkingOverride({
      configuredThinking,
      requestedThinking: undefined,
    }),
    configuredThinking,
  );
  assertEquals(
    resolveHostedRuntimeThinkingOverride({
      configuredThinking,
      requestedThinking: false,
    }),
    { enabled: false },
  );
  assertEquals(
    resolveHostedRuntimeThinkingOverride({
      configuredThinking: undefined,
      requestedThinking: 2000,
    }),
    { enabled: true, budgetTokens: 2000 },
  );
});

Deno.test("resolveHostedRuntimeRequestConfig prefers request model over forwarded and configured models", () => {
  const result = resolveHostedRuntimeRequestConfig({
    request: {
      model: "openai/gpt-5.2",
      forwardedProps: { model: "anthropic/claude-opus-4-6" },
    },
    agentConfig: createAgentConfig({ model: "anthropic/claude-haiku-4-5" }),
    resolveModelId: (model) => model ? `veryfront-cloud/${model}` : undefined,
  });

  assertEquals(result.requestedModel, "veryfront-cloud/openai/gpt-5.2");
});

Deno.test("resolveHostedRuntimeRequestConfig resolves overrides, thinking, max steps, and client profile", () => {
  const result = resolveHostedRuntimeRequestConfig({
    request: {
      model: "anthropic/claude-sonnet-4-6",
      forwardedProps: {
        veryfront: {
          client: {
            id: "veryfront-studio",
          },
        },
        runtimeOverrides: {
          allowedTools: ["read_file"],
          maxSteps: 8,
        },
      },
      runtimeOverrides: { thinking: false },
    },
    agentConfig: createAgentConfig({ maxSteps: 12 }),
    resolveModelId: (model) => model ? `veryfront-cloud/${model}` : undefined,
    resolveModelThinking: (model) =>
      model === "veryfront-cloud/anthropic/claude-sonnet-4-6"
        ? { enabled: true, budgetTokens: 2048 }
        : undefined,
  });

  assertEquals(result.effectiveRuntimeOverrides, { thinking: false });
  assertEquals(result.requestedMaxSteps, 12);
  assertEquals(result.requestedThinking, { enabled: false });
  assertEquals(result.clientProfile, {
    id: "veryfront-studio",
    type: "web",
    trusted: true,
    capabilities: ["ui_panels", "form_input", "media_display", "project_switching"],
  });
});

Deno.test("resolveHostedRuntimeRequestConfig uses forwarded overrides when request overrides are absent", () => {
  const result = resolveHostedRuntimeRequestConfig({
    request: {
      forwardedProps: {
        runtimeOverrides: {
          allowedTools: ["read_file"],
          maxSteps: 8,
        },
      },
    },
    agentConfig: createAgentConfig({ maxSteps: 12 }),
    resolveModelId: (model) => model ? `veryfront-cloud/${model}` : undefined,
  });

  assertEquals(result.effectiveRuntimeOverrides, { allowedTools: ["read_file"], maxSteps: 8 });
  assertEquals(result.requestedMaxSteps, 8);
});
