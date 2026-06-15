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
    const config = {
      model: "local/smollm2-135m",
      system: "You are a helpful assistant.",
    } as AgentConfig;

    const transport = await resolveAgentModelTransport({
      agentId: "agent-1",
      config,
      context: undefined,
      mode: "generate",
      modelOverride: undefined,
    });

    assertEquals(transport.requestedModel, "local/smollm2-135m");
    assertEquals(transport.resolvedModelString, "local/smollm2-135m");
    assertEquals(transport.languageModel.modelId, "local/smollm2-135m");
  });

  it("lets the host override model runtime, headers, and provider options", async () => {
    const hostModel = createModel("hosted/gateway-model");
    let capturedRequest: ModelTransportRequest | undefined;
    const config = {
      model: "host/default-model",
      system: "You are a helpful assistant.",
      resolveModelTransport: (request: ModelTransportRequest) => {
        capturedRequest = request;
        return {
          model: hostModel,
          headers: { Authorization: "Bearer vf_test" },
          providerOptions: { veryfront: { projectSlug: request.context?.projectSlug } },
        };
      },
    } as AgentConfig;

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
  });
});
