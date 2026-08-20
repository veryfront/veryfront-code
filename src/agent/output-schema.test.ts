import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type {
  ModelRuntime,
  ModelRuntimeCallOptions,
  RuntimeResponseFormat,
} from "#veryfront/provider/types.ts";
import { toolRegistryInternal } from "#veryfront/tool/registry.ts";
import { skillRegistryInternal } from "#veryfront/skill/registry.ts";
import type { BaseAgentResponse } from "./types.ts";
import { agentRegistry } from "./composition/index.ts";
import { agent } from "./factory.ts";
import { resolveAgentOutputSchema } from "./output-schema.ts";

const getTemperatureSchema = defineSchema((v) => v.object({ city: v.string(), tempC: v.number() }));

const getHeadlineSchema = defineSchema((v) => v.object({ headline: v.string() }));

function createRecordingModel(
  text: string,
  calls: ModelRuntimeCallOptions[],
  advertiseStructuredOutput = true,
): ModelRuntime<ModelRuntimeCallOptions> {
  return {
    provider: "test",
    modelId: "test/recording",
    executionMode: "remote",
    // A runtime that never advertises the capability is the "omitted" case the
    // bridge has to reject, so the property is left off entirely.
    ...(advertiseStructuredOutput ? { runtimeCapabilities: { structuredOutput: true } } : {}),
    doGenerate(options: ModelRuntimeCallOptions) {
      calls.push(options);
      return Promise.resolve({
        content: [{ type: "text", text }],
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      });
    },
    doStream(options: ModelRuntimeCallOptions) {
      calls.push(options);
      return Promise.resolve({
        stream: new ReadableStream<unknown>({
          start(controller) {
            controller.enqueue({ type: "text-delta", delta: text });
            controller.enqueue({
              type: "finish",
              finishReason: "stop",
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            });
            controller.close();
          },
        }),
      });
    },
  };
}

function onlyRequestedFormat(
  calls: ModelRuntimeCallOptions[],
): RuntimeResponseFormat | undefined {
  assertEquals(calls.length, 1);
  return calls[0]?.responseFormat;
}

