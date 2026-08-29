import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  getForwardedHostedModelId,
  getForwardedHostedRuntimeOverrides,
  getServerResolvedProviderReplayCheckpoints,
  getServerResolvedToolExposureCheckpoint,
  resolveHostedRuntimeRequestConfig,
  resolveHostedRuntimeThinkingOverride,
} from "./runtime-request-config.ts";

it("server-resolved tool exposure checkpoint parses strictly and fails closed", () => {
  const checkpoint = {
    version: 1 as const,
    loadedToolNames: ["get_release"],
  };
  assertEquals(
    getServerResolvedToolExposureCheckpoint({
      serverResolvedToolExposureCheckpoint: checkpoint,
    }, true),
    checkpoint,
  );
  assertEquals(
    getServerResolvedToolExposureCheckpoint({
      serverResolvedToolExposureCheckpoint: {
        ...checkpoint,
        version: 2,
      },
    }, true),
    {
      version: 2,
      loadedToolNames: ["get_release"],
    },
  );
  assertEquals(
    getServerResolvedToolExposureCheckpoint({
      serverResolvedToolExposureCheckpoint: {
        ...checkpoint,
        version: 3,
      },
    }, true),
    undefined,
  );
  assertEquals(
    getServerResolvedToolExposureCheckpoint({
      serverResolvedToolExposureCheckpoint: {
        ...checkpoint,
        loadedToolNames: ["get_release", "get_release"],
      },
    }, true),
    undefined,
  );
  assertEquals(
    getServerResolvedToolExposureCheckpoint({
      serverResolvedToolExposureCheckpoint: checkpoint,
    }, false),
    undefined,
  );
});

it("server-resolved provider replay checkpoints require a verified envelope and valid state", () => {
  const checkpoint = {
    version: 1 as const,
    messageId: "assistant-message-1",
    provider: "anthropic" as const,
    providerBlocks: [{
      type: "provider-block" as const,
      provider: "anthropic" as const,
      block: { type: "thinking", thinking: "", signature: "sig-secret-verified" },
    }],
    providerBlockPositions: [0],
    totalPartCount: 1,
  };
  assertEquals(
    getServerResolvedProviderReplayCheckpoints({
      serverResolvedProviderReplayCheckpoints: [checkpoint],
    }, true),
    [checkpoint],
    "verified envelope delivers parsed checkpoints",
  );
  assertEquals(
    getServerResolvedProviderReplayCheckpoints({
      serverResolvedProviderReplayCheckpoints: [checkpoint],
    }, false),
    undefined,
    "unverified envelope never yields replay state",
  );
  assertEquals(
    getServerResolvedProviderReplayCheckpoints({}, true),
    undefined,
    "absent replay state resolves to undefined",
  );
  assertEquals(
    getServerResolvedProviderReplayCheckpoints(undefined, true),
    undefined,
    "absent forwarded props resolve to undefined",
  );
});

it("server-resolved provider replay checkpoints fail explicitly on forgery-shaped state", () => {
  const validBlock = {
    type: "provider-block" as const,
    provider: "anthropic" as const,
    block: { type: "thinking", thinking: "", signature: "sig-secret-forgery" },
  };
  const forgeries: unknown[] = [
    "not-an-array",
    [{ version: 1 }],
    [{
      version: 1,
      messageId: "assistant-message-1",
      provider: "anthropic",
      providerBlocks: [validBlock],
      providerBlockPositions: [0],
      totalPartCount: 1,
      injected: "extra",
    }],
    [{
      version: 1,
      messageId: "assistant-message-1",
      provider: "forged-provider",
      providerBlocks: [validBlock],
      providerBlockPositions: [0],
      totalPartCount: 1,
    }],
    [{
      version: 1,
      messageId: "assistant-message-1",
      provider: "anthropic",
      providerBlocks: [validBlock],
      providerBlockPositions: [1],
      totalPartCount: 1,
    }],
  ];
  for (const forgery of forgeries) {
    const error = assertThrows(() =>
      getServerResolvedProviderReplayCheckpoints({
        serverResolvedProviderReplayCheckpoints: forgery,
      }, true)
    );
    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "provider-replay-checkpoint-invalid", "registry slug");
    assertEquals(
      `${error.message}${JSON.stringify(error.context ?? {})}`.includes("sig-secret-forgery"),
      false,
      "rejection never echoes signed block material",
    );
  }
});

