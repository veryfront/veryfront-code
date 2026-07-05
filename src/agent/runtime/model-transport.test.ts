import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime } from "#veryfront/provider";
import type { AgentConfig, ModelTransportRequest } from "../types.ts";
import { resolveAgentModelTransport } from "./model-transport.ts";

function createModel(modelId: string): ModelRuntime {
  return {
    provider: "test",
    modelId,
    async doGenerate() {
      return {
        content: [],
        finishReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    },
    async doStream() {
      return { stream: new ReadableStream<unknown>() };
    },
  };
}

describe("resolveAgentModelTransport", () => {
  it("resolves the configured runtime model when no host transport hook is present", async () => {
    const config: AgentConfig = {
      model: "local/qwen3.5-0.8b",
      system: "You are a helpful assistant.",
    };

    const transport = await resolveAgentModelTransport({
      agentId: "agent-1",
      config,
      context: undefined,
      mode: "generate",
      modelOverride: undefined,
    });

    assertEquals(transport.requestedModel, "local/qwen3.5-0.8b");
    assertEquals(transport.resolvedModelString, "local/qwen3.5-0.8b");
    assertEquals(transport.languageModel.modelId, "local/qwen3.5-0.8b");
  });

  it("lets the host override model runtime, headers, provider options, and reasoning", async () => {
    const hostModel = createModel("hosted/gateway-model");
    let capturedRequest: ModelTransportRequest | undefined;
    const config: AgentConfig = {
      model: "host/default-model",
      system: "You are a helpful assistant.",
      resolveModelTransport: (request: ModelTransportRequest) => {
        capturedRequest = request;
        return {
          model: hostModel,
          headers: { Authorization: "Bearer vf_test" },
          providerOptions: { veryfront: { projectSlug: request.context?.projectSlug } },
          reasoning: { enabled: false },
        };
      },
    };

    const transport = await resolveAgentModelTransport({
      agentId: "agent-1",
      config,
      context: { projectSlug: "demo-project" },
      mode: "stream",
      modelOverride: "host/override-model",
    });

    assertEquals(capturedRequest, {
      agentId: "agent-1",
      requestedModel: "host/override-model",
      resolvedModel: "host/override-model",
      context: { projectSlug: "demo-project" },
      mode: "stream",
    });
    assertStrictEquals(transport.languageModel, hostModel);
    assertEquals(new Headers(transport.headers).get("Authorization"), "Bearer vf_test");
    assertEquals(transport.providerOptions, { veryfront: { projectSlug: "demo-project" } });
    assertEquals((transport as { reasoning?: unknown }).reasoning, { enabled: false });
  });

  it("defaults reasoning for non-Anthropic thinking-capable Veryfront Cloud models", async () => {
    const hostModel = createModel("veryfront-cloud/google-ai-studio/gemini-2.5-pro");
    const config: AgentConfig = {
      model: "veryfront-cloud/google-ai-studio/gemini-2.5-pro",
      system: "You are a helpful assistant.",
      resolveModelTransport: () => ({ model: hostModel }),
    };

    const transport = await resolveAgentModelTransport({
      agentId: "agent-1",
      config,
      context: undefined,
      mode: "stream",
      modelOverride: undefined,
    });

    assertEquals((transport as { reasoning?: unknown }).reasoning, { enabled: true });
  });

  it("preserves provider option thinking opt-outs over Veryfront Cloud reasoning defaults", async () => {
    const hostModel = createModel("veryfront-cloud/moonshotai/kimi-k2.6");
    const providerOptions = { openai: { thinking: { type: "disabled" } } };
    const config: AgentConfig = {
      model: "veryfront-cloud/moonshotai/kimi-k2.6",
      system: "You are a helpful assistant.",
      resolveModelTransport: () => ({ model: hostModel, providerOptions }),
    };

    const transport = await resolveAgentModelTransport({
      agentId: "agent-1",
      config,
      context: undefined,
      mode: "stream",
      modelOverride: undefined,
    });

    assertEquals(transport.providerOptions, providerOptions);
    assertEquals(transport.reasoning, { enabled: false });
  });
});
