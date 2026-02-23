import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runTask } from "./runner.ts";
import type { DiscoveredTask } from "./discovery.ts";
import type { TaskDefinition } from "./types.ts";

function makeTask(definition: TaskDefinition, id = "test-task"): DiscoveredTask {
  return {
    id,
    name: definition.name || id,
    filePath: `tasks/${id}.ts`,
    exportName: "default",
    definition,
  };
}

describe("src/task/runner", () => {
  describe("runTask", () => {
    it("should return success with the task result", async () => {
      const task = makeTask({
        name: "simple",
        run: () => ({ count: 42 }),
      });

      const result = await runTask({ task });

      assertEquals(result.success, true);
      assertEquals(result.result, { count: 42 });
      assertEquals(typeof result.durationMs, "number");
      assertEquals(result.error, undefined);
    });

    it("should handle async tasks", async () => {
      const task = makeTask({
        name: "async-task",
        run: async () => {
          return "done";
        },
      });

      const result = await runTask({ task });

      assertEquals(result.success, true);
      assertEquals(result.result, "done");
    });

    it("should return failure when task throws", async () => {
      const task = makeTask({
        name: "failing-task",
        run: () => {
          throw new Error("something went wrong");
        },
      });

      const result = await runTask({ task });

      assertEquals(result.success, false);
      assertEquals(result.error, "something went wrong");
      assertEquals(result.result, undefined);
      assertEquals(typeof result.durationMs, "number");
    });

    it("should return failure when async task rejects", async () => {
      const task = makeTask({
        name: "rejecting-task",
        run: async () => {
          throw new Error("async failure");
        },
      });

      const result = await runTask({ task });

      assertEquals(result.success, false);
      assertEquals(result.error, "async failure");
    });

    it("should pass config to task context", async () => {
      let receivedConfig: Record<string, unknown> = {};
      const task = makeTask({
        run: (ctx) => {
          receivedConfig = ctx.config;
          return null;
        },
      });

      await runTask({ task, config: { key: "value" } });

      assertEquals(receivedConfig, { key: "value" });
    });

    it("should pass projectId to task context", async () => {
      let receivedProjectId: string | undefined;
      const task = makeTask({
        run: (ctx) => {
          receivedProjectId = ctx.projectId;
          return null;
        },
      });

      await runTask({ task, projectId: "proj-123" });

      assertEquals(receivedProjectId, "proj-123");
    });
  });
});
