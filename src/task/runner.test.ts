import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { runTask, runTaskWithRuntimeEnvironment } from "./runner.ts";
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

    it("snapshots config before asynchronous task execution", async () => {
      let releaseTask!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseTask = resolve;
      });
      const config = { nested: { value: "original" } };
      const task = makeTask({
        async run(ctx) {
          await gate;
          return ctx.config;
        },
      });

      const pending = runTask({ task, config });
      config.nested.value = "changed";
      releaseTask();

      const result = await pending;
      assertEquals(result.result, { nested: { value: "original" } });
    });

    it("gives the task a private mutable config snapshot", async () => {
      const config = { value: "original" };
      const task = makeTask({
        run(ctx) {
          ctx.config.value = "task-owned";
          return ctx.config;
        },
      });

      const result = await runTask({ task, config });

      assertEquals(result.result, { value: "task-owned" });
      assertEquals(config, { value: "original" });
    });

    it("preserves the task definition receiver", async () => {
      const definition: TaskDefinition = {
        name: "receiver-name",
        run() {
          return this.name;
        },
      };

      const result = await runTask({ task: makeTask(definition) });

      assertEquals(result.result, "receiver-name");
    });

    it("rejects accessor-backed options without invoking them", async () => {
      let reads = 0;
      const options = {};
      Object.defineProperty(options, "task", {
        enumerable: true,
        get() {
          reads += 1;
          return makeTask({ run: () => null });
        },
      });

      const error = await assertRejects(
        () => runTask(options as never),
        VeryfrontError,
      );

      assertEquals(error.slug, "invalid-argument");
      assertEquals(reads, 0);
    });

    it("rejects accessor-backed config and decorated allowlists without invoking them", async () => {
      let reads = 0;
      const config = {};
      Object.defineProperty(config, "secret", {
        enumerable: true,
        get() {
          reads += 1;
          return "value";
        },
      });
      const envAllowlist = ["SAFE_KEY"];
      Object.defineProperty(envAllowlist, "extra", {
        enumerable: true,
        get() {
          reads += 1;
          return "value";
        },
      });
      const task = makeTask({ run: () => null });

      await assertRejects(() => runTask({ task, config }), VeryfrontError);
      await assertRejects(() => runTask({ task, envAllowlist }), VeryfrontError);
      assertEquals(reads, 0);
    });

    it("rejects oversized and invalid environment allowlist entries before running the task", async () => {
      let taskRuns = 0;
      const task = makeTask({
        run() {
          taskRuns += 1;
          return null;
        },
      });
      const cases: Array<{ allowlist: string[]; slug: string }> = [
        { allowlist: new Array(10_001).fill("SAFE_KEY"), slug: "invalid-argument" },
        { allowlist: ["BAD-NAME"], slug: "config-invalid" },
        { allowlist: ["x".repeat(257)], slug: "config-invalid" },
        { allowlist: ["SAFE\0KEY"], slug: "config-invalid" },
      ];

      for (const { allowlist, slug } of cases) {
        const error = await assertRejects(
          () =>
            runTaskWithRuntimeEnvironment(
              { task, envAllowlist: allowlist },
              { SAFE_KEY: "value" },
            ),
          VeryfrontError,
        );
        assertEquals(error.slug, slug);
      }

      assertEquals(taskRuns, 0);
    });

    it("rejects blank wrapper names and unsafe context identifiers", async () => {
      const task = makeTask({ run: () => null });
      task.name = "   ";

      await assertRejects(() => runTask({ task }), VeryfrontError);

      task.name = "Safe task";
      await assertRejects(
        () => runTask({ task, projectId: "spoof\u202Eproject" }),
        VeryfrontError,
      );
    });

    it("returns bounded redacted single-line task failures", async () => {
      const task = makeTask({
        run() {
          throw new Error(
            `Request failed with token=super-secret\nspoof\u202Etxt${"x".repeat(8_000)}`,
          );
        },
      });

      const result = await runTask({ task });

      assertEquals(result.success, false);
      assertStringIncludes(result.error ?? "", "token=[REDACTED]");
      assertEquals(result.error?.includes("super-secret"), false);
      assertEquals(result.error?.includes("\u202E"), false);
      assertEquals(result.error?.includes("\n"), false);
      assertEquals((result.error?.length ?? 0) <= 4_096, true);
    });

    it("redacts local filesystem paths from task failures", async () => {
      const task = makeTask({
        run() {
          throw new Error(
            "Failed at /srv/private/project/tasks/sync.ts and C:\\Users\\developer\\project\\tasks\\sync.ts",
          );
        },
      });

      const result = await runTask({ task });

      assertEquals(result.success, false);
      assertEquals(result.error, "Failed at <LOCAL_PATH> and <LOCAL_PATH>");
    });

    it("does not invoke accessors on thrown failure objects", async () => {
      let reads = 0;
      const failure = {};
      Object.defineProperty(failure, "message", {
        enumerable: true,
        get() {
          reads += 1;
          return "sensitive";
        },
      });
      const task = makeTask({
        run() {
          throw failure;
        },
      });

      const result = await runTask({ task });

      assertEquals(result.error, "Task execution failed.");
      assertEquals(reads, 0);
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

    it("should pass environmentId to task context", async () => {
      let receivedEnvironmentId: string | undefined;
      const task = makeTask({
        run: (ctx) => {
          receivedEnvironmentId = ctx.environmentId;
          return null;
        },
      });

      await runTask({ task, environmentId: "env-123" });

      assertEquals(receivedEnvironmentId, "env-123");
    });

    it("uses an explicit environment snapshot for isolated task execution", async () => {
      let receivedEnv: Record<string, string> = {};
      const task = makeTask({
        run: (ctx) => {
          receivedEnv = ctx.env;
          return null;
        },
      });

      await runTaskWithRuntimeEnvironment(
        { task, envAllowlist: ["PROJECT_VALUE", "VERYFRONT_API_TOKEN"] },
        {
          PROJECT_VALUE: "project-value",
          VERYFRONT_API_TOKEN: "must-be-filtered",
        },
      );

      assertEquals(receivedEnv, { PROJECT_VALUE: "project-value" });
    });

    it("should merge injected task env into ctx.env without exposing reserved runtime env", async () => {
      let receivedEnv: Record<string, string> = {};
      const originalTaskEnvJson = Deno.env.get("VERYFRONT_TASK_ENV_JSON");
      const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
      const originalTenantToken = Deno.env.get("TENANT_TOKEN");
      const task = makeTask({
        run: (ctx) => {
          receivedEnv = ctx.env;
          return null;
        },
      });

      try {
        Deno.env.set(
          "VERYFRONT_TASK_ENV_JSON",
          JSON.stringify({
            SERVICENOW_USERNAME: "automation@example.com",
            AI_GATEWAY_TOKEN: "project-token",
            VERYFRONT_API_TOKEN: "should-be-filtered",
          }),
        );
        Deno.env.set("VERYFRONT_API_TOKEN", "tenant-token");
        Deno.env.set("TENANT_TOKEN", "raw-tenant-token");

        await runTask({ task });
      } finally {
        if (originalTaskEnvJson === undefined) {
          Deno.env.delete("VERYFRONT_TASK_ENV_JSON");
        } else {
          Deno.env.set("VERYFRONT_TASK_ENV_JSON", originalTaskEnvJson);
        }

        if (originalApiToken === undefined) {
          Deno.env.delete("VERYFRONT_API_TOKEN");
        } else {
          Deno.env.set("VERYFRONT_API_TOKEN", originalApiToken);
        }

        if (originalTenantToken === undefined) {
          Deno.env.delete("TENANT_TOKEN");
        } else {
          Deno.env.set("TENANT_TOKEN", originalTenantToken);
        }
      }

      assertEquals(receivedEnv.SERVICENOW_USERNAME, "automation@example.com");
      assertEquals(receivedEnv.AI_GATEWAY_TOKEN, "project-token");
      assertEquals(receivedEnv.VERYFRONT_API_TOKEN, undefined);
      assertEquals(receivedEnv.TENANT_TOKEN, undefined);
      assertEquals(receivedEnv.VERYFRONT_TASK_ENV_JSON, undefined);
    });

    it("should ignore unsafe injected env keys", async () => {
      let receivedEnv: Record<string, string> = {};
      const originalTaskEnvJson = Deno.env.get("VERYFRONT_TASK_ENV_JSON");
      const task = makeTask({
        run: (ctx) => {
          receivedEnv = ctx.env;
          return null;
        },
      });
      try {
        Deno.env.set(
          "VERYFRONT_TASK_ENV_JSON",
          '{"SERVICENOW_USERNAME":"automation@example.com","__proto__":"polluted","constructor":"polluted","prototype":"polluted"}',
        );

        await runTask({ task });
      } finally {
        if (originalTaskEnvJson === undefined) {
          Deno.env.delete("VERYFRONT_TASK_ENV_JSON");
        } else {
          Deno.env.set("VERYFRONT_TASK_ENV_JSON", originalTaskEnvJson);
        }
      }

      assertEquals(receivedEnv.SERVICENOW_USERNAME, "automation@example.com");
      assertEquals(Object.keys(receivedEnv).includes("__proto__"), false);
      assertEquals(Object.keys(receivedEnv).includes("constructor"), false);
      assertEquals(Object.keys(receivedEnv).includes("prototype"), false);
    });

    it("should apply envAllowlist to injected task env", async () => {
      let receivedEnv: Record<string, string> = {};
      const originalTaskEnvJson = Deno.env.get("VERYFRONT_TASK_ENV_JSON");
      const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
      const task = makeTask({
        run: (ctx) => {
          receivedEnv = ctx.env;
          return null;
        },
      });

      try {
        Deno.env.set(
          "VERYFRONT_TASK_ENV_JSON",
          JSON.stringify({
            SERVICENOW_USERNAME: "automation@example.com",
            AI_GATEWAY_TOKEN: "project-token",
            VERYFRONT_API_TOKEN: "should-be-filtered",
          }),
        );
        Deno.env.set("VERYFRONT_API_TOKEN", "tenant-token");

        await runTask({ task, envAllowlist: ["SERVICENOW_USERNAME", "AI_GATEWAY_TOKEN"] });
      } finally {
        if (originalTaskEnvJson === undefined) {
          Deno.env.delete("VERYFRONT_TASK_ENV_JSON");
        } else {
          Deno.env.set("VERYFRONT_TASK_ENV_JSON", originalTaskEnvJson);
        }

        if (originalApiToken === undefined) {
          Deno.env.delete("VERYFRONT_API_TOKEN");
        } else {
          Deno.env.set("VERYFRONT_API_TOKEN", originalApiToken);
        }
      }

      assertEquals(receivedEnv.SERVICENOW_USERNAME, "automation@example.com");
      assertEquals(receivedEnv.AI_GATEWAY_TOKEN, "project-token");
      assertEquals(receivedEnv.VERYFRONT_API_TOKEN, undefined);
      assertEquals(receivedEnv.VERYFRONT_TASK_ENV_JSON, undefined);
    });

    it("should hide platform control env from ctx.env while preserving injected project env", async () => {
      let receivedEnv: Record<string, string> = {};
      const originalProjectApiUrl = Deno.env.get("VERYFRONT_PROJECT_API_URL");
      const originalBranchId = Deno.env.get("TENANT_BRANCH_ID");
      const originalTaskEnvJson = Deno.env.get("VERYFRONT_TASK_ENV_JSON");
      const task = makeTask({
        run: (ctx) => {
          receivedEnv = ctx.env;
          return null;
        },
      });

      try {
        Deno.env.set("VERYFRONT_PROJECT_API_URL", "https://api.veryfront.com");
        Deno.env.set("TENANT_BRANCH_ID", "branch-123");
        Deno.env.set(
          "VERYFRONT_TASK_ENV_JSON",
          JSON.stringify({
            AI_GATEWAY_TOKEN: "project-token",
            SERVICENOW_PASSWORD: "servicenow-password",
            VERYFRONT_API_TOKEN: "should-be-filtered",
          }),
        );

        await runTask({ task });
      } finally {
        if (originalProjectApiUrl === undefined) {
          Deno.env.delete("VERYFRONT_PROJECT_API_URL");
        } else {
          Deno.env.set("VERYFRONT_PROJECT_API_URL", originalProjectApiUrl);
        }

        if (originalBranchId === undefined) {
          Deno.env.delete("TENANT_BRANCH_ID");
        } else {
          Deno.env.set("TENANT_BRANCH_ID", originalBranchId);
        }

        if (originalTaskEnvJson === undefined) {
          Deno.env.delete("VERYFRONT_TASK_ENV_JSON");
        } else {
          Deno.env.set("VERYFRONT_TASK_ENV_JSON", originalTaskEnvJson);
        }
      }

      assertEquals(receivedEnv.VERYFRONT_PROJECT_API_URL, undefined);
      assertEquals(receivedEnv.TENANT_BRANCH_ID, undefined);
      assertEquals(receivedEnv.VERYFRONT_API_TOKEN, undefined);
      assertEquals(receivedEnv.AI_GATEWAY_TOKEN, "project-token");
      assertEquals(receivedEnv.SERVICENOW_PASSWORD, "servicenow-password");
    });
  });
});
