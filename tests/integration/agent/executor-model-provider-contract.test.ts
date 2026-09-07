import "#veryfront/schemas/_test-setup.ts";
import { createAnthropicProviderModel } from "@veryfront/ext-llm-anthropic";
import { createGoogleProviderModel } from "@veryfront/ext-llm-google";
import { observeFetchRequestInit, withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import {
  createExecutorChannel,
  type ExecutorOperation,
} from "#veryfront/agent/executor/channel.ts";
import {
  createExecutorModelBroker,
  createExecutorModelRuntimeResolver,
} from "#veryfront/agent/hosted/executor-model-bridge.ts";

const prompt: ModelRuntimeCallOptions["prompt"] = [{
  role: "user",
  content: [{ type: "text", text: "Synthetic prompt" }],
}];

function pair(operations: ReadonlyMap<string, ExecutorOperation>) {
  const forward = new TransformStream<Uint8Array, Uint8Array>();
  const backward = new TransformStream<Uint8Array, Uint8Array>();
  const binding = {
    allocationId: "allocation-test",
    generation: 1,
    invocationId: "invocation-test",
  };
  const caller = createExecutorChannel({
    binding,
    transport: { readable: backward.readable, writable: forward.writable },
  });
  const broker = createExecutorChannel({
    binding,
    transport: { readable: forward.readable, writable: backward.writable },
    operations,
  });
  return {
    caller,
    async close() {
      caller.close();
      await broker.closed;
    },
  };
}

describe("executor model provider contracts", () => {
  it("keeps the allowed model pinned through the first-party Anthropic request builder", async () => {
    const allowedId = "veryfront-cloud/anthropic/claude-haiku-4-5";
    const allowedIds = new Set([allowedId]);
    const requestedModels: unknown[] = [];
    const mockFetch: typeof fetch = (_input, init) => {
      const { body } = observeFetchRequestInit(init);
      assert(typeof body === "string");
      requestedModels.push(JSON.parse(body).model);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: "Synthetic answer" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    };
    await withMockFetch(mockFetch, async () => {
      const model = createAnthropicProviderModel("claude-haiku-4-5", {
        credential: "<TOKEN>",
        name: "veryfront-cloud",
        baseURL: "https://example.com/v1",
        fetch: mockFetch,
      });
      const channels = pair(
        createExecutorModelBroker({
          allowedModelIds: allowedIds,
          resolveModelRuntime: () => model,
        }),
      );
      try {
        const resolver = await createExecutorModelRuntimeResolver({
          channel: channels.caller,
          allowedModelIds: allowedIds,
        });
        const proxy = resolver(allowedId)!;
        const result = await proxy.doGenerate({
          prompt,
          maxOutputTokens: 10,
          providerOptions: { anthropic: { temperature: 0.2 } },
        });
        assertEquals(result.content, [{ type: "text", text: "Synthetic answer" }]);
        assertEquals(requestedModels, ["claude-haiku-4-5"]);
        for (const bucket of ["anthropic", "veryfront-cloud"]) {
          await assertRejects(
            () =>
              channels.caller.request("model.generate", {
                modelId: allowedId,
                options: { prompt, providerOptions: { [bucket]: { model: "claude-opus-4-6" } } },
              } as unknown as JsonValue),
            Error,
            "operation-failed",
          );
          await assertRejects(
            async () =>
              await proxy.doGenerate({
                prompt,
                providerOptions: { [bucket]: { model: "claude-opus-4-6" } },
              }),
            TypeError,
          );
        }
        assertEquals(requestedModels, ["claude-haiku-4-5"]);
      } finally {
        await channels.close();
      }
    });
  });

  it("preserves schema property names through the first-party Google request builder", async () => {
    const allowedId = "veryfront-cloud/google/gemini-synthetic";
    const allowedIds = new Set([allowedId]);
    const responseSchema = {
      type: "OBJECT",
      properties: {
        url: { type: "STRING" },
        auth: { type: "STRING" },
        model: { type: "STRING" },
        headers: { type: "STRING" },
      },
    };
    const schemas: unknown[] = [];
    const mockFetch: typeof fetch = (_input, init) => {
      const { body } = observeFetchRequestInit(init);
      assert(typeof body === "string");
      schemas.push(JSON.parse(body).generationConfig.responseSchema);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [{
              content: { parts: [{ text: "Synthetic answer" }] },
              finishReason: "STOP",
            }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    };
    await withMockFetch(mockFetch, async () => {
      const model = createGoogleProviderModel("gemini-synthetic", {
        credential: "<TOKEN>",
        name: "veryfront-cloud",
        baseURL: "https://example.com/v1",
        fetch: mockFetch,
      });
      const channels = pair(
        createExecutorModelBroker({
          allowedModelIds: allowedIds,
          resolveModelRuntime: () => model,
        }),
      );
      try {
        const resolver = await createExecutorModelRuntimeResolver({
          channel: channels.caller,
          allowedModelIds: allowedIds,
        });
        const proxy = resolver(allowedId)!;
        await proxy.doGenerate({
          prompt,
          providerOptions: {
            google: { generationConfig: { responseMimeType: "application/json", responseSchema } },
          },
        });
        assertEquals(schemas, [responseSchema]);
        for (const field of ["url", "auth", "model", "headers"]) {
          await assertRejects(
            () =>
              channels.caller.request("model.generate", {
                modelId: allowedId,
                options: { prompt, providerOptions: { google: { [field]: "synthetic-override" } } },
              } as unknown as JsonValue),
            Error,
            "operation-failed",
          );
        }
        assertEquals(schemas, [responseSchema]);
      } finally {
        await channels.close();
      }
    });
  });
});
