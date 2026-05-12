import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { type ModelRuntime, registerModelProvider } from "#veryfront/provider";
import { agent } from "./index.ts";
import type { ModelTransportRequest } from "./types.ts";

function createTextStream(parts: Array<{ type: "text-delta"; text: string } | { type: "finish" }>) {
  return new ReadableStream<unknown>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part);
      }
      controller.close();
    },
  });
}

describe("agent provider transport hooks", () => {
  it("lets hosts override the model runtime and transport options for generate()", async () => {
    const captured: {
      request?: ModelTransportRequest;
      generateOptions?: Record<string, unknown>;
    } = {};

    const transportModel: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/gateway-model",
      async doGenerate(options: unknown) {
        captured.generateOptions = options as Record<string, unknown>;
        return {
          content: [{ type: "text", text: "hooked generate" }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return { stream: createTextStream([{ type: "finish" }]) };
      },
    };

    const assistant = agent({
      model: "host/test-model",
      system: "You are a helpful assistant.",
      resolveModelTransport: async (request) => {
        captured.request = request;
        return {
          model: transportModel,
          headers: { Authorization: "Bearer vf_test" },
          providerOptions: {
            veryfront: {
              projectSlug: request.context?.projectSlug,
            },
          },
        };
      },
    });

    const result = await assistant.generate({
      input: "Hello",
      context: { projectSlug: "demo-project" },
    });

    assertEquals(result.text, "hooked generate");
    assertEquals(captured.request, {
      agentId: assistant.id,
      requestedModel: "host/test-model",
      resolvedModel: "host/test-model",
      context: { projectSlug: "demo-project" },
      mode: "generate",
    });

    assertExists(captured.generateOptions);
    assertEquals(
      new Headers(captured.generateOptions.headers as HeadersInit).get("Authorization"),
      "Bearer vf_test",
    );
    assertEquals(captured.generateOptions.providerOptions, {
      veryfront: { projectSlug: "demo-project" },
    });
  });

  it("lets hosts attach request-aware transport options while still using the registered provider runtime for stream()", async () => {
    const captured: {
      request?: ModelTransportRequest;
      streamOptions?: Record<string, unknown>;
    } = {};

    registerModelProvider("transport-stream-test", (_modelId) => ({
      provider: "transport-stream-test",
      modelId: "transport-stream-test/demo",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream(options: unknown) {
        captured.streamOptions = options as Record<string, unknown>;
        return {
          stream: createTextStream([
            { type: "text-delta", text: "streamed via provider hook" },
            { type: "finish" },
          ]),
        };
      },
    }));

    const assistant = agent({
      model: "transport-stream-test/demo",
      system: "You are a helpful assistant.",
      resolveModelTransport: async (request) => {
        captured.request = request;
        return {
          headers: { "x-veryfront-project": String(request.context?.projectSlug ?? "") },
          providerOptions: {
            gateway: {
              branchId: request.context?.branchId,
            },
          },
        };
      },
    });

    const response = (await assistant.stream({
      input: "Hello",
      context: { projectSlug: "demo-project", branchId: "branch_123" },
    })).toDataStreamResponse();
    const body = await response.text();

    assertStringIncludes(body, "streamed via provider hook");
    assertEquals(captured.request, {
      agentId: assistant.id,
      requestedModel: "transport-stream-test/demo",
      resolvedModel: "transport-stream-test/demo",
      context: { projectSlug: "demo-project", branchId: "branch_123" },
      mode: "stream",
    });

    assertExists(captured.streamOptions);
    assertEquals(
      new Headers(captured.streamOptions.headers as HeadersInit).get("x-veryfront-project"),
      "demo-project",
    );
    assertEquals(captured.streamOptions.providerOptions, {
      gateway: { branchId: "branch_123" },
    });
  });
});
