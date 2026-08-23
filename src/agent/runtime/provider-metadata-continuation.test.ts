import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool } from "#veryfront/tool";
import { agent } from "../index.ts";
import type { AgentRunModelCallContextEvent } from "../../runtime/model-call-context.ts";
import { runWithRunEventSink } from "../../runtime/run-event-sink-context.ts";
import { createGoogleModelRuntime } from "../../../extensions/ext-llm-google/src/google-provider.ts";
import { reconcileGoogleProviderMetadata } from "../../../extensions/ext-llm-google/src/google-thought-signatures.ts";
import { scriptedModel } from "./model-runtime.test-helpers.ts";

function readRequestBody(init: unknown): string {
  return String((init as { body?: unknown } | undefined)?.body);
}

const providerMetadata = {
  google: {
    rawAssistantParts: [{
      functionCall: {
        id: "lookup-1",
        name: "lookup",
        args: { query: "Veryfront" },
      },
      thoughtSignature: "test-thought-signature",
    }],
  },
};

function createLookupTool() {
  return tool({
    id: "lookup",
    description: "Look up a test value",
    inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
    execute: ({ query }) => ({ value: query }),
  });
}

function readAssistantProviderMetadata(options: unknown): unknown {
  const prompt = (options as { prompt?: Array<Record<string, unknown>> }).prompt ?? [];
  return prompt.find((message) => message.role === "assistant")?.providerMetadata;
}

function readAllAssistantProviderMetadata(options: unknown): unknown[] {
  const prompt = (options as { prompt?: Array<Record<string, unknown>> }).prompt ?? [];
  return prompt.filter((message) => message.role === "assistant").map((message) =>
    message.providerMetadata
  );
}

async function withStreamLifecycleMode(
  mode: "legacy" | "active",
  operation: () => Promise<void>,
): Promise<void> {
  const previousMode = Deno.env.get("VF_STREAM_LIFECYCLE_MODE");
  Deno.env.set("VF_STREAM_LIFECYCLE_MODE", mode);
  try {
    await operation();
  } finally {
    if (previousMode === undefined) Deno.env.delete("VF_STREAM_LIFECYCLE_MODE");
    else Deno.env.set("VF_STREAM_LIFECYCLE_MODE", previousMode);
  }
}

