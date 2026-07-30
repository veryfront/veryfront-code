import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MemoryBackend } from "../../../src/workflow/backends/memory.ts";
import type {
  RunExecutionConfig,
  RunExecutionInfo,
  RunExecutor,
} from "../../../src/workflow/worker/executors/types.ts";
import type {
  ManagerStats,
  WorkflowRunManagerConfig,
} from "../../../src/workflow/worker/run-manager.ts";
import { startWorkflowWorker, type WorkerOptions } from "./command.ts";

const DEFAULT_OPTIONS: WorkerOptions = {
  concurrency: 3,
  pollInterval: 5_000,
  stalledThreshold: 60_000,
  executor: "process",
  entrypoint: undefined,
  projectDir: undefined,
  debug: false,
};

class FakeExecutor implements RunExecutor {
  createRunExecution(config: RunExecutionConfig): Promise<string> {
    return Promise.resolve(config.executionId);
  }

  getRunExecutionStatus(_executionId: string): Promise<RunExecutionInfo | null> {
    return Promise.resolve(null);
  }

  listRunExecutions(_managerId: string): Promise<RunExecutionInfo[]> {
    return Promise.resolve([]);
  }

  deleteRunExecution(_executionId: string): Promise<void> {
    return Promise.resolve();
  }
}

function createManager(
  events: string[],
  config: WorkflowRunManagerConfig,
) {
  let status: ManagerStats["status"] = "idle";
  const stats = (): ManagerStats => ({
    status,
    managerId: "manager-test",
    pollCount: 0,
    executionsCreated: 0,
    executionsCompleted: 0,
    executionsFailed: 0,
    activeExecutions: 0,
  });

  return {
    config,
    async start() {
      events.push("manager:start");
      status = "running";
    },
    async stop() {
      events.push("manager:stop");
      status = "stopped";
    },
    getManagerId: () => "manager-test",
    getStats: stats,
  };
}

describe("commands/worker/command", () => {
  it("composes provider resources before starting and owns shutdown in dependency order", async () => {
    const events: string[] = [];
    const backend = new MemoryBackend();
    const originalInitialize = backend.initialize.bind(backend);
    const originalDestroy = backend.destroy.bind(backend);
    backend.initialize = () => {
      events.push("backend:initialize");
      return originalInitialize();
    };
    backend.destroy = () => {
      events.push("backend:destroy");
      return originalDestroy();
    };

    let executorOptions: unknown;
    let managerConfig: WorkflowRunManagerConfig | undefined;
    const runtime = await startWorkflowWorker(
      { ...DEFAULT_OPTIONS, entrypoint: "./src/worker-entrypoint.ts" },
      { projectDir: "/project", config: { extensions: [] } },
      {
        orchestrateExtensions: (options) => {
          events.push("extensions:setup");
          assertEquals(options.projectDir, "/project");
          return Promise.resolve({
            teardownAll: () => {
              events.push("extensions:teardown");
              return Promise.resolve();
            },
          });
        },
        createDistributedWorkflowWorkerResources: () => {
          events.push("provider:resources");
          return {
            backend,
            environment: { DISTRIBUTED_STORE_URL: "protocol://store.internal" },
          };
        },
        createProcessRunExecutor: (options) => {
          events.push("executor:create");
          executorOptions = options;
          return new FakeExecutor();
        },
        createWorkflowRunManager: (config) => {
          events.push("manager:create");
          managerConfig = config;
          return createManager(events, config);
        },
      },
    );

    assertEquals(events, [
      "extensions:setup",
      "provider:resources",
      "backend:initialize",
      "executor:create",
      "manager:create",
      "manager:start",
    ]);
    assertEquals(executorOptions, {
      entrypointPath: "./src/worker-entrypoint.ts",
      cwd: "/project",
      debug: false,
    });
    assertStrictEquals(managerConfig?.backend, backend);
    assertEquals(managerConfig?.env, {
      DISTRIBUTED_STORE_URL: "protocol://store.internal",
    });

    await Promise.all([runtime.stop(), runtime.stop()]);
    await runtime.stop();
    assertEquals(events.slice(-3), [
      "manager:stop",
      "backend:destroy",
      "extensions:teardown",
    ]);
    assertEquals(events.filter((event) => event === "manager:stop").length, 1);
    assertEquals(events.filter((event) => event === "backend:destroy").length, 1);
    assertEquals(events.filter((event) => event === "extensions:teardown").length, 1);
  });

  it("fails closed and rolls back when the provider backend lacks worker atomics", async () => {
    const events: string[] = [];
    const backend = new MemoryBackend();
    Object.defineProperty(backend, "claimStalledRun", {
      value: undefined,
      configurable: true,
    });
    backend.destroy = () => {
      events.push("backend:destroy");
      return Promise.resolve();
    };

    await assertRejects(
      () =>
        startWorkflowWorker(
          DEFAULT_OPTIONS,
          { projectDir: "/project", config: { extensions: [] } },
          {
            orchestrateExtensions: () =>
              Promise.resolve({
                teardownAll: () => {
                  events.push("extensions:teardown");
                  return Promise.resolve();
                },
              }),
            createDistributedWorkflowWorkerResources: () => ({
              backend,
              environment: {},
            }),
          },
        ),
      TypeError,
      "atomic workflow worker contract",
    );

    assertEquals(events, ["backend:destroy", "extensions:teardown"]);
  });

  it("retries only cleanup resources that failed", async () => {
    const events: string[] = [];
    const backend = new MemoryBackend();
    let destroyAttempts = 0;
    backend.destroy = () => {
      destroyAttempts++;
      events.push(`backend:destroy:${destroyAttempts}`);
      return destroyAttempts === 1
        ? Promise.reject(new Error("transient backend cleanup failure"))
        : Promise.resolve();
    };

    const runtime = await startWorkflowWorker(
      DEFAULT_OPTIONS,
      { projectDir: "/project", config: { extensions: [] } },
      {
        orchestrateExtensions: () =>
          Promise.resolve({
            teardownAll: () => {
              events.push("extensions:teardown");
              return Promise.resolve();
            },
          }),
        createDistributedWorkflowWorkerResources: () => ({
          backend,
          environment: {},
        }),
        createProcessRunExecutor: () => new FakeExecutor(),
        createWorkflowRunManager: (config) => createManager(events, config),
      },
    );

    await assertRejects(
      () => runtime.stop(),
      AggregateError,
      "Workflow worker cleanup failed",
    );
    await runtime.stop();

    assertEquals(events.filter((event) => event === "manager:stop").length, 1);
    assertEquals(events.filter((event) => event === "extensions:teardown").length, 1);
    assertEquals(destroyAttempts, 2);
  });
});
