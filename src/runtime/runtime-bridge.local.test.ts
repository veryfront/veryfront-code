import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { createLocalModelRuntime } from "#veryfront/provider/local/model-runtime-adapter.ts";
import { streamText } from "./runtime-bridge.ts";
import { collectAsync } from "./runtime-bridge.test-helpers.ts";

Deno.test("runtime bridge accepts the complete first-party local stream contract", async () => {
  const model = createLocalModelRuntime("test-model", {
    generate: () => Promise.resolve("hello"),
    generateStream: async function* () {
      yield "hel";
      yield "lo";
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
});
