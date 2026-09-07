import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { agent } from "#veryfront/agent/index.ts";
import { tool } from "#veryfront/tool";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import { createExecutorChannel } from "#veryfront/agent/executor/channel.ts";
import {
  createExecutorModelBroker,
  createExecutorModelRuntimeResolver,
} from "#veryfront/agent/hosted/executor-model-bridge.ts";
import { reconcileGoogleProviderMetadata } from "../../../extensions/ext-llm-google/src/google-thought-signatures.ts";

it("preserves surviving Gemini signatures through remote reconciliation and the next model call", async () => {
  const suppressed = {
    functionCall: { id: "stale-1", name: "missing_tool", args: {} },
    thoughtSignature: "synthetic-suppressed-signature",
  };
  const surviving = {
    functionCall: { id: "lookup-1", name: "lookup", args: { query: "Synthetic" } },
    thoughtSignature: "synthetic-surviving-signature",
  };
  const providerMetadata = { google: { rawAssistantParts: [suppressed, surviving] } };
  const model = scriptedModel([
    {
      toolCalls: [
        { id: "stale-1", name: "missing_tool", input: {} },
        { id: "lookup-1", name: "lookup", input: { query: "Synthetic" } },
      ],
      providerMetadata,
    },
    { text: "Done" },
  ], {
    provider: "google",
    modelId: "gemini-3.5-flash",
    only: "stream",
    reconcileProviderMetadata: ({ providerMetadata, suppressedToolCalls }) =>
      reconcileGoogleProviderMetadata(providerMetadata, suppressedToolCalls),
  });
  const modelId = "veryfront-cloud/google/gemini-3.5-flash";
  const allowedModelIds = new Set([modelId]);
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
    operations: createExecutorModelBroker({ allowedModelIds, resolveModelRuntime: () => model }),
  });
  try {
    const resolve = await createExecutorModelRuntimeResolver({ channel: caller, allowedModelIds });
    const assistant = agent({
      model: modelId,
      system: "Use the lookup tool.",
      tools: {
        lookup: tool({
          id: "lookup",
          description: "Look up a synthetic value",
          inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
          execute: ({ query }) => ({ value: query }),
        }),
      },
      maxSteps: 2,
      resolveModelTransport: () => ({ model: resolve(modelId)! }),
    });
    const body = await (await assistant.stream({ input: "Look up the synthetic value" }))
      .toDataStreamResponse().text();
    assertEquals(model.callCount, 2, body);
    const continuation = model.calls[1]?.prompt.find((message) => message.role === "assistant");
    assertEquals(continuation?.providerMetadata, {
      google: { rawAssistantParts: [surviving], rawAssistantPartIndexes: [1] },
    });
    assertStringIncludes(body, "Done");
    assertEquals(body.includes("synthetic-surviving-signature"), false);
  } finally {
    caller.close();
    await broker.closed;
  }
});