describe("agent provider metadata continuation", () => {
  it("replays generate provider metadata on the tool-result leg", async () => {
    const modelCallEvents: AgentRunModelCallContextEvent[] = [];
    const model = scriptedModel([
      {
        toolCalls: [{ id: "lookup-1", name: "lookup", input: '{"query":"Veryfront"}' }],
        providerMetadata,
      },
      { text: "Done" },
    ], { provider: "google", modelId: "gemini-3.5-flash", only: "generate" });
    const assistant = agent({
      model: "google/gemini-3.5-flash",
      system: "Use the lookup tool.",
      tools: { lookup: createLookupTool() },
      maxSteps: 2,
      resolveModelTransport: () => ({ model }),
    });

    const result = await runWithRunEventSink(
      (event) => {
        modelCallEvents.push(event as AgentRunModelCallContextEvent);
      },
      () => assistant.generate({ input: "Look up Veryfront" }),
    );

    assertEquals(result.text, "Done");
    assertEquals(model.callCount, 2);
    assertEquals(readAssistantProviderMetadata(model.calls[1]), providerMetadata);
    assertEquals(JSON.stringify(result.messages).includes("test-thought-signature"), false);
    assertEquals(JSON.stringify(modelCallEvents).includes("test-thought-signature"), false);
  });

  it("replays every signed function call throughout a sequential tool turn", async () => {
    const secondProviderMetadata = {
      google: {
        rawAssistantParts: [{
          functionCall: {
            id: "lookup-2",
            name: "lookup",
            args: { query: "Gemini" },
          },
          thoughtSignature: "test-thought-signature-2",
        }],
      },
    };
    const model = scriptedModel([
      {
        toolCalls: [{ id: "lookup-1", name: "lookup", input: '{"query":"Veryfront"}' }],
        providerMetadata,
      },
      {
        toolCalls: [{ id: "lookup-2", name: "lookup", input: '{"query":"Gemini"}' }],
        providerMetadata: secondProviderMetadata,
      },
      { text: "Done" },
    ], { provider: "google", modelId: "gemini-3.5-flash", only: "generate" });
    const assistant = agent({
      model: "google/gemini-3.5-flash",
      system: "Use the lookup tool twice.",
      tools: { lookup: createLookupTool() },
      maxSteps: 3,
      resolveModelTransport: () => ({ model }),
    });

    const result = await assistant.generate({ input: "Look up Veryfront and Gemini" });

    assertEquals(result.text, "Done");
    assertEquals(model.callCount, 3);
    assertEquals(readAllAssistantProviderMetadata(model.calls[1]), [providerMetadata]);
    assertEquals(
      readAllAssistantProviderMetadata(model.calls[2]),
      [providerMetadata, secondProviderMetadata],
    );
    assertEquals(JSON.stringify(result.messages).includes("test-thought-signature"), false);
  });

  for (const lifecycleMode of ["legacy", "active"] as const) {
    it(`replays streamed provider metadata through the ${lifecycleMode} lifecycle`, () =>
      withStreamLifecycleMode(lifecycleMode, async () => {
        const model = scriptedModel([
          {
            toolCalls: [{ id: "lookup-1", name: "lookup", input: '{"query":"Veryfront"}' }],
            providerMetadata,
          },
          { text: "Done" },
        ], { provider: "google", modelId: "gemini-3.5-flash", only: "stream" });
        const assistant = agent({
          model: "google/gemini-3.5-flash",
          system: "Use the lookup tool.",
          tools: { lookup: createLookupTool() },
          maxSteps: 2,
          resolveModelTransport: () => ({ model }),
        });

        const body = await (await assistant.stream({ input: "Look up Veryfront" }))
          .toDataStreamResponse()
          .text();

        assertEquals(model.callCount, 2);
        assertEquals(readAssistantProviderMetadata(model.calls[1]), providerMetadata);
        // The mistyped `{ delta: "Done" }` part this fake used to emit was
        // silently dropped by the active lifecycle decoder; the typed helper
        // emits `{ text: "Done" }`, so the reply must now reach the client.
        assertStringIncludes(body, "Done");
        assertEquals(body.includes("test-thought-signature"), false);
      }));
  }

  it("replays the exact signed Gemini tool call before its function response", async () => {
    const encoder = new TextEncoder();
    const rawAssistantParts = [{
      functionCall: {
        id: "lookup-1",
        name: "lookup",
        args: { query: "Veryfront" },
      },
      thoughtSignature: "test-thought-signature",
    }];
    const requestBodies: Array<Record<string, unknown>> = [];
    const googleRuntime = createGoogleModelRuntime({
      apiKey: "test-google-key",
      baseURL: "https://example.google.test/v1beta",
      fetch: (_input, init) => {
        requestBodies.push(JSON.parse(readRequestBody(init)) as Record<string, unknown>);
        const responseParts = requestBodies.length === 1
          ? [
            encoder.encode(
              `data: ${
                JSON.stringify({
                  candidates: [{ content: { role: "model", parts: rawAssistantParts } }],
                })
              }\n\n`,
            ),
            encoder.encode(
              'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1,"totalTokenCount":2}}\n\n',
            ),
          ]
          : [
            encoder.encode(
              'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Done"}]}}]}\n\n',
            ),
            encoder.encode(
              'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":1,"totalTokenCount":3}}\n\n',
            ),
          ];
        return Promise.resolve(
          new Response(
            ReadableStream.from([...responseParts, encoder.encode("data: [DONE]\n\n")]),
            { status: 200, headers: { "content-type": "text/event-stream" } },
          ),
        );
      },
    }, "gemini-3.5-flash");
    const assistant = agent({
      model: "google/gemini-3.5-flash",
      system: "Use the lookup tool.",
      tools: { lookup: createLookupTool() },
      maxSteps: 2,
      resolveModelTransport: () => ({ model: googleRuntime }),
    });

    const body = await (await assistant.stream({ input: "Look up Veryfront" }))
      .toDataStreamResponse()
      .text();

    assertStringIncludes(body, "Done");
    assertEquals(body.includes("test-thought-signature"), false);
    assertEquals(requestBodies.length, 2);
    const continuationContents = requestBodies[1]?.contents as unknown[] | undefined;
    assertEquals(continuationContents?.slice(-2), [
      { role: "model", parts: rawAssistantParts },
      {
        role: "user",
        parts: [{
          functionResponse: {
            id: "lookup-1",
            name: "lookup",
            response: { result: { value: "Veryfront" } },
          },
        }],
      },
    ]);
  });

  it("asks the model runtime to reconcile metadata after suppressing a tool call", async () => {
    let reconciledSuppressions: unknown;
    const model = scriptedModel([
      {
        toolCalls: [
          { id: "stale-1", name: "missing_tool", input: '{"query":"stale"}' },
          { id: "lookup-1", name: "lookup", input: '{"query":"Veryfront"}' },
        ],
        providerMetadata,
      },
      { text: "Done" },
    ], {
      provider: "google",
      modelId: "gemini-3.5-flash",
      only: "stream",
      properties: {
        _reconcileProviderMetadata({ providerMetadata: metadata, suppressedToolCalls }: {
          providerMetadata: Record<string, unknown>;
          suppressedToolCalls: readonly { id: string; name: string }[];
        }) {
          reconciledSuppressions = suppressedToolCalls;
          return metadata;
        },
      },
    });
    const assistant = agent({
      model: "google/gemini-3.5-flash",
      system: "Use the lookup tool.",
      tools: { lookup: createLookupTool() },
      maxSteps: 2,
      resolveModelTransport: () => ({ model }),
    });

    const body = await (await assistant.stream({ input: "Look up Veryfront" }))
      .toDataStreamResponse()
      .text();

    assertEquals(model.callCount, 2);
    assertEquals(reconciledSuppressions, [{ id: "stale-1", name: "missing_tool" }]);
    assertEquals(readAssistantProviderMetadata(model.calls[1]), providerMetadata);
    // Previously unasserted: the fake's mistyped `delta:` reply never reached
    // the stream; the typed helper makes the reply observable.
    assertStringIncludes(body, "Done");
    assertEquals(body.includes("test-thought-signature"), false);
  });

  it("falls back to synthesized replay for runtimes without a metadata reconciler", async () => {
    const model = scriptedModel([
      {
        toolCalls: [
          { id: "stale-1", name: "missing_tool", input: '{"query":"stale"}' },
          { id: "lookup-1", name: "lookup", input: '{"query":"Veryfront"}' },
        ],
        providerMetadata,
      },
      { text: "Done" },
    ], { provider: "custom", modelId: "custom-model", only: "stream" });
    const assistant = agent({
      model: "custom/custom-model",
      system: "Use the lookup tool.",
      tools: { lookup: createLookupTool() },
      maxSteps: 2,
      resolveModelTransport: () => ({ model }),
    });

    const body = await (await assistant.stream({ input: "Look up Veryfront" }))
      .toDataStreamResponse()
      .text();

    assertStringIncludes(body, "Done");
    assertEquals(model.callCount, 2);
    assertEquals(readAssistantProviderMetadata(model.calls[1]), undefined);
  });

  it("preserves the signed surviving Gemini call after suppressing an unavailable call", async () => {
    const encoder = new TextEncoder();
    const staleRawPart = {
      functionCall: {
        id: "stale-1",
        name: "missing_tool",
        args: { query: "stale" },
      },
      thoughtSignature: "stale-thought-signature",
    };
    const survivingRawPart = {
      functionCall: {
        id: "lookup-1",
        name: "lookup",
        args: { query: "Veryfront" },
      },
      thoughtSignature: "surviving-thought-signature",
    };
    const requestBodies: Array<Record<string, unknown>> = [];
    const googleRuntime = createGoogleModelRuntime({
      apiKey: "test-google-key",
      baseURL: "https://example.google.test/v1beta",
      fetch: (_input, init) => {
        requestBodies.push(JSON.parse(readRequestBody(init)) as Record<string, unknown>);
        const responseParts = requestBodies.length === 1
          ? [
            encoder.encode(
              `data: ${
                JSON.stringify({
                  candidates: [{
                    content: { role: "model", parts: [staleRawPart, survivingRawPart] },
                  }],
                })
              }\n\n`,
            ),
            encoder.encode(
              'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1,"totalTokenCount":2}}\n\n',
            ),
          ]
          : [
            encoder.encode(
              'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Done"}]}}]}\n\n',
            ),
            encoder.encode(
              'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":1,"totalTokenCount":3}}\n\n',
            ),
          ];
        return Promise.resolve(
          new Response(
            ReadableStream.from([...responseParts, encoder.encode("data: [DONE]\n\n")]),
            { status: 200, headers: { "content-type": "text/event-stream" } },
          ),
        );
      },
    }, "gemini-3.5-flash");
    const assistant = agent({
      model: "google/gemini-3.5-flash",
      system: "Use the lookup tool.",
      tools: { lookup: createLookupTool() },
      maxSteps: 2,
      resolveModelTransport: () => ({ model: googleRuntime }),
    });

    const body = await (await assistant.stream({ input: "Look up Veryfront" }))
      .toDataStreamResponse()
      .text();

    assertStringIncludes(body, "Done");
    assertEquals(requestBodies.length, 2);
    const continuationContents = requestBodies[1]?.contents as Array<{
      role?: string;
      parts?: unknown[];
    }>;
    const replayedAssistant = continuationContents.find((content) =>
      content.role === "model" && JSON.stringify(content.parts).includes("lookup-1")
    );
    assertEquals(replayedAssistant?.parts, [survivingRawPart]);
    assertEquals(JSON.stringify(continuationContents).includes("stale-1"), false);
  });

  it("preserves signed Gemini reasoning when every tool call is suppressed", async () => {
    const signedThoughtPart = {
      text: "Private reasoning.",
      thought: true,
      thoughtSignature: "surviving-thought-signature",
    };
    const staleRawPart = {
      functionCall: {
        id: "stale-1",
        name: "missing_tool",
        args: { query: "stale" },
      },
      thoughtSignature: "stale-thought-signature",
    };
    const signedProviderMetadata = {
      google: { rawAssistantParts: [signedThoughtPart, staleRawPart] },
    };
    const model = scriptedModel([
      {
        parts: [
          { type: "reasoning-start", id: "reasoning-0" },
          {
            type: "reasoning-delta",
            id: "reasoning-0",
            delta: "Private reasoning.",
          },
          {
            type: "reasoning-end",
            id: "reasoning-0",
            signature: "surviving-thought-signature",
          },
          {
            type: "tool-call",
            toolCallId: "stale-1",
            toolName: "missing_tool",
            input: '{"query":"stale"}',
          },
          {
            type: "finish",
            finishReason: "tool-calls",
            totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            providerMetadata: signedProviderMetadata,
          },
        ],
      },
      { text: "Done" },
    ], {
      provider: "google",
      modelId: "gemini-3.5-flash",
      only: "stream",
      properties: {
        _reconcileProviderMetadata({ providerMetadata, suppressedToolCalls }: {
          providerMetadata: Record<string, unknown>;
          suppressedToolCalls: readonly { id: string; name: string }[];
        }) {
          return reconcileGoogleProviderMetadata(providerMetadata, suppressedToolCalls);
        },
      },
    });
    const assistant = agent({
      model: "google/gemini-3.5-flash",
      system: "Use the lookup tool.",
      tools: { lookup: createLookupTool() },
      maxSteps: 2,
      resolveModelTransport: () => ({ model }),
    });

    const body = await (await assistant.stream({ input: "Look up Veryfront" }))
      .toDataStreamResponse()
      .text();

    assertStringIncludes(body, "Done");
    assertEquals(model.callCount, 2);
    assertEquals(readAssistantProviderMetadata(model.calls[1]), {
      google: {
        rawAssistantParts: [signedThoughtPart],
        rawAssistantPartIndexes: [0],
      },
    });
  });

  // Wire shape modelled on a real gemini-3.1-pro-preview streamGenerateContent
  // response: the signature rides the functionCall part in the first chunk, and
  // a trailing empty-text part arrives in a separate chunk alongside the finish
  // reason. Gemini 3.x rejects the tool-result leg with HTTP 400 "Function call
  // is missing a thought_signature in functionCall parts" unless that exact
  // model turn is replayed, while 2.5 accepts an unsigned replay. The signature
  // itself is opaque to the replay path, so this fixture carries a fabricated
  // placeholder rather than a captured provider value.
  it("replays a Gemini 3.x signed tool call in the live wire shape", async () => {
    const encoder = new TextEncoder();
    const signedFunctionCallPart = {
      functionCall: {
        name: "lookup",
        args: { query: "Veryfront" },
        id: "call_2874307",
      },
      thoughtSignature: "dGVzdC1nZW1pbmktMy10aG91Z2h0LXNpZ25hdHVyZS1wbGFjZWhvbGRlcg==",
    };
    const requestBodies: Array<Record<string, unknown>> = [];
    const googleRuntime = createGoogleModelRuntime({
      apiKey: "test-google-key",
      baseURL: "https://example.google.test/v1beta",
      fetch: (_input, init) => {
        requestBodies.push(JSON.parse(readRequestBody(init)) as Record<string, unknown>);
        const responseParts = requestBodies.length === 1
          ? [
            encoder.encode(
              `data: ${
                JSON.stringify({
                  candidates: [{
                    content: { parts: [signedFunctionCallPart], role: "model" },
                    index: 0,
                  }],
                  usageMetadata: {
                    promptTokenCount: 57,
                    candidatesTokenCount: 16,
                    totalTokenCount: 165,
                    thoughtsTokenCount: 92,
                  },
                  modelVersion: "gemini-3.1-pro-preview",
                })
              }\n\n`,
            ),
            encoder.encode(
              `data: ${
                JSON.stringify({
                  candidates: [{
                    content: { parts: [{ text: "" }], role: "model" },
                    finishReason: "STOP",
                    index: 0,
                  }],
                  usageMetadata: {
                    promptTokenCount: 57,
                    candidatesTokenCount: 16,
                    totalTokenCount: 165,
                  },
                })
              }\n\n`,
            ),
          ]
          : [
            encoder.encode(
              'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Done"}]}}]}\n\n',
            ),
            encoder.encode(
              'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":1,"totalTokenCount":3}}\n\n',
            ),
          ];
        return Promise.resolve(
          new Response(
            ReadableStream.from([...responseParts, encoder.encode("data: [DONE]\n\n")]),
            { status: 200, headers: { "content-type": "text/event-stream" } },
          ),
        );
      },
    }, "gemini-3.1-pro-preview");
    const assistant = agent({
      model: "google/gemini-3.1-pro-preview",
      system: "Use the lookup tool.",
      tools: { lookup: createLookupTool() },
      maxSteps: 2,
      resolveModelTransport: () => ({ model: googleRuntime }),
    });

    const body = await (await assistant.stream({ input: "Look up Veryfront" }))
      .toDataStreamResponse().text();

    assertStringIncludes(body, "Done");
    assertEquals(requestBodies.length, 2);
    // The signature must never surface in the client-facing stream.
    assertEquals(body.includes(signedFunctionCallPart.thoughtSignature), false);
    // The tool-result leg must carry the signed model turn verbatim, trailing
    // empty-text part included, which is what the live API accepts.
    const continuationContents = requestBodies[1]?.contents as unknown[] | undefined;
    assertEquals(continuationContents?.slice(-2), [
      { role: "model", parts: [signedFunctionCallPart, { text: "" }] },
      {
        role: "user",
        parts: [{
          functionResponse: {
            id: "call_2874307",
            name: "lookup",
            response: { result: { value: "Veryfront" } },
          },
        }],
      },
    ]);
  });
});
