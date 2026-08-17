import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime } from "#veryfront/provider";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool } from "#veryfront/tool";
import { agent } from "../index.ts";
import type { AgentRunModelCallContextEvent } from "../../runtime/model-call-context.ts";
import { runWithRunEventSink } from "../../runtime/run-event-sink-context.ts";
import { createGoogleModelRuntime } from "../../../extensions/ext-llm-google/src/google-provider.ts";

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

function streamFrom(parts: unknown[]): ReadableStream<unknown> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
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
    let callCount = 0;
    let continuedProviderMetadata: unknown;
    const modelCallEvents: AgentRunModelCallContextEvent[] = [];
    const model: ModelRuntime = {
      provider: "google",
      modelId: "gemini-3.5-flash",
      async doGenerate(options: unknown) {
        callCount++;
        if (callCount === 1) {
          return {
            content: [{
              type: "tool-call",
              toolCallId: "lookup-1",
              toolName: "lookup",
              input: '{"query":"Veryfront"}',
            }],
            finishReason: "tool-calls",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            providerMetadata,
          };
        }

        continuedProviderMetadata = readAssistantProviderMetadata(options);
        return {
          content: [{ type: "text", text: "Done" }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        throw new Error("not used");
      },
    };
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
    assertEquals(callCount, 2);
    assertEquals(continuedProviderMetadata, providerMetadata);
    assertEquals(JSON.stringify(result.messages).includes("test-thought-signature"), false);
    assertEquals(JSON.stringify(modelCallEvents).includes("test-thought-signature"), false);
  });

  for (const lifecycleMode of ["legacy", "active"] as const) {
    it(`replays streamed provider metadata through the ${lifecycleMode} lifecycle`, () =>
      withStreamLifecycleMode(lifecycleMode, async () => {
        let callCount = 0;
        let continuedProviderMetadata: unknown;
        const model: ModelRuntime = {
          provider: "google",
          modelId: "gemini-3.5-flash",
          async doGenerate() {
            throw new Error("not used");
          },
          async doStream(options: unknown) {
            callCount++;
            if (callCount === 1) {
              return {
                stream: streamFrom([
                  {
                    type: "tool-call",
                    toolCallId: "lookup-1",
                    toolName: "lookup",
                    input: '{"query":"Veryfront"}',
                  },
                  {
                    type: "finish",
                    finishReason: "tool-calls",
                    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                    providerMetadata,
                  },
                ]),
              };
            }

            continuedProviderMetadata = readAssistantProviderMetadata(options);
            return {
              stream: streamFrom([
                { type: "text-delta", delta: "Done" },
                {
                  type: "finish",
                  finishReason: "stop",
                  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                },
              ]),
            };
          },
        };
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

        assertEquals(callCount, 2);
        assertEquals(continuedProviderMetadata, providerMetadata);
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
        requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
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
});
