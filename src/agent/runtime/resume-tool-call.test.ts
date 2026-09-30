import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool } from "#veryfront/tool";
import { createEphemeralAgentWithRuntimeOptions } from "../factory.ts";
import { scriptedModel } from "./model-runtime.test-helpers.ts";

it("executes a trusted pending tool call exactly once before model continuation", async () => {
  const executions: unknown[] = [];
  const model = scriptedModel([{ text: "continued" }], { only: "stream" });
  const assistant = createEphemeralAgentWithRuntimeOptions({
    id: "resume-tool-call",
    system: "Continue after the resumed tool result.",
    tools: {
      lookup: tool({
        id: "lookup",
        description: "Lookup one record",
        inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
        execute: (input) => {
          executions.push(input);
          return { matches: ["record-1"] };
        },
      }),
    },
    resolveModelTransport: () => Promise.resolve({ model }),
  }, {
    resumeToolCall: {
      id: "call-1:resume-1",
      name: "lookup",
      input: { query: "open" },
    },
  });

  const body = await (await assistant.stream({ input: "continue" })).toDataStreamResponse().text();

  assertEquals(executions, [{ query: "open" }]);
  assertStringIncludes(body, "call-1:resume-1");
  assertStringIncludes(body, '"query":"open"');
  const prompt = JSON.stringify(model.calls[0]?.prompt);
  assertStringIncludes(prompt, "call-1:resume-1");
  assertStringIncludes(prompt, "record-1");
});

it("records a denied trusted pending call and continues the model turn", async () => {
  const model = scriptedModel([{ text: "continued after denial" }], { only: "stream" });
  const assistant = createEphemeralAgentWithRuntimeOptions({
    id: "resume-unauthorized-tool-call",
    system: "Continue only after the resumed tool result.",
    tools: {},
    resolveModelTransport: () => Promise.resolve({ model }),
  }, {
    resumeToolCall: {
      id: "call-unauthorized:resume-1",
      name: "outlook__list_messages",
      input: { folder: "inbox" },
    },
  });

  const body = await (await assistant.stream({ input: "continue" })).toDataStreamResponse().text();

  assertStringIncludes(
    body,
    'Tool \\"outlook__list_messages\\" is not available in the current model step',
  );
  assertStringIncludes(body, "continued after denial");
  assertEquals(model.calls.length, 1);
});
