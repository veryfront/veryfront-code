import "#veryfront/schemas/_test-setup.ts";
import { AGENT_EMPTY_RESPONSE, VeryfrontError } from "#veryfront/errors";
import { defineSchema } from "#veryfront/schemas";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { tool } from "#veryfront/tool";
import { agent } from "../index.ts";
import type { AgentConfig } from "../types.ts";
import { isRuntimeEmptyResponseError } from "./empty-response-recovery.ts";
import { scriptedModel } from "./model-runtime.test-helpers.ts";
import type { RuntimeToolFilterConfig } from "./runtime-tool-config.ts";

it("does not classify forged or uninspectable errors as empty-response failures", () => {
  assertEquals(isRuntimeEmptyResponseError({ code: "EMPTY_RESPONSE" }), false);

  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  assertEquals(isRuntimeEmptyResponseError(proxy), false);
});

it("generate classifies exhausted empty-response recovery with a stable registry slug", async () => {
  const model = scriptedModel([
    { toolCalls: [{ id: "search-1", name: "tool_search", input: { query: "update_file" } }] },
    { content: [], finishReason: "stop" },
  ], { modelId: "hosted/empty-response-error-contract", only: "generate" });
  const assistant = agent(
    {
      id: "empty-response-error-contract",
      model: model.modelId,
      system: "Update the requested file and report completion.",
      skills: false,
      tools: {
        update_file: tool({
          id: "update_file",
          description: "Update a project file",
          inputSchema: defineSchema((v) => v.object({ path: v.string(), content: v.string() }))(),
          execute: ({ path, content }) => ({ path, content }),
        }),
      },
      maxSteps: 2,
      resolveModelTransport: () => ({ model }),
      __vfToolLoadingMode: "deferred",
    } as AgentConfig & RuntimeToolFilterConfig,
  );

  const error = await assertRejects(
    () => assistant.generate({ input: "Update src/app.ts" }),
    VeryfrontError,
    "without producing a response",
  );

  if (!(error instanceof VeryfrontError)) {
    throw new Error("Expected empty-response generation failure to use VeryfrontError");
  }
  assertEquals(AGENT_EMPTY_RESPONSE.slug, "agent-empty-response");
  assertEquals(error.slug, "agent-empty-response");
});
