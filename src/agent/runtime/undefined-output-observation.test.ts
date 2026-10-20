import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { ModelRuntime, ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import { agent } from "../factory.ts";
import { withLocalChildExecution } from "../composition/local-child-execution.ts";

it("records unsupported undefined transformed output while preserving public object presence", async () => {
  const model: ModelRuntime<ModelRuntimeCallOptions> = {
    provider: "test",
    modelId: "test/undefined-output",
    executionMode: "remote",
    runtimeCapabilities: { structuredOutput: true },
    doGenerate() {
      return Promise.resolve({
        content: [{ type: "text", text: '{"city":"Berlin"}' }],
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      });
    },
    doStream() {
      throw new Error("Generate regression must not stream provider output");
    },
  };
  const assistant = agent({
    id: "undefined-output-observation",
    system: "Report the city.",
    outputSchema: defineSchema((v) => v.object({ city: v.string() }).transform(() => undefined))(),
    resolveModelTransport: () => Promise.resolve({ model }),
  });
  const finished: unknown[] = [];
  const response = await withLocalChildExecution(
    (input) => input.execute(),
    () => assistant.generate({ input: "Berlin?" }),
    (event) => {
      if (event.type === "message-finish") finished.push(event);
      return Promise.resolve();
    },
  );
  assertEquals(Object.hasOwn(response, "object"), true);
  assertEquals(response.object, undefined);
  assertEquals(response.metadata?.outputSchemaError, undefined);
  assertEquals(finished, [{
    type: "message-finish",
    finishReason: "stop",
    totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    objectEncoding: "snapshot",
    object: {
      captureStatus: "unsupported",
      reasons: ["unsupported_undefined"],
      value: "[unsupported undefined]",
    },
  }]);
});

it("streams a data-only middleware response as structured output", async () => {
  const model: ModelRuntime<ModelRuntimeCallOptions> = {
    provider: "test",
    modelId: "test/data-only-middleware",
    executionMode: "remote",
    doGenerate() {
      throw new Error("Middleware must answer before model execution");
    },
    doStream() {
      throw new Error("Middleware must answer before model execution");
    },
  };
  const assistant = agent({
    id: "data-only-middleware-observation",
    system: "Unused because middleware answers directly.",
    resolveModelTransport: () => Promise.resolve({ model }),
    middleware: [() =>
      Promise.resolve({
        text: "structured",
        data: { city: "Berlin" },
        messages: [],
        toolCalls: [],
        status: "completed",
      })],
  });

  const result = await assistant.stream({ input: "Berlin?" });
  const body = await result.toDataStreamResponse().text();
  const finish = body.split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)))
    .find((event) => event.type === "message-finish");

  assertEquals(finish?.data, { city: "Berlin" });
});
