import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  getForwardedHostedModelId,
  getForwardedHostedRuntimeOverrides,
  getServerResolvedProviderReplayCheckpoints,
  getServerResolvedToolExposureCheckpoint,
  getServerResolvedToolSearchAuthorization,
  resolveHostedRuntimeRequestConfig,
  resolveHostedRuntimeThinkingOverride,
} from "./runtime-request-config.ts";

it("server-resolved provider replay checkpoints require verified envelope provenance", () => {
  const block = {
    type: "provider-block" as const,
    provider: "anthropic" as const,
    block: {
      type: "server_tool_use" as const,
      id: "srvtoolu_1",
      name: "tool_search",
      input: { query: "deploy" },
    },
  };
  const checkpoint = {
    version: 1 as const,
    messageId: "assistant-1",
    provider: "anthropic" as const,
    providerBlocks: [block],
    providerBlockPositions: [0],
    totalPartCount: 2,
  };
  assertEquals(
    getServerResolvedProviderReplayCheckpoints({
      serverResolvedProviderReplayCheckpoints: [checkpoint],
    }, true),
    [checkpoint],
  );
  assertEquals(
    getServerResolvedProviderReplayCheckpoints({
      serverResolvedProviderReplayCheckpoints: [{
        ...checkpoint,
        providerBlocks: [{ ...block, provider: "openai-responses" }],
      }],
    }, true),
    [],
  );
  assertEquals(
    getServerResolvedProviderReplayCheckpoints({
      serverResolvedProviderReplayCheckpoints: [checkpoint],
    }, false),
    [],
  );
});

it("server-resolved tool exposure checkpoint parses strictly and fails closed", () => {
  const checkpoint = {
    version: 1 as const,
    authorizedCatalogFingerprint: "v1-catalog",
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

it("server-resolved tool search authorization fails closed", () => {
  assertEquals(getServerResolvedToolSearchAuthorization(undefined, false), {
    canConfigureAgentTools: false,
    attachableCatalog: [],
  });
  assertEquals(
    getServerResolvedToolSearchAuthorization({
      serverResolvedToolSearchAuthorization: {
        canConfigureAgentTools: "true",
        attachableCatalog: [{ name: "list_agents", description: "List agents" }],
      },
    }, true),
    {
      canConfigureAgentTools: false,
      attachableCatalog: [],
    },
  );
});

it("server-resolved tool search authorization accepts compact trusted metadata", () => {
  assertEquals(
    getServerResolvedToolSearchAuthorization({
      serverResolvedToolSearchAuthorization: {
        canConfigureAgentTools: true,
        attachableCatalog: [{
          name: "list_agents",
          description: "List configured agents",
          attachVia: "tool_ids",
        }],
      },
    }, true),
    {
      canConfigureAgentTools: true,
      attachableCatalog: [{
        name: "list_agents",
        description: "List configured agents",
        attachVia: "tool_ids",
      }],
    },
  );
  assertEquals(
    getServerResolvedToolSearchAuthorization({
      serverResolvedToolSearchAuthorization: {
        canConfigureAgentTools: true,
        attachableCatalog: [{
          name: "list_agents",
          description: "List configured agents",
          attachVia: "tool_ids",
        }],
      },
    }, false),
    {
      canConfigureAgentTools: false,
      attachableCatalog: [],
    },
  );
});

it("ordinary hosted request resolution ignores forwarded tool search authorization", () => {
  const result = resolveHostedRuntimeRequestConfig({
    agentConfig: {
      model: "anthropic/claude-opus-4-6",
    },
    request: {
      forwardedProps: {
        serverResolvedToolSearchAuthorization: {
          canConfigureAgentTools: true,
          attachableCatalog: [{
            name: "list_agents",
            description: "List configured agents",
            attachVia: "tool_ids",
          }],
        },
        serverResolvedToolExposureCheckpoint: {
          version: 1,
          authorizedCatalogFingerprint: "client-spoof",
          loadedToolNames: ["delete_project"],
        },
      },
    },
    resolveModelId: (model) => model,
  });

  assertEquals(
    (result as unknown as Record<string, unknown>).serverResolvedToolSearchAuthorization,
    undefined,
  );
  assertEquals(
    (result as unknown as Record<string, unknown>).serverResolvedToolExposureCheckpoint,
    undefined,
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

Deno.test("resolveHostedRuntimeRequestConfig distinguishes unrestricted and omitted agent tools", () => {
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
