import "#veryfront/schemas/_test-setup.ts";
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
