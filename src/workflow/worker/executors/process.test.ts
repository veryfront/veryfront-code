import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import type { WorkflowRun } from "../../types.ts";
import { ProcessRunExecutor } from "./process.ts";

const LOCK_ACQUISITION = { duration: 1_000, timeout: 1_000, retryInterval: 10 };

function createRun(): WorkflowRun {
  return {
    id: "run-process-policy",
    workflowId: "workflow-1",
    status: "pending",
    input: {},
    nodeStates: {},
    currentNodes: [],
    context: { input: {} },
    checkpoints: [],
    pendingApprovals: [],
    createdAt: new Date(),
    sourceIntegrationPolicy: normalizeSourceIntegrationPolicy(undefined),
  };
}

describe("workflow/worker/executors/process", () => {
  it("rejects invalid entrypoints, timeouts, and duplicate execution identities", () => {
    assertThrows(
      () => new ProcessRunExecutor({ entrypointPath: "  " }),
      Error,
      "entrypointPath",
    );

    const executor = new ProcessRunExecutor({ entrypointPath: "unused.ts" });
    for (const timeout of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assertThrows(
        () =>
          executor.createRunExecution({
            executionId: `invalid-timeout-${String(timeout)}`,
            run: createRun(),
            managerId: "manager-1",
            timeout,
            env: {},
            lockAcquisition: LOCK_ACQUISITION,
          }),
        Error,
        "execution timeout",
      );
    }

    for (const field of ["duration", "timeout", "retryInterval"] as const) {
      for (const value of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        assertThrows(
          () =>
            executor.createRunExecution({
              executionId: `invalid-lock-${field}-${String(value)}`,
              run: createRun(),
              managerId: "manager-1",
              timeout: 1_000,
              env: {},
              lockAcquisition: { ...LOCK_ACQUISITION, [field]: value },
            }),
          Error,
          field === "retryInterval" ? "lock retry interval" : `lock acquisition ${field}`,
        );
      }
    }

    const activeExecutions = (executor as unknown as {
      activeExecutions: Map<string, unknown>;
    }).activeExecutions;
    activeExecutions.set("duplicate", {});
    assertThrows(
      () =>
        executor.createRunExecution({
          executionId: "duplicate",
          run: createRun(),
          managerId: "manager-1",
          timeout: 1_000,
          env: {},
          lockAcquisition: LOCK_ACQUISITION,
        }),
      Error,
      "already exists",
    );

    for (const terminationGracePeriod of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assertThrows(
        () =>
          new ProcessRunExecutor({
            entrypointPath: "unused.ts",
            terminationGracePeriod,
          }),
        Error,
        "terminationGracePeriod",
      );
    }
  });

  it("rejects a run with no policy snapshot before spawning a process", () => {
    const executor = new ProcessRunExecutor({ entrypointPath: "unused.ts" });
    const { sourceIntegrationPolicy: _sourceIntegrationPolicy, ...missingSnapshot } = createRun();

    assertThrows(
      () =>
        executor.createRunExecution({
          executionId: "execution-1",
          run: missingSnapshot as unknown as WorkflowRun,
          managerId: "manager-1",
          timeout: 1_000,
          env: {},
          lockAcquisition: LOCK_ACQUISITION,
        }),
      Error,
      "source integration policy snapshot",
    );
  });

  it("overwrites injected lock policy environment with validated manager values", async () => {
    const temporaryDirectory = await Deno.makeTempDir({ prefix: "veryfront-process-env-test-" });
    const outputPath = `${temporaryDirectory}/lock-policy.json`;
    const executor = new ProcessRunExecutor({
      command: Deno.execPath(),
      args: [
        "eval",
        `Deno.writeTextFileSync(Deno.env.get("OUTPUT_PATH")!, JSON.stringify({` +
        `duration:Deno.env.get("WORKFLOW_LOCK_DURATION_MS"),` +
        `timeout:Deno.env.get("WORKFLOW_LOCK_ACQUISITION_TIMEOUT_MS"),` +
        `retry:Deno.env.get("WORKFLOW_LOCK_RETRY_INTERVAL_MS")}));`,
      ],
      entrypointPath: "ignored-argument",
      env: {
        OUTPUT_PATH: outputPath,
        WORKFLOW_LOCK_DURATION_MS: "host-injected",
        WORKFLOW_LOCK_ACQUISITION_TIMEOUT_MS: "host-injected",
        WORKFLOW_LOCK_RETRY_INTERVAL_MS: "host-injected",
      },
    });

    try {
      await executor.createRunExecution({
        executionId: "reserved-lock-env",
        run: createRun(),
        managerId: "manager-1",
        timeout: 5_000,
        env: {
          WORKFLOW_LOCK_DURATION_MS: "run-injected",
          WORKFLOW_LOCK_ACQUISITION_TIMEOUT_MS: "run-injected",
          WORKFLOW_LOCK_RETRY_INTERVAL_MS: "run-injected",
        },
        lockAcquisition: LOCK_ACQUISITION,
      });

      const deadline = Date.now() + 5_000;
      while (true) {
        try {
          const actual = JSON.parse(await Deno.readTextFile(outputPath));
          assertEquals(actual, { duration: "1000", timeout: "1000", retry: "10" });
          break;
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
          if (Date.now() >= deadline) throw new Error("Child did not report lock policy env");
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      }
    } finally {
      await executor.destroy();
      await Deno.remove(temporaryDirectory, { recursive: true });
    }
  });

  it("waits for child exit, escalates termination, and closes single-flight", async () => {
    if (Deno.build.os === "windows") return;

    const temporaryDirectory = await Deno.makeTempDir({ prefix: "veryfront-process-test-" });
    const readyPath = `${temporaryDirectory}/ready`;
    try {
      const executor = new ProcessRunExecutor({
        command: Deno.execPath(),
        args: [
          "eval",
          'Deno.writeTextFileSync(Deno.env.get("READY_PATH")!, "ready"); ' +
          'Deno.addSignalListener("SIGTERM", () => {}); setInterval(() => {}, 1_000);',
        ],
        entrypointPath: "ignored-argument",
        terminationGracePeriod: 10,
        env: { READY_PATH: readyPath },
      });
      await executor.createRunExecution({
        executionId: "shutdown-execution",
        run: createRun(),
        managerId: "manager-1",
        timeout: 30_000,
        env: {},
        lockAcquisition: LOCK_ACQUISITION,
      });

      const readyDeadline = Date.now() + 5_000;
      while (true) {
        try {
          await Deno.stat(readyPath);
          break;
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
          if (Date.now() >= readyDeadline) throw new Error("Child process did not become ready");
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      }

      const tracked = (executor as unknown as {
        activeExecutions: Map<string, { completion: Promise<void> }>;
      }).activeExecutions.get("shutdown-execution");
      let exited = false;
      tracked?.completion.then(() => {
        exited = true;
      });

      const firstDestroy = executor.destroy();
      assertEquals(executor.destroy(), firstDestroy);
      await firstDestroy;

      assertEquals(exited, true);
      assertEquals(await executor.getRunExecutionStatus("shutdown-execution"), null);
      assertThrows(
        () =>
          executor.createRunExecution({
            executionId: "after-close",
            run: createRun(),
            managerId: "manager-1",
            timeout: 1_000,
            env: {},
            lockAcquisition: LOCK_ACQUISITION,
          }),
        Error,
        "process executor is closed",
      );
    } finally {
      await Deno.remove(temporaryDirectory, { recursive: true });
    }
  });
});
