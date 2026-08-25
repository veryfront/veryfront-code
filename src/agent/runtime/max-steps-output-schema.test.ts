import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { ModelRuntime, ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import { tool } from "#veryfront/tool";
import { agent } from "../factory.ts";

const getReportSchema = defineSchema((v) => v.object({ city: v.string(), tempC: v.number() }));
const discardReportSchema = defineSchema((v) =>
  v.object({ city: v.string() }).transform(() => undefined)
);

const noopTool = tool({
  id: "max_steps_noop_tool",
  description: "Succeeds without side effects",
  inputSchema: defineSchema((v) => v.object({}))(),
  execute: () => ({ ok: true }),
});

/**
 * A model that always answers with text plus a tool call, so the agent loop
 * never finishes on its own and exits through the max-steps path.
 */
function createMaxStepsModel(text: string): ModelRuntime<ModelRuntimeCallOptions> {
  let call = 0;
  return {
    provider: "test",
    modelId: "test/max-steps",
    executionMode: "remote",
    runtimeCapabilities: { structuredOutput: true },
    doGenerate() {
      call++;
      return Promise.resolve({
        content: [
          { type: "text", text },
          {
            type: "tool-call",
            toolCallId: `call-${call}`,
            toolName: "max_steps_noop_tool",
            input: "{}",
          },
        ],
        finishReason: "tool-calls" as const,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      });
    },
    doStream() {
      call++;
      const parts: unknown[] = [
        { type: "text-delta", text },
        {
          type: "tool-call",
          toolCallId: `call-${call}`,
          toolName: "max_steps_noop_tool",
          input: {},
        },
        {
          type: "finish",
          finishReason: "tool-calls",
          totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        },
      ];
      return Promise.resolve({
        stream: new ReadableStream<unknown>({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      });
    },
  };
}

describe("agent max steps output schema", () => {
  it("surfaces the outputSchema parse failure in metadata on the max-steps exit", async () => {
    const model = createMaxStepsModel("Twelve degrees in Berlin.");
    const assistant = agent({
      id: "max-steps-unparsable",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 1,
      outputSchema: getReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });

    const response = await assistant.generate({ input: "Berlin?" });

    assertEquals(response.metadata?.warning, "Max steps (1) reached");
    assertEquals(response.object, undefined);
    assertStringIncludes(
      String(response.metadata?.outputSchemaError),
      "is not valid JSON for its outputSchema",
    );
    assertEquals(response.text, "Twelve degrees in Berlin.");
  });

  it("surfaces the outputSchema validation failure in metadata on the max-steps exit", async () => {
    const model = createMaxStepsModel('{"city":"Berlin"}');
    const assistant = agent({
      id: "max-steps-invalid",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 1,
      outputSchema: getReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });

    const response = await assistant.generate({ input: "Berlin?" });

    assertEquals(response.metadata?.warning, "Max steps (1) reached");
    assertEquals(response.object, undefined);
    assertStringIncludes(
      String(response.metadata?.outputSchemaError),
      "failed outputSchema validation",
    );
  });

  it("surfaces an empty structured output on the max-steps exit", async () => {
    const model = createMaxStepsModel("");
    const assistant = agent({
      id: "max-steps-empty",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 1,
      outputSchema: getReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });

    const response = await assistant.generate({ input: "Berlin?" });

    assertEquals(response.metadata?.warning, "Max steps (1) reached");
    assertEquals(response.object, undefined);
    assertStringIncludes(
      String(response.metadata?.outputSchemaError),
      "is not valid JSON for its outputSchema",
    );
    assertEquals(response.text, "");
  });

  it("keeps the parsed object and adds no error when the final text satisfies the schema", async () => {
    const model = createMaxStepsModel('{"city":"Berlin","tempC":12}');
    const assistant = agent({
      id: "max-steps-parsable",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 1,
      outputSchema: getReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });

    const response = await assistant.generate({ input: "Berlin?" });

    assertEquals(response.metadata?.warning, "Max steps (1) reached");
    assertEquals(response.metadata?.outputSchemaError, undefined);
    assertEquals(response.object, { city: "Berlin", tempC: 12 });
  });

  it("preserves object presence when a successful schema transform returns undefined", async () => {
    const model = createMaxStepsModel('{"city":"Berlin"}');
    const assistant = agent({
      id: "max-steps-undefined-transform",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 1,
      outputSchema: discardReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });

    const response = await assistant.generate({ input: "Berlin?" });

    assertEquals("object" in response, true);
    assertEquals(response.object, undefined);
    assertEquals(response.metadata?.outputSchemaError, undefined);
  });

  it("streams the partial response with outputSchemaError when the step budget runs out", async () => {
    const model = createMaxStepsModel("Twelve degrees in Berlin.");
    const assistant = agent({
      id: "max-steps-stream-unparsable",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 1,
      outputSchema: getReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });

    let finished: Record<string, unknown> | undefined;
    const result = await assistant.stream({
      input: "Berlin?",
      onFinish: (response) => {
        finished = response as unknown as Record<string, unknown>;
      },
    });
    const body = await result.toDataStreamResponse().text();

    assertEquals(body.includes('"type":"error"'), false);
    const metadata = finished?.metadata as Record<string, unknown> | undefined;
    assertEquals(metadata?.warning, "Max steps (1) reached");
    assertStringIncludes(
      String(metadata?.outputSchemaError),
      "is not valid JSON for its outputSchema",
    );
    assertEquals(finished?.object, undefined);
    assertEquals(finished?.text, "Twelve degrees in Berlin.");
  });

  it("streams outputSchemaError when interrupted local tool recovery runs out of steps", async () => {
    let call = 0;
    const model: ModelRuntime<ModelRuntimeCallOptions> = {
      provider: "test",
      modelId: "test/max-steps-interrupted-local-tool",
      executionMode: "remote",
      runtimeCapabilities: { structuredOutput: true },
      doGenerate() {
        throw new Error("stream test must not call doGenerate");
      },
      doStream() {
        call++;
        const parts: unknown[] = call === 1
          ? [
            {
              type: "tool-call",
              toolCallId: "committed-call",
              toolName: "max_steps_noop_tool",
              input: {},
            },
            {
              type: "finish",
              finishReason: "tool-calls",
              totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            },
          ]
          : [
            {
              type: "tool-input-start",
              id: "interrupted-call",
              toolName: "max_steps_noop_tool",
            },
            {
              type: "tool-input-delta",
              id: "interrupted-call",
              delta: '{"revision":"trunc',
            },
            {
              type: "finish",
              finishReason: "tool-calls",
              totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            },
          ];
        return Promise.resolve({
          stream: new ReadableStream<unknown>({
            start(controller) {
              for (const part of parts) controller.enqueue(part);
              controller.close();
            },
          }),
        });
      },
    };
    const assistant = agent({
      id: "max-steps-stream-interrupted-local-tool",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 2,
      outputSchema: getReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });

    let finished: Record<string, unknown> | undefined;
    const result = await assistant.stream({
      input: "Berlin?",
      onFinish: (response) => {
        finished = response as unknown as Record<string, unknown>;
      },
    });
    const body = await result.toDataStreamResponse().text();

    assertEquals(call, 2);
    assertEquals(body.includes('"type":"error"'), false);
    const metadata = finished?.metadata as Record<string, unknown> | undefined;
    assertEquals(metadata?.warning, "Max steps (2) reached");
    assertStringIncludes(
      String(metadata?.outputSchemaError),
      "is not valid JSON for its outputSchema",
    );
    assertEquals(finished?.object, undefined);
  });

  it("streams the parsed object when the final text satisfies the schema at the step budget", async () => {
    const model = createMaxStepsModel('{"city":"Berlin","tempC":12}');
    const assistant = agent({
      id: "max-steps-stream-parsable",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 1,
      outputSchema: getReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });

    let finished: Record<string, unknown> | undefined;
    const result = await assistant.stream({
      input: "Berlin?",
      onFinish: (response) => {
        finished = response as unknown as Record<string, unknown>;
      },
    });
    await result.toDataStreamResponse().text();

    const metadata = finished?.metadata as Record<string, unknown> | undefined;
    assertEquals(metadata?.warning, "Max steps (1) reached");
    assertEquals(metadata?.outputSchemaError, undefined);
    assertEquals(finished?.object, { city: "Berlin", tempC: 12 });
  });

  it("streams object presence when a successful schema transform returns undefined", async () => {
    const model = createMaxStepsModel('{"city":"Berlin"}');
    const assistant = agent({
      id: "max-steps-stream-undefined-transform",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 1,
      outputSchema: discardReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });

    let finished: Record<string, unknown> | undefined;
    const result = await assistant.stream({
      input: "Berlin?",
      onFinish: (response) => {
        finished = response as unknown as Record<string, unknown>;
      },
    });
    await result.toDataStreamResponse().text();

    assertEquals(finished !== undefined && "object" in finished, true);
    assertEquals(finished?.object, undefined);
    const metadata = finished?.metadata as Record<string, unknown> | undefined;
    assertEquals(metadata?.outputSchemaError, undefined);
  });

  it("adds no outputSchemaError when the agent has no outputSchema", async () => {
    const model = createMaxStepsModel("Twelve degrees in Berlin.");
    const assistant = agent({
      id: "max-steps-no-schema",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 1,
      resolveModelTransport: () => Promise.resolve({ model }),
    });

    const response = await assistant.generate({ input: "Berlin?" });

    assertEquals(response.metadata?.warning, "Max steps (1) reached");
    assertEquals(response.metadata?.outputSchemaError, undefined);
    assertEquals(response.object, undefined);
  });
});
