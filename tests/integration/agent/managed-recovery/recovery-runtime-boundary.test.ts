import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { createEphemeralAgentWithRuntimeOptions } from "#veryfront/agent/factory.ts";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool } from "#veryfront/tool";
import type { AgentRuntimeRecoveryBoundary } from "#veryfront/agent/runtime/index.ts";

it("actual runtime exposes canonical continuation boundaries through the original private host callback", async () => {
  const model = scriptedModel([
    { toolCalls: [{ id: "stable-call", name: "inspect", input: { query: "synthetic" } }] },
    { text: "Complete" },
  ], { only: "stream" });
  let effects = 0;
  const boundaries: AgentRuntimeRecoveryBoundary[] = [];
  const runtime = createEphemeralAgentWithRuntimeOptions({
    model: "veryfront-cloud/openai/gpt-5.4",
    system: "Synthetic tool instructions",
    maxSteps: 2,
    tools: {
      inspect: tool({
        id: "inspect",
        description: "Synthetic inspection",
        inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
        execute: () => {
          effects++;
          return Promise.resolve({ ok: true });
        },
      }),
    },
  }, {
    resolveModelRuntime: () => model,
    persistRecoveryBoundary: (boundary) => {
      boundaries.push(boundary);
      return Promise.resolve();
    },
  });
  const result = await runtime.stream({ input: "Synthetic request" });
  await result.toDataStreamResponse().text();
  assertEquals(model.callCount, 2);
  assertEquals(effects, 1);
  assertEquals(boundaries.length >= 4, true);
  assertEquals(boundaries[0]!.messages.length, 1);
  assertEquals(
    boundaries.some((boundary) =>
      boundary.messages.some((message) =>
        message.parts.some((part) =>
          "toolCallId" in part && part.type !== "tool-result" && part.toolCallId === "stable-call"
        )
      )
    ),
    true,
  );
  assertEquals(
    boundaries.some((boundary) =>
      boundary.messages.some((message) =>
        message.parts.some((part) =>
          part.type === "tool-result" && part.toolCallId === "stable-call"
        )
      )
    ),
    true,
  );
});

it("failed host recovery boundary prevents the real provider call", async () => {
  const model = scriptedModel([{ text: "Should not execute" }]);
  const runtime = createEphemeralAgentWithRuntimeOptions({
    model: "veryfront-cloud/openai/gpt-5.4",
    system: "Synthetic",
  }, {
    resolveModelRuntime: () => model,
    persistRecoveryBoundary: () => Promise.reject(new Error("Synthetic durable write failure")),
  });
  await assertRejects(() => runtime.generate({ input: "Synthetic" }));
  assertEquals(model.callCount, 0);
});
