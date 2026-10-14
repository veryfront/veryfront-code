import "#veryfront/schemas/_test-setup.ts";
import { createInMemoryHostRuntime } from "#veryfront/platform/compat/process.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RetryableError } from "./errors.ts";
import { type RunnableTask, runTask, type TaskScratchFs } from "./runner.ts";
import type { TaskContext, TaskDefinition } from "./types.ts";

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

    it("should omit runId from local task context", async () => {
      let hasRunId = true;
      const task = makeTask({
        run: (ctx) => {
          hasRunId = Object.hasOwn(ctx, "runId");
          return null;
        },
      });

      await runTask({ task }, createInMemoryHostRuntime());

      assertEquals(hasRunId, false);
    });

    it("should pass runId to task context", async () => {
      let receivedRunId: string | undefined;
      const task = makeTask({
        run: (ctx) => {
          receivedRunId = ctx.runId;
          return null;
        },
      });

      await runTask(
        { task, runId: "run-123" },
        createInMemoryHostRuntime(),
      );

      assertEquals(receivedRunId, "run-123");
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

    // veryfront/veryfront-issue-inbox#2100
    it("exposes the 1-based attempt number as ctx.attempt, defaulting to 1", async () => {
      const attempts: Array<number | undefined> = [];
      const task = makeTask({
        run: (ctx) => {
          attempts.push(ctx.attempt);
          return null;
        },
      });

      await runTask({ task }, createInMemoryHostRuntime());
      await runTask({ task, attempt: 3 }, createInMemoryHostRuntime());

      assertEquals(attempts, [1, 3]);
    });

    it("reports a thrown RetryableError as a retryable failure and any other error as final", async () => {
      const retryable = await runTask(
        {
          task: makeTask({
            run: () => {
              throw new RetryableError("upstream returned 503");
            },
          }),
        },
        createInMemoryHostRuntime(),
      );
      const final = await runTask(
        {
          task: makeTask({
            run: () => {
              throw Object.assign(new Error("bad input"), { retryable: true });
            },
          }),
        },
        createInMemoryHostRuntime(),
      );

      assertEquals(retryable.success, false);
      assertEquals(retryable.error, "upstream returned 503");
      assertEquals(retryable.retryable, true);
      assertEquals(final.success, false);
      assertEquals(final.retryable, undefined);
    });

    it("contains thrown retry brand accessors and proxy descriptor traps", async () => {
      const failure = new Error("original failure");
      Object.defineProperty(failure, Symbol.for("veryfront.task.RetryableError"), {
        get() {
          throw new Error("accessor failure");
        },
      });
      const proxy = new Proxy(new Error("original failure"), {
        getOwnPropertyDescriptor() {
          throw new Error("proxy failure");
        },
      });
      for (
        const [thrown, message] of [[failure, "original failure"], [
          proxy,
          "Error: original failure",
        ]] as const
      ) {
        const result = await runTask({
          task: makeTask({
            run: () => {
              throw thrown;
            },
          }),
        }, createInMemoryHostRuntime());
        assertEquals(result.success, false);
        assertEquals(result.error, message);
        assertEquals(result.retryable, undefined);
      }
    });

    it("recognizes a RetryableError thrown by another copy of the framework", async () => {
      // A project bundle can carry its own copy of veryfront/task, so instanceof alone is not enough.
      const foreignBrand = Symbol.for("veryfront.task.RetryableError");
      class ForeignRetryableError extends Error {
        readonly [foreignBrand] = true;
      }
      const result = await runTask(
        {
          task: makeTask({
            run: () => {
              throw new ForeignRetryableError("rate limited");
            },
          }),
        },
        createInMemoryHostRuntime(),
      );

      assertEquals(result.retryable, true);
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

    it("should not invoke a task cancelled while its schemas are being checked", async () => {
      const controller = new AbortController();
      let invoked = false;
      const task = makeTask({
        inputSchema: { type: "object" },
        run: () => {
          invoked = true;
          return null;
        },
      });

      const pending = runTask(
        { task, input: {}, signal: controller.signal },
        createInMemoryHostRuntime(),
      );
      controller.abort(new Error("cancelled during schema checks"));
      const result = await pending;

      assertEquals(invoked, false);
      assertEquals(result.success, false);
      assertEquals(result.error, "cancelled during schema checks");
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

    it("classifies a read-only filesystem write as TASK_FILESYSTEM_READ_ONLY", async () => {
      const task = makeTask({
        run: () => {
          throw new Error("Read-only file system (os error 30): mkdir '.data/core'");
        },
      });

      const result = await runTask({ task }, createInMemoryHostRuntime());

      assertEquals(result.success, false);
      assertEquals(result.errorCode, "TASK_FILESYSTEM_READ_ONLY");
      assertEquals(result.error?.startsWith("Read-only file system (os error 30)"), true);
      assertEquals(result.error?.includes("ctx.dataDir"), true);
    });

    it("classifies a Node EROFS error as TASK_FILESYSTEM_READ_ONLY", async () => {
      const task = makeTask({
        run: () => {
          throw Object.assign(new Error("EROFS: read-only file system, mkdir '.data'"), {
            code: "EROFS",
          });
        },
      });

      const result = await runTask({ task }, createInMemoryHostRuntime());

      assertEquals(result.errorCode, "TASK_FILESYSTEM_READ_ONLY");
    });

    it("returns a stable code when the thrown error's own fields cannot be read", async () => {
      const task = makeTask({
        run: () => {
          const error = new Error("boom");
          Object.defineProperty(error, "code", {
            get() {
              throw new Error("hostile code getter");
            },
          });
          throw error;
        },
      });

      const result = await runTask({ task }, createInMemoryHostRuntime());

      assertEquals(result.success, false);
      assertEquals(result.errorCode, "TASK_EXECUTION_FAILED");
    });

    it("keeps the scratch directory path out of the failure text", async () => {
      let seen: string | undefined;
      const task = makeTask({
        run: (ctx: TaskContext) => {
          seen = ctx.dataDir;
          throw new Error(`ENOENT: no such file, open '${ctx.dataDir}/missing.json'`);
        },
      });

      const result = await runTask({ task }, createInMemoryHostRuntime());

      assertEquals(typeof seen, "string");
      assertEquals(result.error?.includes(seen!), false);
      assertEquals(result.error, "ENOENT: no such file, open '<task data dir>/missing.json'");
    });

    it("returns a stable code when the thrown value's descriptors cannot be read", async () => {
      const task = makeTask({
        run: () => {
          throw new Proxy({}, {
            getOwnPropertyDescriptor() {
              throw new Error("hostile descriptor trap");
            },
          });
        },
      });

      const result = await runTask({ task }, createInMemoryHostRuntime());

      assertEquals(result.success, false);
      assertEquals(result.errorCode, "TASK_EXECUTION_FAILED");
    });

    it("runs the task without ctx.dataDir when the data directory cannot be created", async () => {
      let seen: unknown = "unset";
      let removeCalls = 0;
      const task = makeTask({
        run: (ctx: TaskContext) => {
          seen = ctx.dataDir;
          return "pure";
        },
      });
      const scratchFs: TaskScratchFs = {
        makeTempDir: () =>
          Promise.reject(Object.assign(new Error("Permission denied: mkdtemp '/srv/tmp/x'"), {
            code: "EACCES",
          })),
        remove: () => {
          removeCalls++;
          return Promise.resolve();
        },
      };

      const result = await runTask({ task }, createInMemoryHostRuntime(), scratchFs);

      assertEquals(result.success, true);
      assertEquals(result.result, "pure");
      assertEquals(seen, undefined);
      assertEquals(removeCalls, 0);
    });

    it("never adopts or removes a path that is not a task data directory", async () => {
      let seen: unknown = "unset";
      const removed: string[] = [];
      const task = makeTask({
        run: (ctx: TaskContext) => {
          seen = ctx.dataDir;
          return "ok";
        },
      });
      const scratchFs: TaskScratchFs = {
        makeTempDir: () => Promise.resolve("/home/dev/project"),
        remove: (path) => {
          removed.push(path);
          return Promise.resolve();
        },
      };

      const result = await runTask({ task }, createInMemoryHostRuntime(), scratchFs);

      assertEquals(result.success, true);
      assertEquals(seen, undefined);
      assertEquals(removed, []);
    });

    it("keeps a successful result when the data directory cannot be removed", async () => {
      const removed: string[] = [];
      const task = makeTask({ run: () => "done" });
      const scratchFs: TaskScratchFs = {
        makeTempDir: () => Promise.resolve("/scratch/veryfront-task-1"),
        remove: (path) => {
          removed.push(path);
          return Promise.reject(new Error(`EBUSY: resource busy, rmdir '${path}'`));
        },
      };

      const result = await runTask({ task }, createInMemoryHostRuntime(), scratchFs);

      assertEquals(result.success, true);
      assertEquals(result.result, "done");
      assertEquals(removed, ["/scratch/veryfront-task-1"]);
    });

    it("gives any other thrown error the stable TASK_EXECUTION_FAILED code", async () => {
      const task = makeTask({
        run: () => {
          throw new Error("boom");
        },
      });

      const result = await runTask({ task }, createInMemoryHostRuntime());

      assertEquals(result.errorCode, "TASK_EXECUTION_FAILED");
      assertEquals(result.error, "boom");
    });
  });
});
