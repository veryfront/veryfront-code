import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import { registerModelProvider } from "#veryfront/provider";
import type { JsonSchema } from "#veryfront/extensions/schema/index.ts";
import type { ModelRuntime } from "#veryfront/provider";
import { generate } from "./index.ts";

const SCHEMA: JsonSchema = {
  type: "object",
  properties: { city: { type: "string" } },
  required: ["city"],
  additionalProperties: false,
};

function stubProvider(text: string) {
  const calls: Record<string, unknown>[] = [];
  const runtime: ModelRuntime = {
    specificationVersion: "v2",
    provider: "stub",
    modelId: "stub",
    runtimeCapabilities: { toolCalling: true, structuredOutput: true },
    doGenerate(options: unknown) {
      calls.push(options as Record<string, unknown>);
      return Promise.resolve({
        content: [{ type: "text", text }],
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      });
    },
    doStream() {
      throw new Error("unused");
    },
  };
  const dispose = registerModelProvider("stub", () => runtime);
  return { calls, dispose };
}

describe("llm/generate", () => {
  beforeEach(() => {
    agentRegistry.clearAll();
  });

  it("returns text through a one-shot agent facade", async () => {
    const stub = stubProvider("hello");
    try {
      const result = await generate({ input: "hi", model: "stub/stub" });
      assertEquals(result.text, "hello");
    } finally {
      stub.dispose();
    }
  });

  it("does not register temporary agents", async () => {
    const stub = stubProvider("hello");
    try {
      await generate({ input: "hi", model: "stub/stub" });
      await generate({ input: "again", model: "stub/stub" });

      assertEquals(agentRegistry.getAllIds(), []);
    } finally {
      stub.dispose();
    }
  });

  it("sends the caller's system prompt and no tools", async () => {
    const stub = stubProvider("hello");
    try {
      await generate({ input: "hi", system: "You are terse.", model: "stub/stub" });
      const [call] = stub.calls;
      assertEquals(call?.tools, undefined);
      const prompt = call?.prompt as Array<{ role: string; content: unknown }>;
      assertEquals(prompt[0]?.role, "system");
      assertEquals(prompt[0]?.content, "You are terse.");
    } finally {
      stub.dispose();
    }
  });

  it("parses a schema-constrained response into object", async () => {
    const stub = stubProvider('{"city":"Berlin"}');
    try {
      const result = await generate({
        input: "where",
        model: "stub/stub",
        outputSchema: SCHEMA,
      });
      assertEquals(result.object, { city: "Berlin" });
    } finally {
      stub.dispose();
    }
  });

  it("sends the schema as a response format", async () => {
    const stub = stubProvider('{"city":"Berlin"}');
    try {
      await generate({ input: "where", model: "stub/stub", outputSchema: SCHEMA });
      const [call] = stub.calls;
      assertEquals((call?.responseFormat as { type?: string })?.type, "json_schema");
      assertEquals((call?.responseFormat as { schema?: unknown })?.schema, SCHEMA);
    } finally {
      stub.dispose();
    }
  });

  it("rejects a response that does not satisfy the schema", async () => {
    const stub = stubProvider('{"city":42}');
    try {
      await assertRejects(() =>
        generate({ input: "where", model: "stub/stub", outputSchema: SCHEMA })
      );
      assertEquals(agentRegistry.getAllIds(), []);
    } finally {
      stub.dispose();
    }
  });

  it("omits object when no schema is requested", async () => {
    const stub = stubProvider("plain");
    try {
      const result = await generate({ input: "hi", model: "stub/stub" });
      assertEquals("object" in result && result.object !== undefined, false);
    } finally {
      stub.dispose();
    }
  });
});