it("ordinary hosted request resolution ignores forwarded private tool exposure state", () => {
  const result = resolveHostedRuntimeRequestConfig({
    agentConfig: {
      model: "anthropic/claude-opus-4-6",
    },
    request: {
      forwardedProps: {
        serverResolvedToolExposureCheckpoint: {
          version: 1,
          loadedToolNames: ["delete_project"],
        },
      },
    },
    resolveModelId: (model) => model,
  });

  assertEquals(
    (result as unknown as Record<string, unknown>).serverResolvedToolExposureCheckpoint,
    undefined,
  );
  assertEquals(
    result.requestedAllowedTools,
    [],
    "an agent without configured tools must resolve to no allowed tools regardless of forwarded checkpoint",
  );
  assertEquals(
    result.requestedAllowedProviderTools,
    [],
    "forwarded checkpoint must not add provider tools",
  );
  assertEquals(
    result.includeRuntimeEssentialToolsWhenEmpty,
    true,
    "no runtime overrides were supplied",
  );
  assertEquals(
    JSON.stringify(result).includes("delete_project"),
    false,
    "forwarded private checkpoint must not influence any resolved field",
  );
});
import type { RuntimeAgentMarkdownDefinition } from "../runtime/agent-definition.ts";

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
  assertEquals(getForwardedHostedRuntimeOverrides({ maxOutputTokens: 1200 }), {
    maxOutputTokens: 1200,
  });
  assertEquals(
    getForwardedHostedRuntimeOverrides({ runtimeOverrides: { toolLoading: "eager" } }),
    undefined,
  );
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

describe("explicit hosted runtime tool denials", () => {
  it("resolveHostedRuntimeRequestConfig carries explicit tool denials through", () => {
    const result = resolveHostedRuntimeRequestConfig({
      request: { forwardedProps: {} },
      agentConfig: createAgentConfig({
        deniedTools: ["execute_skill_script", "load_skill", "load_skill_reference"],
      }),
      resolveModelId: (model) => model,
    });

    assertEquals(result.deniedToolNames, [
      "execute_skill_script",
      "load_skill",
      "load_skill_reference",
    ]);
  });

  it("resolveHostedRuntimeRequestConfig fails closed for tools true with denials", () => {
    const result = resolveHostedRuntimeRequestConfig({
      request: { forwardedProps: {} },
      agentConfig: createAgentConfig({
        tools: true,
        deniedTools: ["update_file"],
      }),
      resolveModelId: (model) => model,
    });

    assertEquals(result.requestedAllowedTools, []);
    assertEquals(result.includeRuntimeEssentialToolsWhenEmpty, false);
    assertEquals(result.deniedToolNames, ["update_file"]);
  });

  it("resolveHostedRuntimeRequestConfig resolves no denials when none are configured", () => {
    const result = resolveHostedRuntimeRequestConfig({
      request: { forwardedProps: {} },
      agentConfig: createAgentConfig(),
      resolveModelId: (model) => model,
    });

    assertEquals(result.deniedToolNames, undefined);
  });
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
    capabilities: [
      "ui_panels",
      "form_input",
      "media_display",
      "project_switching",
      "project.evals.read",
      "project.evals.write",
      "project.evals.run",
    ],
  });
});

Deno.test("resolveHostedRuntimeRequestConfig honors configured thinking before model defaults", () => {
  const resolveModelThinking = (model: string | undefined) =>
    model === "veryfront-cloud/anthropic/claude-sonnet-4-6"
      ? { enabled: true, budgetTokens: 2048 }
      : undefined;

  const disabledResult = resolveHostedRuntimeRequestConfig({
    request: {},
    agentConfig: createAgentConfig({
      model: "anthropic/claude-sonnet-4-6",
      thinking: { enabled: false },
    }),
    resolveModelId: (model) => model ? `veryfront-cloud/${model}` : undefined,
    resolveModelThinking,
  });

  assertEquals(disabledResult.requestedThinking, { enabled: false });

  const omittedResult = resolveHostedRuntimeRequestConfig({
    request: {},
    agentConfig: createAgentConfig({
      model: "anthropic/claude-sonnet-4-6",
      thinking: undefined,
    }),
    resolveModelId: (model) => model ? `veryfront-cloud/${model}` : undefined,
    resolveModelThinking,
  });

  assertEquals(omittedResult.requestedThinking, { enabled: true, budgetTokens: 2048 });
});

