/**
 * Task business input contract (veryfront/veryfront-issue-inbox#2105).
 *
 * A run's business input reaches the task as `ctx.input`, separate from the execution
 * settings in `ctx.config`. When no input was submitted, `ctx.input` falls back to
 * `ctx.config`, so tasks that read business data from config keep working.
 */
import "#veryfront/schemas/_test-setup.ts";
import { createInMemoryHostRuntime } from "#veryfront/platform/compat/process.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { type RunnableTask, runTask } from "./runner.ts";
import type { TaskContext, TaskDefinition } from "./types.ts";

function makeTask(definition: TaskDefinition): RunnableTask {
  return { id: "classify", name: "classify", definition };
}

function captureContext(): { task: RunnableTask; seen: () => Partial<TaskContext> } {
  let seen: Partial<TaskContext> = {};
  const task = makeTask({
    run: (ctx) => {
      seen = { input: ctx.input, config: ctx.config };
      return null;
    },
  });
  return { task, seen: () => seen };
}

describe("src/task/runner io contract", () => {
  it("passes submitted business input as ctx.input and keeps ctx.config", async () => {
    const { task, seen } = captureContext();

    await runTask(
      { task, config: { dry_run: true }, input: { ticket: "T-1" } },
      createInMemoryHostRuntime(),
    );

    assertEquals(seen(), { input: { ticket: "T-1" }, config: { dry_run: true } });
  });

  it("falls back to config for ctx.input when no input was submitted", async () => {
    const { task, seen } = captureContext();

    await runTask({ task, config: { ticket: "T-legacy" } }, createInMemoryHostRuntime());

    assertEquals(seen(), { input: { ticket: "T-legacy" }, config: { ticket: "T-legacy" } });
  });

  it("treats null input as no input and falls back to config", async () => {
    const { task, seen } = captureContext();

    await runTask(
      { task, config: { ticket: "T-legacy" }, input: null },
      createInMemoryHostRuntime(),
    );

    assertEquals(seen(), { input: { ticket: "T-legacy" }, config: { ticket: "T-legacy" } });
  });

  it("falls back to an empty config for ctx.input when neither input nor config was submitted", async () => {
    const { task, seen } = captureContext();

    await runTask({ task }, createInMemoryHostRuntime());

    assertEquals(seen(), { input: {}, config: {} });
  });

  for (
    const [label, value] of [
      ["an array", ["INV-7731", "Harbor Office"]],
      ["a string", "a string"],
      ["a number", 42],
      ["a boolean", false],
    ] as const
  ) {
    it(`passes ${label} input to ctx.input unchanged`, async () => {
      const { task, seen } = captureContext();

      await runTask({ task, input: value }, createInMemoryHostRuntime());

      assertEquals(seen(), { input: value, config: {} });
    });
  }
});
