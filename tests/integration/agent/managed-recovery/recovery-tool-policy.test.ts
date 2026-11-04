import "#veryfront/schemas/_test-setup.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { executeConfiguredTool } from "#veryfront/agent/runtime/tool-helpers.ts";
import { runWithRecoveryToolExecutionPolicy } from "#veryfront/runtime/execution-ownership-guard.ts";
import {
  getCurrentToolCallOccurrenceIdentity,
  introduceToolCallOccurrence,
  runWithToolCallOccurrenceDispatch,
  runWithToolCallOccurrences,
} from "#veryfront/runtime/tool-call-occurrence.ts";
import { tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";

it("private around-operation policy gates actual callback and sees stable distinct parallel occurrences", async () => {
  const order: string[] = [];
  const occurrences = new Set<string>();
  const tools = {
    inspect: tool({
      id: "inspect",
      description: "Synthetic deterministic effect",
      inputSchema: defineSchema((v) => v.object({ id: v.string() }))(),
      execute: ({ id }) => {
        order.push(`effect:${id}`);
        return Promise.resolve({ id });
      },
    }),
  };
  await runWithRecoveryToolExecutionPolicy(async (execution, operation) => {
    const occurrence = getCurrentToolCallOccurrenceIdentity()!;
    assertEquals(occurrence.toolCallId, execution.input.id);
    occurrences.add(occurrence.occurrenceId);
    order.push(`intent:${execution.input.id}`);
    const result = await operation();
    order.push(`result:${execution.input.id}`);
    return result;
  }, () =>
    runWithToolCallOccurrences(() =>
      Promise.all(["first", "second"].map((id) => {
        const call = { id };
        introduceToolCallOccurrence(call);
        return runWithToolCallOccurrenceDispatch(
          call,
          () => executeConfiguredTool("inspect", { id }, tools),
        );
      }))
    ));
  assertEquals(occurrences.size, 2);
  for (const id of ["first", "second"]) {
    assertEquals(order.indexOf(`intent:${id}`) < order.indexOf(`effect:${id}`), true);
    assertEquals(order.indexOf(`effect:${id}`) < order.indexOf(`result:${id}`), true);
  }
  let executed = false;
  await assertRejects(() =>
    runWithRecoveryToolExecutionPolicy(
      () => Promise.reject(new Error("Synthetic unacknowledged admission")),
      () =>
        executeConfiguredTool("inspect", { id: "denied" }, {
          inspect: {
            ...tools.inspect,
            execute: () => {
              executed = true;
              return Promise.resolve(null);
            },
          },
        }),
    )
  );
  assertEquals(executed, false);
});

it("nested private tool policies cannot remove inherited host gating", async () => {
  let parent = 0;
  await runWithRecoveryToolExecutionPolicy(
    async (_execution, operation) => {
      parent++;
      return await operation();
    },
    () =>
      runWithRecoveryToolExecutionPolicy(undefined, () =>
        executeConfiguredTool("inspect", {}, {
          inspect: tool({
            id: "inspect",
            description: "Synthetic",
            inputSchema: defineSchema((v) => v.object({}))(),
            execute: () => Promise.resolve(1),
          }),
        })),
  );
  assertEquals(parent, 1);
});
