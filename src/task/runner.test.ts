import "#veryfront/schemas/_test-setup.ts";
import { createInMemoryHostRuntime } from "#veryfront/platform/compat/process.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { type RunnableTask, runTask } from "./runner.ts";
import type { TaskDefinition } from "./types.ts";

function makeTask(definition: TaskDefinition, id = "test-task"): RunnableTask {
  return {
    id,
    name: definition.name || id,
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

      const result = await runTask({ task }, createInMemoryHostRuntime());

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

      const result = await runTask({ task }, createInMemoryHostRuntime());

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

      const result = await runTask({ task }, createInMemoryHostRuntime());

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

      const result = await runTask({ task }, createInMemoryHostRuntime());

      assertEquals(result.success, false);
      assertEquals(result.error, "async failure");
    });

    it("should fail without invoking the task when injected project env is malformed", async () => {
      let invoked = false;
      const task = makeTask({
        run: () => {
          invoked = true;
          return null;
        },
      });

      const host = createInMemoryHostRuntime({
        env: { VERYFRONT_TASK_ENV_JSON: "not-json" },
      });
      const result = await runTask({ task }, host);

      assertEquals(invoked, false);
      assertEquals(result.success, false);
      assertEquals(result.error?.includes("VERYFRONT_TASK_ENV_JSON"), true);
    });

    it("should pass config to task context", async () => {
      let receivedConfig: Record<string, unknown> = {};
      const task = makeTask({
        run: (ctx) => {
          receivedConfig = ctx.config;
          return null;
        },
      });

      await runTask(
        { task, config: { key: "value" } },
        createInMemoryHostRuntime(),
      );

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

      await runTask(
        { task, projectId: "proj-123" },
        createInMemoryHostRuntime(),
      );

      assertEquals(receivedProjectId, "proj-123");
    });

    it("should pass environmentId to task context", async () => {
      let receivedEnvironmentId: string | undefined;
      const task = makeTask({
        run: (ctx) => {
          receivedEnvironmentId = ctx.environmentId;
          return null;
        },
      });

      await runTask(
        { task, environmentId: "env-123" },
        createInMemoryHostRuntime(),
      );

      assertEquals(receivedEnvironmentId, "env-123");
    });

    it("should pass a cooperative cancellation signal to the task context", async () => {
      const controller = new AbortController();
      let receivedSignal: AbortSignal | undefined;
      const task = makeTask({
        run: (ctx) => {
          receivedSignal = ctx.signal;
          return null;
        },
      });

      const result = await runTask(
        { task, signal: controller.signal },
        createInMemoryHostRuntime(),
      );

      assertEquals(result.success, true);
      assertStrictEquals(receivedSignal, controller.signal);
    });

    it("should not invoke a task when its cancellation signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort(new Error("cancelled before task start"));
      let invoked = false;
      const task = makeTask({
        run: () => {
          invoked = true;
          return null;
        },
      });

      const result = await runTask(
        { task, signal: controller.signal },
        createInMemoryHostRuntime(),
      );

      assertEquals(invoked, false);
      assertEquals(result.success, false);
      assertEquals(result.error, "cancelled before task start");
      assertEquals(Number.isInteger(result.durationMs), true);
      assertEquals(result.durationMs >= 0, true);
    });

    it("should merge injected task env into ctx.env without exposing reserved runtime env", async () => {
      let receivedEnv: Record<string, string> = {};
      const task = makeTask({
        run: (ctx) => {
          receivedEnv = ctx.env;
          return null;
        },
      });

      const host = createInMemoryHostRuntime({
        env: {
          VERYFRONT_TASK_ENV_JSON: JSON.stringify({
            SERVICENOW_USERNAME: "automation@example.com",
            AI_GATEWAY_TOKEN: "project-token",
            VERYFRONT_API_TOKEN: "should-be-filtered",
          }),
          VERYFRONT_API_TOKEN: "tenant-token",
          TENANT_TOKEN: "raw-tenant-token",
        },
      });

      await runTask({ task }, host);

      assertEquals(receivedEnv.SERVICENOW_USERNAME, "automation@example.com");
      assertEquals(receivedEnv.AI_GATEWAY_TOKEN, "project-token");
      assertEquals(receivedEnv.VERYFRONT_API_TOKEN, undefined);
      assertEquals(receivedEnv.TENANT_TOKEN, undefined);
      assertEquals(receivedEnv.VERYFRONT_TASK_ENV_JSON, undefined);
    });

    it("should ignore unsafe injected env keys", async () => {
      let receivedEnv: Record<string, string> = {};
      const task = makeTask({
        run: (ctx) => {
          receivedEnv = ctx.env;
          return null;
        },
      });
      const host = createInMemoryHostRuntime({
        env: {
          VERYFRONT_TASK_ENV_JSON:
            '{"SERVICENOW_USERNAME":"automation@example.com","__proto__":"polluted","constructor":"polluted","prototype":"polluted"}',
        },
      });

      await runTask({ task }, host);

      assertEquals(receivedEnv.SERVICENOW_USERNAME, "automation@example.com");
      assertEquals(Object.keys(receivedEnv).includes("__proto__"), false);
      assertEquals(Object.keys(receivedEnv).includes("constructor"), false);
      assertEquals(Object.keys(receivedEnv).includes("prototype"), false);
    });

    it("should apply envAllowlist to injected task env", async () => {
      let receivedEnv: Record<string, string> = {};
      const task = makeTask({
        run: (ctx) => {
          receivedEnv = ctx.env;
          return null;
        },
      });

      const host = createInMemoryHostRuntime({
        env: {
          VERYFRONT_TASK_ENV_JSON: JSON.stringify({
            SERVICENOW_USERNAME: "automation@example.com",
            AI_GATEWAY_TOKEN: "project-token",
            VERYFRONT_API_TOKEN: "should-be-filtered",
          }),
          VERYFRONT_API_TOKEN: "tenant-token",
        },
      });

      await runTask(
        { task, envAllowlist: ["SERVICENOW_USERNAME", "AI_GATEWAY_TOKEN"] },
        host,
      );

      assertEquals(receivedEnv.SERVICENOW_USERNAME, "automation@example.com");
      assertEquals(receivedEnv.AI_GATEWAY_TOKEN, "project-token");
      assertEquals(receivedEnv.VERYFRONT_API_TOKEN, undefined);
      assertEquals(receivedEnv.VERYFRONT_TASK_ENV_JSON, undefined);
    });

    it("should hide platform control env from ctx.env while preserving injected project env", async () => {
      let receivedEnv: Record<string, string> = {};
      const task = makeTask({
        run: (ctx) => {
          receivedEnv = ctx.env;
          return null;
        },
      });

      const host = createInMemoryHostRuntime({
        env: {
          VERYFRONT_PROJECT_API_URL: "https://api.veryfront.com",
          TENANT_BRANCH_ID: "branch-123",
          VERYFRONT_TASK_ENV_JSON: JSON.stringify({
            AI_GATEWAY_TOKEN: "project-token",
            SERVICENOW_PASSWORD: "servicenow-password",
            VERYFRONT_API_TOKEN: "should-be-filtered",
          }),
        },
      });

      await runTask({ task }, host);

      assertEquals(receivedEnv.VERYFRONT_PROJECT_API_URL, undefined);
      assertEquals(receivedEnv.TENANT_BRANCH_ID, undefined);
      assertEquals(receivedEnv.VERYFRONT_API_TOKEN, undefined);
      assertEquals(receivedEnv.AI_GATEWAY_TOKEN, "project-token");
      assertEquals(receivedEnv.SERVICENOW_PASSWORD, "servicenow-password");
    });

    it("should contain thrown values that cannot be converted to strings", async () => {
      const thrown = Object.create(null);
      const task = makeTask({
        run() {
          throw thrown;
        },
      });

      const result = await runTask({ task }, createInMemoryHostRuntime());

      assertEquals(result.success, false);
      assertEquals(result.error, "Unknown error");
    });
  });
});
