import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { createLocalModelRuntime } from "../../../extensions/ext-llm-transformers/src/model-runtime-adapter.ts";
import { collectAsync } from "../../../src/runtime/runtime-bridge.test-helpers.ts";
import { streamText } from "../../../src/runtime/runtime-bridge.ts";

Deno.test("runtime bridge accepts the Transformers extension stream contract", async () => {
  const model = createLocalModelRuntime("test-model", {
    generate: () => Promise.resolve({ text: "hello", finishReason: "stop" }),
    generateStream: async function* () {
      yield "hel";
      yield "lo";
      return "stop" as const;
    },
  });

  const result = streamText({
    model,
    messages: [{ role: "user", content: "hello" }],
  });
  const parts = await collectAsync(result.fullStream);

  assertEquals(
    parts.map((part) =>
      typeof part === "object" && part !== null && "type" in part ? part.type : undefined
    ),
    [
      "stream-start",
      "response-metadata",
      "text-start",
      "text-delta",
      "text-delta",
      "text-end",
      "finish",
    ],
  );
  assertEquals(
    parts.filter((part) =>
      typeof part === "object" && part !== null && "type" in part &&
      part.type === "text-delta"
    ),
    [
      { type: "text-delta", text: "hel" },
      { type: "text-delta", text: "lo" },
    ],
  );
  assertEquals(
    parts.find((part) =>
      typeof part === "object" && part !== null && "type" in part && part.type === "finish"
    ),
    { type: "finish", finishReason: "stop" },
  );
});
