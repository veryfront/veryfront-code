import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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

describe("hosted tool result bounds", () => {
  it("lets one string over 1 MiB use the 4 MiB bound", async () => {
    const contentBytes = "A".repeat(2 * 1024 * 1024);

    const result = await toolReturning({ contentBytes }).execute({});

    assertEquals(result, { contentBytes });
  });

  it("still fails explicitly over the 4 MiB bound", async () => {
    const contentBytes = "A".repeat(JSON_VALUE_MAX_SERIALIZED_BYTES);

    await assertRejects(
      async () => await toolReturning({ contentBytes }).execute({}),
      TypeError,
      "Hosted project tool execution failed",
    );
  });
});
