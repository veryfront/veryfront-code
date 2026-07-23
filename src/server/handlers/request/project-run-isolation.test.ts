import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { runWithExactSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { WorkerPool } from "#veryfront/security/sandbox/worker-pool.ts";
import type {
  ExecuteProjectRunRequest,
  WorkerResponse,
} from "#veryfront/security/sandbox/worker-types.ts";
import type { HandlerContext } from "../types.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import { executeIsolatedProjectRun } from "./project-run-isolation.ts";

const HOST_CANARY = "__veryfront_project_run_host_canary";
let workerPool: WorkerPool;
const isolationDependencies = { getWorkerPool: () => workerPool };

describe("executeIsolatedProjectRun", () => {
  beforeAll(() => {
    workerPool = new WorkerPool();
  });

  afterAll(async () => {
    workerPool.shutdown();
    await stopEsbuild();
  });

  it("bundles and executes a remote task without evaluating its module in the host", async () => {
    const adapter = createMockAdapter();
    const hostCanaryPath = await Deno.makeTempFile();
    await Deno.writeTextFile(hostCanaryPath, "host-only");
    adapter.fs.files.set(
      "/project/tasks/sync-calendar.ts",
      `
        globalThis[${JSON.stringify(HOST_CANARY)}] = "evaluated";
        export default {
          run: async (ctx) => {
            let hostFileReadable = true;
            try {
              await Deno.readTextFile(String(ctx.config.hostCanaryPath));
            } catch {
              hostFileReadable = false;
            }
            return {
              projectId: ctx.projectId,
              configured: ctx.config.enabled,
              hostFileReadable,
            };
          },
        };
      `,
    );
    const hostGlobal = globalThis as Record<string, unknown>;
    delete hostGlobal[HOST_CANARY];
    const ctx = {
      projectDir: "/project",
      projectId: "project-1",
      projectSlug: "project-one",
      isLocalProject: false,
      debug: false,
      adapter,
      config: {},
    } as unknown as HandlerContext;

    try {
      const result = await runWithExactSourceIntegrationPolicy(
        { schemaVersion: 1, mode: "unrestricted" },
        () =>
          executeIsolatedProjectRun({
            request: {
              runId: "run_task_isolation",
              kind: "task",
              target: "task:sync-calendar",
              projectId: "project-1",
              config: { enabled: true, hostCanaryPath },
            },
            ctx,
            req: new Request("https://project-one.example/run", { method: "POST" }),
          }, isolationDependencies),
      );

      assertEquals(result.success, true);
      assertEquals(result.result, {
        projectId: "project-1",
        configured: true,
        hostFileReadable: false,
      });
      assertEquals(hostGlobal[HOST_CANARY], undefined);
      assertEquals(workerPool.getStats().poolSize, 0);
    } finally {
      delete hostGlobal[HOST_CANARY];
      await Deno.remove(hostCanaryPath);
    }
  });

  it("loads an external eval dataset from project source inside the isolated run", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set(
      "/project/evals/worker-smoke.eval.ts",
      `
        import { datasets, evalAgent } from "veryfront/eval";
        globalThis[${JSON.stringify(HOST_CANARY)}] = "evaluated";
        export default evalAgent({
          id: "eval:worker-smoke",
          target: "agent:unused",
          dataset: datasets.json("data/examples.json"),
        });
      `,
    );
    adapter.fs.files.set("/project/data/examples.json", "[]");
    const hostGlobal = globalThis as Record<string, unknown>;
    delete hostGlobal[HOST_CANARY];
    const ctx = {
      projectDir: "/project",
      projectId: "project-1",
      projectSlug: "project-one",
      isLocalProject: false,
      debug: false,
      adapter,
      config: {},
    } as unknown as HandlerContext;

    try {
      const result = await runWithExactSourceIntegrationPolicy(
        { schemaVersion: 1, mode: "unrestricted" },
        () =>
          executeIsolatedProjectRun({
            request: {
              runId: "run_eval_isolation",
              kind: "eval",
              target: "eval:worker-smoke",
              projectId: "project-1",
            },
            ctx,
            req: new Request("https://project-one.example/run", { method: "POST" }),
            evalAgentAdapter: {
              endpoint: "https://project-one.example/api/ag-ui",
              authToken: "runtime-token",
              projectId: "project-1",
            },
          }, isolationDependencies),
      );

      assertEquals(result.success, true);
      assertEquals((result.result as { definitionId?: string }).definitionId, "eval:worker-smoke");
      assertEquals((result.result as { records?: unknown[] }).records, []);
      assertEquals(hostGlobal[HOST_CANARY], undefined);
      assertEquals(workerPool.getStats().poolSize, 0);
    } finally {
      delete hostGlobal[HOST_CANARY];
    }
  });

  it("stops before source discovery when the request is already aborted", async () => {
    const adapter = createMockAdapter();
    let sourceReads = 0;
    const readFile = adapter.fs.readFile.bind(adapter.fs);
    adapter.fs.readFile = (path) => {
      sourceReads++;
      return readFile(path);
    };
    const ctx = {
      projectDir: "/project",
      projectId: "project-1",
      projectSlug: "project-one",
      isLocalProject: false,
      adapter,
      config: {},
    } as unknown as HandlerContext;
    const controller = new AbortController();
    controller.abort();

    await assertRejects(
      () =>
        runWithExactSourceIntegrationPolicy(
          { schemaVersion: 1, mode: "unrestricted" },
          () =>
            executeIsolatedProjectRun({
              request: {
                runId: "run_task_aborted",
                kind: "task",
                target: "task:sync-calendar",
                projectId: "project-1",
              },
              ctx,
              req: new Request("https://project-one.example/run", {
                method: "POST",
                signal: controller.signal,
              }),
            }, isolationDependencies),
        ),
      DOMException,
      "aborted",
    );
    assertEquals(sourceReads, 0);
  });

  it("evicts an in-flight project worker when the request is aborted", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set(
      "/project/tasks/never-finishes.ts",
      `
        export default {
          run: async () => await new Promise(() => {}),
        };
      `,
    );
    const ctx = {
      projectDir: "/project",
      projectId: "project-1",
      projectSlug: "project-one",
      isLocalProject: false,
      adapter,
      config: {},
    } as unknown as HandlerContext;
    const controller = new AbortController();
    let markExecutionStarted!: () => void;
    const executionStarted = new Promise<void>((resolve) => {
      markExecutionStarted = resolve;
    });
    const abortDependencies = {
      getWorkerPool: () => ({
        execute: (...args: Parameters<WorkerPool["execute"]>) => {
          markExecutionStarted();
          return workerPool.execute(...args);
        },
        evictWorker: (key: string) => workerPool.evictWorker(key),
      }),
    };
    const pending = runWithExactSourceIntegrationPolicy(
      { schemaVersion: 1, mode: "unrestricted" },
      () =>
        executeIsolatedProjectRun({
          request: {
            runId: "run_task_aborted_in_flight",
            kind: "task",
            target: "task:never-finishes",
            projectId: "project-1",
          },
          ctx,
          req: new Request("https://project-one.example/run", {
            method: "POST",
            signal: controller.signal,
          }),
        }, abortDependencies),
    );

    await executionStarted;
    controller.abort();
    await assertRejects(() => pending, DOMException, "aborted");
    assertEquals(workerPool.getStats().poolSize, 0);
  });

  it("replaces host source paths with a fixed virtual root before Worker execution", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set(
      "/tenant-source-canary/tasks/sync-calendar.ts",
      [
        'import { ok } from "../lib/result.ts";',
        "export default { run: async () => ({ ok }) };",
      ].join("\n"),
    );
    adapter.fs.files.set("/tenant-source-canary/lib/result.ts", "export const ok = true;");
    const ctx = {
      projectDir: "/tenant-source-canary",
      projectId: "project-1",
      projectSlug: "project-one",
      isLocalProject: false,
      adapter,
      config: {},
    } as unknown as HandlerContext;
    let capturedRequest: ExecuteProjectRunRequest | undefined;
    const evicted: string[] = [];
    const dependencies = {
      getWorkerPool: () => ({
        execute: async (
          _key: string,
          readPaths: string[],
          request: ExecuteProjectRunRequest,
        ): Promise<WorkerResponse> => {
          assertEquals(readPaths, []);
          capturedRequest = request;
          return {
            type: "project-run-result",
            id: request.id,
            result: { success: true, result: { ok: true }, durationMs: 1 },
          };
        },
        evictWorker: (key: string) => evicted.push(key),
      }),
    };

    const result = await runWithExactSourceIntegrationPolicy(
      { schemaVersion: 1, mode: "unrestricted" },
      () =>
        executeIsolatedProjectRun({
          request: {
            runId: "run_task_virtual_paths",
            kind: "task",
            target: "task:sync-calendar",
            projectId: "project-1",
          },
          ctx,
          req: new Request("https://project-one.example/run", { method: "POST" }),
        }, dependencies),
    );

    assertEquals(result.success, true);
    assertEquals(capturedRequest?.projectDir, "/project");
    assertEquals(capturedRequest?.modules[0]?.file, "file:///project/tasks/sync-calendar.ts");
    assertEquals(capturedRequest?.modules[0]?.dir, "/project/tasks");
    assertEquals(JSON.stringify(capturedRequest).includes("tenant-source-canary"), false);
    assertEquals(evicted.length, 1);
  });

  it("evicts the ephemeral Worker when execution rejects", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set(
      "/project/tasks/fails.ts",
      "export default { run: async () => ({ ok: true }) };",
    );
    const ctx = {
      projectDir: "/project",
      projectId: "project-1",
      projectSlug: "project-one",
      isLocalProject: false,
      adapter,
      config: {},
    } as unknown as HandlerContext;
    const evicted: string[] = [];
    const dependencies = {
      getWorkerPool: () => ({
        execute: (): Promise<WorkerResponse> => Promise.reject(new Error("worker canary")),
        evictWorker: (key: string) => evicted.push(key),
      }),
    };

    await assertRejects(
      () =>
        runWithExactSourceIntegrationPolicy(
          { schemaVersion: 1, mode: "unrestricted" },
          () =>
            executeIsolatedProjectRun({
              request: {
                runId: "run_task_worker_failure",
                kind: "task",
                target: "task:fails",
                projectId: "project-1",
              },
              ctx,
              req: new Request("https://project-one.example/run", { method: "POST" }),
            }, dependencies),
        ),
      Error,
      "Isolated project run execution failed",
    );
    assertEquals(evicted.length, 1);
  });
});