describe("agent output schema", () => {
  beforeEach(() => {
    agentRegistry.clearAll();
    skillRegistryInternal.clearAll();
    toolRegistryInternal.clearAll();
  });

  describe("resolveAgentOutputSchema", () => {
    it("should emit a json_schema response format for a contract schema", () => {
      const resolved = resolveAgentOutputSchema(getTemperatureSchema(), "weather");
      assertEquals(resolved?.responseFormat.type, "json_schema");
      assertEquals(
        resolved?.responseFormat.type === "json_schema" ? resolved.responseFormat.name : undefined,
        "response",
      );
    });

    it("should emit a json_schema response format for a raw JSON Schema", () => {
      const resolved = resolveAgentOutputSchema(
        { type: "object", properties: { headline: { type: "string" } } },
        "news",
      );
      assertEquals(
        resolved?.responseFormat.type === "json_schema"
          ? resolved.responseFormat.schema
          : undefined,
        { type: "object", properties: { headline: { type: "string" } } },
      );
    });

    it("should return undefined when no schema was requested", () => {
      assertEquals(resolveAgentOutputSchema(undefined, "plain"), undefined);
    });

    it("should reject a value that is neither a schema nor a JSON Schema", () => {
      const error = assertThrows(() => resolveAgentOutputSchema({ nope: true }, "broken"));
      assertStringIncludes(
        (error as Error).message,
        "outputSchema is not a valid Veryfront schema",
      );
    });
  });

  describe("generate", () => {
    it("should map the configured schema onto the model request", async () => {
      const calls: ModelRuntimeCallOptions[] = [];
      const model = createRecordingModel('{"city":"Berlin","tempC":12}', calls);
      const weather = agent({
        id: "weather-generate",
        system: "You report weather.",
        outputSchema: getTemperatureSchema(),
        resolveModelTransport: () => Promise.resolve({ model }),
      });

      const response = await weather.generate({ input: "Berlin?" });

      assertEquals(onlyRequestedFormat(calls)?.type, "json_schema");
      // Inference is checked here without an annotation on `response`.
      assertEquals(response.object.city, "Berlin");
      assertEquals(response.object.tempC, 12);
    });

    it("should apply default output filtering to structured objects", async () => {
      const calls: ModelRuntimeCallOptions[] = [];
      const model = createRecordingModel(
        '{"city":"john@example.com","tempC":12}',
        calls,
      );
      const weather = agent({
        id: "weather-generate-filtered-object",
        system: "You report weather.",
        outputSchema: getTemperatureSchema(),
        resolveModelTransport: () => Promise.resolve({ model }),
      });

      const response = await weather.generate({ input: "Berlin?" });

      assertEquals(response.text, '{"city":"[EMAIL]","tempC":12}');
      assertEquals(response.object, { city: "[EMAIL]", tempC: 12 });
    });

    it("should leave an agent without a schema unchanged", async () => {
      const calls: ModelRuntimeCallOptions[] = [];
      const model = createRecordingModel("Twelve degrees.", calls);
      const plain = agent({
        id: "weather-plain",
        system: "You report weather.",
        resolveModelTransport: () => Promise.resolve({ model }),
      });

      const response = await plain.generate({ input: "Berlin?" });

      assertEquals(onlyRequestedFormat(calls), undefined);
      assertEquals(response.text, "Twelve degrees.");
      assertEquals(response.object, undefined);
    });

    it("should let a per-call schema override the configured one", async () => {
      const calls: ModelRuntimeCallOptions[] = [];
      const model = createRecordingModel('{"headline":"Snow in Berlin"}', calls);
      const weather = agent({
        id: "weather-override",
        system: "You report weather.",
        outputSchema: getTemperatureSchema(),
        resolveModelTransport: () => Promise.resolve({ model }),
      });

      // The response type follows the configured schema, so the overridden
      // value is read through the erased base response.
      const response: BaseAgentResponse = await weather.generate({
        input: "Berlin?",
        outputSchema: getHeadlineSchema(),
      });

      const requested = onlyRequestedFormat(calls);
      assertEquals(
        requested?.type === "json_schema" ? requested.schema : undefined,
        {
          type: "object",
          properties: { headline: { type: "string" } },
          required: ["headline"],
        },
      );
      assertEquals(response.object, { headline: "Snow in Berlin" });
    });

    it("should raise when the model's output does not parse as JSON", async () => {
      const calls: ModelRuntimeCallOptions[] = [];
      const model = createRecordingModel("Twelve degrees in Berlin.", calls);
      const weather = agent({
        id: "weather-unparsable",
        system: "You report weather.",
        outputSchema: getTemperatureSchema(),
        resolveModelTransport: () => Promise.resolve({ model }),
      });

      const error = await assertRejects(() => weather.generate({ input: "Berlin?" }));
      assertStringIncludes((error as Error).message, "is not valid JSON for its outputSchema");
    });

    it("should raise when the model's output fails schema validation", async () => {
      const calls: ModelRuntimeCallOptions[] = [];
      const model = createRecordingModel('{"city":"Berlin"}', calls);
      const weather = agent({
        id: "weather-invalid",
        system: "You report weather.",
        outputSchema: getTemperatureSchema(),
        resolveModelTransport: () => Promise.resolve({ model }),
      });

      const error = await assertRejects(() => weather.generate({ input: "Berlin?" }));
      assertStringIncludes((error as Error).message, "failed outputSchema validation");
    });

    it("should refuse a runtime that does not advertise structured output", async () => {
      const calls: ModelRuntimeCallOptions[] = [];
      const model = createRecordingModel('{"city":"Berlin","tempC":12}', calls, false);
      const weather = agent({
        id: "weather-unsupported",
        system: "You report weather.",
        outputSchema: getTemperatureSchema(),
        resolveModelTransport: () => Promise.resolve({ model }),
      });

      const error = await assertRejects(() => weather.generate({ input: "Berlin?" }));
      assertStringIncludes((error as Error).message, "does not support structured output");
      assertEquals(calls.length, 0);
    });
  });

  describe("stream", () => {
    it("should expose the parsed object on completion", async () => {
      const calls: ModelRuntimeCallOptions[] = [];
      const model = createRecordingModel('{"city":"Berlin","tempC":12}', calls);
      const weather = agent({
        id: "weather-stream",
        system: "You report weather.",
        outputSchema: getTemperatureSchema(),
        resolveModelTransport: () => Promise.resolve({ model }),
      });

      let finished: unknown;
      const result = await weather.stream({
        input: "Berlin?",
        onFinish: (response) => {
          finished = response.object;
        },
      });
      const body = await result.toDataStreamResponse().text();

      assertEquals(onlyRequestedFormat(calls)?.type, "json_schema");
      assertEquals(finished, { city: "Berlin", tempC: 12 });
      assertStringIncludes(body, '"type":"message-finish"');
      assertStringIncludes(body, '"object":{"city":"Berlin","tempC":12}');
    });

    it("should emit an error event when streamed output is not parseable", async () => {
      const calls: ModelRuntimeCallOptions[] = [];
      const model = createRecordingModel("Twelve degrees in Berlin.", calls);
      const weather = agent({
        id: "weather-stream-unparsable",
        system: "You report weather.",
        outputSchema: getTemperatureSchema(),
        resolveModelTransport: () => Promise.resolve({ model }),
      });

      let onFinishCalled = false;
      const result = await weather.stream({
        input: "Berlin?",
        onFinish: () => {
          onFinishCalled = true;
        },
      });
      const body = await result.toDataStreamResponse().text();

      assertEquals(onlyRequestedFormat(calls)?.type, "json_schema");
      assertStringIncludes(body, '"type":"text-delta"');
      assertStringIncludes(body, '"type":"error"');
      assertStringIncludes(body, "is not valid JSON for its outputSchema");
      assertEquals(onFinishCalled, false);
    });
  });
});
