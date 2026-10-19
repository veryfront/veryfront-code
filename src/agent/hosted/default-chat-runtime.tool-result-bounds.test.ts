import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { createToolsFromHostDefinitions } from "#veryfront/tool/host-tools.ts";
import { JSON_VALUE_MAX_SERIALIZED_BYTES } from "#veryfront/schemas/json-value.ts";
import { defineSchema } from "../../schemas/define.ts";
import { scopeHostedRuntimeToolResults } from "./default-chat-runtime.ts";

function toolReturning(result: unknown) {
  return scopeHostedRuntimeToolResults(createToolsFromHostDefinitions({
    attachment: {
      description: "Returns attachment content",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => result,
    },
  })).attachment!;
}

Deno.test("hosted tool results may carry one string over 1 MiB within the 4 MiB bound", async () => {
  const contentBytes = "A".repeat(2 * 1024 * 1024);

  const result = await toolReturning({ contentBytes }).execute({});

  assertEquals(result, { contentBytes });
});

Deno.test("hosted tool results over the 4 MiB bound still fail explicitly", async () => {
  const contentBytes = "A".repeat(JSON_VALUE_MAX_SERIALIZED_BYTES);

  await assertRejects(
    async () => await toolReturning({ contentBytes }).execute({}),
    TypeError,
    "Hosted project tool execution failed",
  );
});