Deno.test("resolveHostedRuntimeRequestConfig uses forwarded overrides when request overrides are absent", () => {
  const result = resolveHostedRuntimeRequestConfig({
    request: {
      forwardedProps: {
        runtimeOverrides: {
          allowedTools: ["read_file"],
          maxSteps: 8,
        },
        maxOutputTokens: 1200,
      },
    },
    agentConfig: createAgentConfig({ maxSteps: 12 }),
    resolveModelId: (model) => model ? `veryfront-cloud/${model}` : undefined,
  });

  assertEquals(result.effectiveRuntimeOverrides, {
    allowedTools: ["read_file"],
    maxSteps: 8,
    maxOutputTokens: 1200,
  });
  assertEquals(result.requestedMaxSteps, 8);
  assertEquals(result.requestedMaxOutputTokens, 1200);
});

Deno.test("resolveHostedRuntimeRequestConfig defaults to configured agent tools", () => {
  const result = resolveHostedRuntimeRequestConfig({
    request: {},
    agentConfig: createAgentConfig({
      tools: ["get_agent", "get_agent_source", "update_agent"],
      delegates: ["writer"],
      providerTools: ["web_search"],
    }),
    resolveModelId: (model) => model,
  });

  assertEquals(result.requestedAllowedTools, [
    "get_agent",
    "get_agent_source",
    "update_agent",
    "agent_writer",
  ]);
  assertEquals(result.requestedAllowedProviderTools, ["web_search"]);
  assertEquals(result.includeRuntimeEssentialToolsWhenEmpty, true);
});

Deno.test("resolveHostedRuntimeRequestConfig only lets request tool overrides narrow configured tools", () => {
  const resolve = (allowedTools: string[]) => {
    const result = resolveHostedRuntimeRequestConfig({
      request: { runtimeOverrides: { allowedTools } },
      agentConfig: createAgentConfig({
        tools: ["get_agent", "update_agent"],
        providerTools: ["web_search"],
      }),
      resolveModelId: (model) => model,
    });
    assertEquals(
      result.requestedAllowedProviderTools,
      allowedTools.includes("web_search") ? ["web_search"] : [],
    );
    assertEquals(result.includeRuntimeEssentialToolsWhenEmpty, false);
    return result.requestedAllowedTools;
  };

  assertEquals(resolve(["unbound_tool", "update_agent", "web_search"]), [
    "update_agent",
  ]);
  assertEquals(resolve([]), []);
});

Deno.test("resolveHostedRuntimeRequestConfig preserves explicitly requested legacy delegation", () => {
  const resolve = (skills: boolean | string[] | undefined) =>
    resolveHostedRuntimeRequestConfig({
      request: {
        runtimeOverrides: { allowedTools: ["get_file", "invoke_agent"] },
      },
      agentConfig: createAgentConfig({
        tools: ["get_file"],
        skills,
      }),
      resolveModelId: (model) => model,
    }).requestedAllowedTools;

  assertEquals(resolve(["plan"]), ["get_file", "invoke_agent"]);
  assertEquals(resolve(true), ["get_file", "invoke_agent"]);
  assertEquals(resolve(undefined), ["get_file", "invoke_agent"]);
  assertEquals(resolve(false), ["get_file"]);
  assertEquals(resolve([]), ["get_file"]);
});

describe("resolveHostedRuntimeRequestConfig", () => {
  it("distinguishes unrestricted and omitted agent tools", () => {
    const resolve = (
      tools: RuntimeAgentMarkdownDefinition["tools"],
      providerTools?: string[],
    ) => {
      const result = resolveHostedRuntimeRequestConfig({
        request: {},
        agentConfig: createAgentConfig({ tools, providerTools }),
        resolveModelId: (model) => model,
      });
      return {
        tools: result.requestedAllowedTools,
        providerTools: result.requestedAllowedProviderTools,
        includeRuntimeEssentialToolsWhenEmpty: result.includeRuntimeEssentialToolsWhenEmpty,
      };
    };

    assertEquals(resolve(true), {
      tools: undefined,
      providerTools: [],
      includeRuntimeEssentialToolsWhenEmpty: true,
    });
    assertEquals(resolve(undefined), {
      tools: [],
      providerTools: [],
      includeRuntimeEssentialToolsWhenEmpty: true,
    });
    assertEquals(resolve(undefined, ["web_search"]), {
      tools: [],
      providerTools: ["web_search"],
      includeRuntimeEssentialToolsWhenEmpty: true,
    });
  });
});
