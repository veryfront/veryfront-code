import "#veryfront/schemas/_test-setup.ts";

import { delay } from "#std/async.ts";
import { expect } from "#std/expect.ts";

import { defineSchema } from "#veryfront/schemas/index.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { withEnv } from "#veryfront/testing/deno-compat.ts";
import type { Tool } from "#veryfront/tool";
import { __subscribeLogRecordEmitter, type LogEntry } from "#veryfront/utils/logger/logger.ts";

import { createWorkflowClient, type WorkflowClient } from "../api/workflow-client.ts";
import { MemoryBackend } from "../backends/memory.ts";
import { sequence, step, waitForApproval, workflow } from "../dsl/index.ts";
import type { PendingApproval, RunFilter, WorkflowRun } from "../types.ts";
import { createWorkflowHandler } from "./handler.ts";

class CountingMemoryBackend extends MemoryBackend {
  pendingApprovalReads = 0;

  override getPendingApprovals(runId: string): Promise<PendingApproval[]> {
    this.pendingApprovalReads++;
    return super.getPendingApprovals(runId);
  }
}

class ExplodingMemoryBackend extends MemoryBackend {
  override listRuns(_filter: RunFilter): Promise<WorkflowRun[]> {
    return Promise.reject(new Error("sensitive backend detail"));
  }
}

class GatedActivationMemoryBackend extends MemoryBackend {
  readonly activationRequested = Promise.withResolvers<void>();
  readonly releaseActivation = Promise.withResolvers<void>();

  override async updateRunIfStatusAndWorker(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId: string,
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    if (patch.status === "running" && patch.nodeStates === undefined) {
      this.activationRequested.resolve();
      await this.releaseActivation.promise;
    }
    return await super.updateRunIfStatusAndWorker(
      runId,
      expectedStatuses,
      expectedWorkerId,
      patch,
    );
  }
}

function slowTool(id: string): Tool {
  return {
    id,
    type: "function",
    description: `Slow test tool: ${id}`,
    inputSchema: defineSchema((v) => v.object({}).passthrough())(),
    execute: (_input, context) =>
      new Promise((resolve, reject) => {
        const signal = context?.abortSignal;
        const timeoutId = setTimeout(() => {
          signal?.removeEventListener("abort", abort);
          resolve({ ok: true });
        }, 5_000);
        const abort = () => {
          clearTimeout(timeoutId);
          reject(signal?.reason);
        };
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      }),
  };
}

function passthroughTool(id: string): Tool {
  return {
    id,
    type: "function",
    description: `Test tool: ${id}`,
    inputSchema: defineSchema((v) => v.object({}).passthrough())(),
    execute: (input) => Promise.resolve({ ok: true, input }),
  };
}

function failOnceTool(id: string): Tool {
  let calls = 0;
  return {
    id,
    type: "function",
    description: `Fail-once test tool: ${id}`,
    inputSchema: defineSchema((v) => v.object({}).passthrough())(),
    execute: () => {
      calls++;
      if (calls === 1) throw new Error("first attempt failed");
      return Promise.resolve({ ok: true });
    },
  };
}

function get(path: string): Request {
  return new Request(`http://localhost:3000${path}`);
}

function post(path: string, body?: unknown): Request {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function postRaw(path: string, body: string): Request {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

function authorizedHandler(
  client: WorkflowClient,
  options: { basePath?: string } = {},
): ReturnType<typeof createWorkflowHandler> {
  return createWorkflowHandler(client, { ...options, authorize: () => "tester" });
}

describe("createWorkflowHandler", () => {
  let client: WorkflowClient;
  let handlers: ReturnType<typeof createWorkflowHandler>;

  beforeEach((): void => {
    client = createWorkflowClient({ backend: new MemoryBackend({ debug: false }), debug: false });
    client.register(
      workflow({ id: "pipeline", steps: [step("only", { tool: passthroughTool("noop") })] }),
    );
    client.register(
      workflow({ id: "slow", steps: [step("only", { tool: slowTool("slow") })] }),
    );
    handlers = authorizedHandler(client);
  });

  afterEach(async (): Promise<void> => {
    await client.destroy();
  });

  async function until(check: () => Promise<boolean>, what: string): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await check()) return;
      await delay(10);
    }
    throw new Error(`Timed out waiting for ${what}`);
  }

  /** Start a run and let it settle, so no execution outlives the test. */
  async function startRun(): Promise<string> {
    const response = await handlers.POST(post("/api/workflows/pipeline/start", { input: {} }));
    const { runId } = await response.json() as { runId: string };

    await until(
      async () => (await client.getRun(runId))?.status === "completed",
      `run ${runId} to finish`,
    );
    return runId;
  }

  async function startRunWithInjectedEnv(): Promise<string> {
    return await withEnv(
      { VERYFRONT_TASK_ENV_JSON: JSON.stringify({ SECRETISH: "redacted" }) },
      startRun,
    );
  }

  it("starts a workflow at the path useWorkflowStart posts to", async () => {
    const response = await handlers.POST(
      post("/api/workflows/pipeline/start", { input: { topic: "x" } }),
    );

    expect(response.status).toBe(200);
    // useWorkflowStart reads `runId` (falling back to `id`) off this body.
    const body = await response.json() as { runId?: string };
    expect(typeof body.runId).toBe("string");
    if (!body.runId) throw new Error("expected a workflow run ID");
    const runId = body.runId;
    await until(
      async () => (await client.getRun(runId))?.status === "completed",
      `run ${runId} to finish`,
    );
    const run = await client.getRun(runId);
    expect(run?.input).toEqual({ topic: "x" });
    expect(run?.nodeStates.only?.output).toEqual({ ok: true, input: { topic: "x" } });
  });

  it("denies requests that the application does not authorize", async () => {
    const denied = createWorkflowHandler(client, { authorize: () => null });

    expect((await denied.GET(get("/api/workflows/runs"))).status).toBe(403);
    expect(
      (await denied.POST(post("/api/workflows/pipeline/start", { input: {} }))).status,
    ).toBe(403);
  });

  it("accepts the documented empty-string authorization identity", async () => {
    const emptyIdentity = createWorkflowHandler(client, { authorize: () => "" });

    expect((await emptyIdentity.GET(get("/api/workflows/runs"))).status).toBe(200);
    expect(
      (await emptyIdentity.POST(post("/api/workflows/pipeline/start", { input: {} }))).status,
    ).toBe(200);
  });

  it("preserves the request body when authorization inspects it", async () => {
    const bodyAware = createWorkflowHandler(client, {
      authorize: async (request) => {
        await request.json();
        return "tester";
      },
    });

    const response = await bodyAware.POST(
      post("/api/workflows/pipeline/start", { input: { topic: "x" } }),
    );

    expect(response.status).toBe(200);
    const { runId } = await response.json() as { runId: string };
    await until(
      async () => (await client.getRun(runId))?.status === "completed",
      `run ${runId} to finish`,
    );
  });

  it("rejects a non-canonical operation path before authorization", async () => {
    let authorizationCalls = 0;
    const routeAware = createWorkflowHandler(client, {
      authorize: () => {
        authorizationCalls++;
        return "tester";
      },
    });

    const response = await routeAware.POST(
      post("/api/workflows/runs/not-a-run/%63ancel"),
    );

    expect(response.status).toBe(400);
    expect(authorizationCalls).toBe(0);
  });

  it("decodes an encoded workflow ID before lookup", async () => {
    const workflowId = "encoded workflow";
    client.register(
      workflow({ id: workflowId, steps: [step("only", { tool: passthroughTool("encoded") })] }),
    );

    const response = await handlers.POST(
      post(`/api/workflows/${encodeURIComponent(workflowId)}/start`, { input: {} }),
    );

    expect(response.status).toBe(200);
    const { runId } = await response.json() as { runId: string };
    await until(
      async () => (await client.getRun(runId))?.status === "completed",
      `run ${runId} to finish`,
    );
  });

  it("rejects malformed route encoding", async () => {
    const response = await handlers.POST(
      post("/api/workflows/%E0%A4%A/start", { input: {} }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("Invalid workflow route encoding");
  });

  it("serves the run that useWorkflow polls, with the fields it reads", async () => {
    const runId = await startRunWithInjectedEnv();
    const persisted = await client.getRun(runId);
    expect(persisted?.context.env?.SECRETISH).toBe("redacted");
    expect(persisted?.workerId).toBeDefined();

    const response = await handlers.GET(get(`/api/workflows/runs/${runId}`));
    expect(response.status).toBe(200);

    const run = await response.json() as Record<string, unknown>;
    expect(run.id).toBe(runId);
    assertEquals(run.input, undefined);
    assertEquals(run.output, undefined);
    assertEquals(run.context, undefined);
    expect(run._tenant).toBeUndefined();
    // Trace identity names internal infrastructure and belongs to telemetry,
    // not to anyone polling a run.
    expect(run._traceContext).toBeUndefined();
    expect(run.workerId).toBeUndefined();
    expect(run.heartbeatAt).toBeUndefined();
    expect(run.checkpoints).toBeUndefined();
    assertEquals(run.sourceIntegrationPolicy, undefined);
    // useWorkflow derives status, progress and approvals from exactly these.
    expect(run.status).toBeDefined();
    expect(run.nodeStates).toBeDefined();
    assertExists(run.currentNodes);
    assertExists(run.pendingApprovals);
    assertEquals(typeof run.createdAt, "string");
  });

  it("uses the approvals hydrated by the run read", async () => {
    await client.destroy();
    const backend = new CountingMemoryBackend({ debug: false });
    client = createWorkflowClient({ backend, debug: false });
    client.register(
      workflow({ id: "pipeline", steps: [step("only", { tool: passthroughTool("noop") })] }),
    );
    handlers = authorizedHandler(client);

    const runId = await startRun();
    backend.pendingApprovalReads = 0;

    const response = await handlers.GET(get(`/api/workflows/runs/${runId}`));

    expect(response.status).toBe(200);
    expect(backend.pendingApprovalReads).toBe(1);
  });

  it("answers a missing run with 404 rather than an empty body", async () => {
    const response = await handlers.GET(get("/api/workflows/runs/run_does_not_exist"));

    expect(response.status).toBe(404);
    const body = await response.json() as { message?: string };
    expect(body.message).toContain("run_does_not_exist");
  });

  it("lists runs in the envelope useWorkflowList unwraps", async () => {
    const runId = await startRunWithInjectedEnv();

    const response = await handlers.GET(get("/api/workflows/runs?limit=20"));
    expect(response.status).toBe(200);

    const body = await response.json() as { runs?: Array<Record<string, unknown>> };
    expect(Array.isArray(body.runs)).toBe(true);
    expect(body.runs?.some((run) => run.id === runId)).toBe(true);
    const listed = body.runs?.find((run) => run.id === runId);
    expect((listed?.context as Record<string, unknown> | undefined)?.env).toBeUndefined();
    expect(listed?._tenant).toBeUndefined();
    expect(listed?._traceContext).toBeUndefined();
    expect(listed?.workerId).toBeUndefined();
    expect(listed?.checkpoints).toBeUndefined();
  });

  it("bounds list requests that omit a limit", async () => {
    let receivedFilter: RunFilter | undefined;
    Object.defineProperty(client, "listRuns", {
      configurable: true,
      value: (filter: RunFilter) => {
        receivedFilter = filter;
        return Promise.resolve([]);
      },
    });

    const response = await handlers.GET(get("/api/workflows/runs"));

    assertEquals(response.status, 200);
    assertEquals(receivedFilter, { limit: 100 });
  });

  it("pages runs with the cursor useWorkflowList round-trips", async () => {
    const started = [await startRun(), await startRun(), await startRun()];

    const first = await handlers.GET(get("/api/workflows/runs?limit=2"));
    expect(first.status).toBe(200);
    const firstPage = await first.json() as { runs: Array<{ id: string }>; cursor?: string };
    expect(firstPage.runs.length).toBe(2);
    expect(firstPage.cursor).toBe("2");

    const second = await handlers.GET(
      get(`/api/workflows/runs?limit=2&cursor=${firstPage.cursor}`),
    );
    expect(second.status).toBe(200);
    const secondPage = await second.json() as { runs: Array<{ id: string }>; cursor?: string };
    expect(secondPage.runs.length).toBe(1);

    const firstPageIds = firstPage.runs.map((run) => run.id);
    expect(firstPageIds.includes(secondPage.runs[0]?.id as string)).toBe(false);
    // A short final page ends the round trip instead of re-serving page one.
    expect(secondPage.cursor).toBeUndefined();
    expect([...firstPageIds, secondPage.runs[0]?.id].sort()).toEqual([...started].sort());
  });

  /** Start a run that is still going, so there is something to act on. */
  async function startRunningRun(): Promise<string> {
    const response = await handlers.POST(post("/api/workflows/slow/start", { input: {} }));
    const { runId } = await response.json() as { runId: string };
    await until(
      async () => (await client.getRun(runId)) !== null,
      `run ${runId} to exist`,
    );
    return runId;
  }

  it("cancels the run at the path useWorkflow calls", async () => {
    const runId = await startRunningRun();

    const response = await handlers.POST(post(`/api/workflows/runs/${runId}/cancel`));
    expect(response.status).toBe(200);
    await delay(0);
  });

  it("answers a refused retry instead of throwing out of the route", async () => {
    // A run that cannot be resumed is a normal outcome, not a crash: the
    // executor refuses it, and useWorkflow needs a status and a message rather
    // than an exception escaping the handler.
    const runId = await startRunningRun();
    await handlers.POST(post(`/api/workflows/runs/${runId}/cancel`));

    const response = await handlers.POST(post(`/api/workflows/runs/${runId}/retry`));

    expect(response.status).toBe(409);
    const body = await response.json() as { message?: string };
    expect(body.message).toContain("cancelled");
    await delay(0);
  });

  it("retries a failed run instead of using paused-run resume", async () => {
    client.register(
      workflow({ id: "fails-once", steps: [step("flaky", { tool: failOnceTool("flaky") })] }),
    );

    const started = await handlers.POST(post("/api/workflows/fails-once/start", { input: {} }));
    const { runId } = await started.json() as { runId: string };
    await until(
      async () => (await client.getRun(runId))?.status === "failed",
      `run ${runId} to fail`,
    );

    const persisted = await client.getRun(runId);
    expect(persisted?.error?.stack).toBeDefined();
    const failedResponse = await handlers.GET(get(`/api/workflows/runs/${runId}`));
    const failedRun = await failedResponse.json() as Record<string, unknown>;
    expect((failedRun.error as Record<string, unknown>).stack).toBeUndefined();

    const response = await handlers.POST(post(`/api/workflows/runs/${runId}/retry`));

    expect(response.status).toBe(200);
    await until(
      async () => (await client.getRun(runId))?.status === "completed",
      `run ${runId} to complete after retry`,
    );
  });

  it("serves and resolves an approval where useApproval looks for it", async () => {
    client.register(
      workflow({
        id: "needs-approval",
        steps: [
          waitForApproval("sign-off", {
            message: "ok?",
            responseSchema: defineSchema((v) => v.object({ confirmed: v.boolean() }))(),
          }),
          step("after", { tool: passthroughTool("after") }),
        ],
      }),
    );

    const started = await handlers.POST(post("/api/workflows/needs-approval/start", { input: {} }));
    const { runId } = await started.json() as { runId: string };

    await until(
      async () => (await client.getPendingApprovals(runId)).length > 0,
      `run ${runId} to pause for approval`,
    );

    // useWorkflow surfaces approvals off the run body, so the run has to carry
    // them, not just the approval manager.
    const runResponse = await handlers.GET(get(`/api/workflows/runs/${runId}`));
    const run = await runResponse.json() as {
      pendingApprovals?: Array<{ id: string; responseSchemaId?: string }>;
    };
    expect(run.pendingApprovals?.length).toBe(1);
    expect("responseSchemaId" in run.pendingApprovals![0]!).toBe(false);
    const approvalId = run.pendingApprovals?.[0]?.id;
    expect(typeof approvalId).toBe("string");

    const fetched = await handlers.GET(
      get(`/api/workflows/runs/${runId}/approvals/${approvalId}`),
    );
    expect(fetched.status).toBe(200);
    const fetchedApproval = await fetched.json() as { responseSchemaId?: string };
    expect("responseSchemaId" in fetchedApproval).toBe(false);

    const decided = await handlers.POST(
      post(`/api/workflows/runs/${runId}/approvals/${approvalId}`, {
        approved: true,
        approver: "impersonated-user",
        data: { confirmed: true },
      }),
    );
    expect(decided.status).toBe(200);
    expect(await decided.json()).toEqual({
      approvalId,
      approved: true,
      result: null,
      resolvedBy: "tester",
    });

    // A 200 alone cannot tell an approval from a rejection: the run has to
    // leave the wait and run the step behind it.
    await until(
      async () => (await client.getRun(runId))?.status === "completed",
      `run ${runId} to complete after approval`,
    );
    expect((await client.getRun(runId))?.context.after).toBeDefined();
  });

  it("fails the run when an approval is rejected", async () => {
    client.register(
      workflow({
        id: "needs-approval",
        steps: [
          waitForApproval("sign-off", { message: "ok?" }),
          step("after", { tool: passthroughTool("after") }),
        ],
      }),
    );

    const started = await handlers.POST(post("/api/workflows/needs-approval/start", { input: {} }));
    const { runId } = await started.json() as { runId: string };

    await until(
      async () => (await client.getPendingApprovals(runId)).length > 0,
      `run ${runId} to pause for approval`,
    );
    const approvalId = (await client.getPendingApprovals(runId))[0]?.id;

    const decided = await handlers.POST(
      post(`/api/workflows/runs/${runId}/approvals/${approvalId}`, {
        approved: false,
        approver: "tester",
        comment: "nope",
      }),
    );
    expect(decided.status).toBe(200);

    await until(
      async () => (await client.getRun(runId))?.status === "failed",
      `run ${runId} to fail after rejection`,
    );
    const run = await client.getRun(runId);
    expect(run?.error?.message).toContain("reject");
    expect(run?.context.after).toBeUndefined();
  });

  it("rejects an approval decision that omits the approved flag", async () => {
    const runId = await startRun();

    const response = await handlers.POST(
      post(`/api/workflows/runs/${runId}/approvals/whatever`, { approver: "tester" }),
    );

    expect(response.status).toBe(400);
  });

  it("resolves routes against a custom basePath", async () => {
    const mounted = authorizedHandler(client, { basePath: "/api/flows/" });

    const response = await mounted.POST(post("/api/flows/pipeline/start", { input: {} }));
    expect(response.status).toBe(200);
    const { runId } = await response.json() as { runId: string };
    await until(
      async () => (await client.getRun(runId))?.status === "completed",
      `run ${runId} to finish`,
    );

    // The default mount point must not answer once basePath moved.
    expect((await mounted.GET(get("/api/workflows/runs"))).status).toBe(404);
  });

  it("preserves literal reserved characters in a custom basePath", async () => {
    const mounted = authorizedHandler(client, { basePath: "/api/flows:v2+preview/" });

    const response = await mounted.POST(
      post("/api/flows:v2+preview/pipeline/start", { input: {} }),
    );

    expect(response.status).toBe(200);
    const { runId } = await response.json() as { runId: string };
    await until(
      async () => (await client.getRun(runId))?.status === "completed",
      `run ${runId} to finish`,
    );
  });

  it("normalizes Unicode and spaces in a custom basePath", async () => {
    for (const basePath of ["/api/流/", "/api/work flows/"] as const) {
      const mounted = authorizedHandler(client, { basePath });
      const requestPath = `${basePath}pipeline/start`;
      const response = await mounted.POST(post(requestPath, { input: {} }));

      expect(response.status).toBe(200);
      const { runId } = await response.json() as { runId: string };
      await until(
        async () => (await client.getRun(runId))?.status === "completed",
        `run ${runId} to finish`,
      );
    }
  });

  it("does not answer for a path outside its mount point", async () => {
    const response = await handlers.GET(get("/api/something-else/runs"));
    expect(response.status).toBe(404);
  });

  it("rejects trailing segments outside the hook route contract", async () => {
    const started = await handlers.POST(post("/api/workflows/pipeline/start/extra", { input: {} }));
    expect(started.status).toBe(404);

    const runId = await startRun();
    const fetched = await handlers.GET(get(`/api/workflows/runs/${runId}/extra`));
    expect(fetched.status).toBe(404);
  });

  it("rejects malformed request JSON", async () => {
    const response = await handlers.POST(postRaw("/api/workflows/pipeline/start", "{"));

    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain("JSON");
  });

  it("does not expose unknown exception messages", async () => {
    await client.destroy();
    client = createWorkflowClient({
      backend: new ExplodingMemoryBackend({ debug: false }),
      debug: false,
    });
    handlers = authorizedHandler(client);

    const response = await handlers.GET(get("/api/workflows/runs"));

    expect(response.status).toBe(500);
    expect((await response.json()).message).toBe("Internal workflow handler error");
  });

  it("rejects invalid run-list filters", async () => {
    const invalidStatus = await handlers.GET(get("/api/workflows/runs?status=not-a-status"));
    expect(invalidStatus.status).toBe(400);

    const invalidDate = await handlers.GET(get("/api/workflows/runs?createdAfter=not-a-date"));
    expect(invalidDate.status).toBe(400);

    const invalidLimit = await handlers.GET(get("/api/workflows/runs?limit=1001"));
    expect(invalidLimit.status).toBe(400);

    const exponentLimit = await handlers.GET(get("/api/workflows/runs?limit=1e2"));
    expect(exponentLimit.status).toBe(400);

    const hexadecimalCursor = await handlers.GET(get("/api/workflows/runs?cursor=0x10"));
    expect(hexadecimalCursor.status).toBe(400);
  });

  it("rejects an invalid approval decision shape", async () => {
    const response = await handlers.POST(
      post("/api/workflows/runs/run-id/approvals/approval-id", {
        approved: true,
        approver: 42,
      }),
    );

    expect(response.status).toBe(400);
  });

  describe("run event stream", () => {
    function replaceObservation(value: unknown): void {
      Object.defineProperty(client, "observeRunEvents", {
        configurable: true,
        value: () => Promise.resolve(value),
      });
    }

    /** Read an SSE body to completion, returning `[eventName, data]` pairs. */
    async function readStream(
      response: Response,
    ): Promise<Array<[string, Record<string, unknown>]>> {
      const text = await response.text();
      const frames: Array<[string, Record<string, unknown>]> = [];
      for (const block of text.split("\n\n")) {
        const name = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (name && data) frames.push([name, JSON.parse(data) as Record<string, unknown>]);
      }
      return frames;
    }

    async function readFrame(
      reader: ReadableStreamDefaultReader<Uint8Array>,
    ): Promise<string> {
      const result = await reader.read();
      expect(result.done).toBe(false);
      return new TextDecoder().decode(result.value);
    }

    async function readEvent(
      reader: ReadableStreamDefaultReader<Uint8Array>,
    ): Promise<[string, Record<string, unknown>]> {
      const timeout = Promise.withResolvers<never>();
      const timeoutId = setTimeout(
        () => timeout.reject(new Error("Timed out waiting for workflow event")),
        2_000,
      );
      let frame: string;
      try {
        frame = await Promise.race([readFrame(reader), timeout.promise]);
      } finally {
        clearTimeout(timeoutId);
      }
      const name = /^event: (.+)$/m.exec(frame)?.[1];
      const data = /^data: (.+)$/m.exec(frame)?.[1];
      if (!name || !data) throw new Error(`Invalid SSE frame: ${frame}`);
      return [name, JSON.parse(data) as Record<string, unknown>];
    }

    it("returns one data-minimized summary for list, detail, and snapshot", async () => {
      const runId = await startRun();
      const persisted = await client.getRun(runId);
      if (!persisted) throw new Error("expected the run to exist");

      const privateMarker = "workflow-run-private-marker";
      const nodeStates = { ...persisted.nodeStates };
      Object.defineProperty(nodeStates, "__proto__", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: {
          nodeId: "__proto__",
          status: "failed",
          attempt: 2,
          input: { privateMarker },
          output: { privateMarker },
          error: "Operational node failure",
          startedAt: new Date("2026-08-30T10:01:00.000Z"),
          completedAt: new Date("2026-08-30T10:02:00.000Z"),
        },
      });
      const exposedRun = {
        ...persisted,
        version: "v1",
        status: "failed" as const,
        input: { privateMarker },
        output: { privateMarker },
        context: { input: { privateMarker }, privateMarker },
        checkpoints: [{ privateMarker }],
        nodeStates,
        currentNodes: ["__proto__"],
        pendingApprovals: [{
          id: "approval-1",
          nodeId: "__proto__",
          message: "Operational approval message",
          payload: { privateMarker },
          approvers: [privateMarker],
          requestedAt: new Date("2026-08-30T10:03:00.000Z"),
          expiresAt: new Date("2026-08-30T11:03:00.000Z"),
          status: "pending" as const,
          decidedBy: privateMarker,
          decidedAt: new Date("2026-08-30T10:03:30.000Z"),
          comment: privateMarker,
          notificationError: privateMarker,
        }],
        error: {
          message: "Operational run failure",
          nodeId: "__proto__",
          stack: privateMarker,
        },
        sourceIntegrationPolicy: { privateMarker },
        workerId: privateMarker,
        heartbeatAt: new Date("2026-08-30T10:04:00.000Z"),
        _traceContext: privateMarker,
        _tenant: { privateMarker },
        _runtimeStateVersion: 1,
        _workflowProjection: { privateMarker },
        createdAt: new Date("2026-08-30T10:00:00.000Z"),
        startedAt: new Date("2026-08-30T10:00:30.000Z"),
        completedAt: new Date("2026-08-30T10:05:00.000Z"),
      } as unknown as WorkflowRun;

      Object.defineProperty(client, "getRun", {
        configurable: true,
        value: () => Promise.resolve(exposedRun),
      });
      Object.defineProperty(client, "listRuns", {
        configurable: true,
        value: () => Promise.resolve([exposedRun]),
      });
      replaceObservation({
        supported: true,
        initial: exposedRun,
        events: {
          [Symbol.asyncIterator]: () => ({
            next: () => Promise.resolve({ value: undefined, done: true as const }),
          }),
        },
        close: () => Promise.resolve(),
      });

      const detailResponse = await handlers.GET(get(`/api/workflows/runs/${runId}`));
      const listResponse = await handlers.GET(get("/api/workflows/runs?limit=1"));
      const snapshotResponse = await handlers.GET(
        get(`/api/workflows/runs/${runId}/events`),
      );
      const detailText = await detailResponse.text();
      const listText = await listResponse.text();
      const snapshotText = await snapshotResponse.text();

      assertEquals(detailText.includes(privateMarker), false);
      assertEquals(listText.includes(privateMarker), false);
      assertEquals(snapshotText.includes(privateMarker), false);

      const detail = JSON.parse(detailText) as Record<string, unknown>;
      const list = JSON.parse(listText) as { runs: Array<Record<string, unknown>> };
      const snapshotData = /^data: (.+)$/m.exec(snapshotText)?.[1];
      if (!snapshotData) throw new Error("expected an SSE snapshot frame");
      const snapshot = JSON.parse(snapshotData) as Record<string, unknown>;

      assertEquals(list.runs, [detail]);
      assertEquals(snapshot, detail);
      assertEquals(detail, {
        id: runId,
        workflowId: persisted.workflowId,
        version: "v1",
        status: "failed",
        currentNodes: ["__proto__"],
        nodeStates: {
          ...Object.fromEntries(
            Object.entries(persisted.nodeStates).map(([nodeId, state]) => [nodeId, {
              nodeId: state.nodeId,
              status: state.status,
              attempt: state.attempt,
              ...(state.startedAt ? { startedAt: state.startedAt.toISOString() } : {}),
              ...(state.completedAt ? { completedAt: state.completedAt.toISOString() } : {}),
              ...(state.error ? { error: state.error } : {}),
            }]),
          ),
          ["__proto__"]: {
            nodeId: "__proto__",
            status: "failed",
            attempt: 2,
            error: "Operational node failure",
            startedAt: "2026-08-30T10:01:00.000Z",
            completedAt: "2026-08-30T10:02:00.000Z",
          },
        },
        pendingApprovals: [{
          id: "approval-1",
          nodeId: "__proto__",
          status: "pending",
          message: "Operational approval message",
          requestedAt: "2026-08-30T10:03:00.000Z",
          expiresAt: "2026-08-30T11:03:00.000Z",
        }],
        createdAt: "2026-08-30T10:00:00.000Z",
        startedAt: "2026-08-30T10:00:30.000Z",
        completedAt: "2026-08-30T10:05:00.000Z",
        error: { message: "Operational run failure", nodeId: "__proto__" },
      });

      assertEquals(exposedRun.input, { privateMarker });
      assertEquals(exposedRun.pendingApprovals[0]?.payload, { privateMarker });
      assertEquals(exposedRun.nodeStates.__proto__?.output, { privateMarker });
    });

    it("bounds the number of active event streams and releases cancelled streams", async () => {
      const closeCalls: number[] = [];
      let observationCalls = 0;
      const boundedHandlers = createWorkflowHandler(client, {
        authorize: () => "tester",
        maxEventStreamsPerIdentity: 64,
      });
      Object.defineProperty(client, "observeRunEvents", {
        configurable: true,
        value: () => {
          observationCalls++;
          const call = observationCalls;
          return Promise.resolve({
            supported: true,
            initial: {
              id: "bounded-run",
              workflowId: "pipeline",
              status: "running",
              input: {},
              context: {},
              nodeStates: {},
              pendingApprovals: [],
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            events: {
              [Symbol.asyncIterator]() {
                return {
                  next: () => new Promise<IteratorResult<never>>(() => {}),
                };
              },
            },
            close: () => closeCalls.push(call),
          });
        },
      });

      const responses = await Promise.all(
        Array.from(
          { length: 64 },
          () => boundedHandlers.GET(get("/api/workflows/runs/bounded-run/events")),
        ),
      );
      expect(responses.every((response) => response.status === 200)).toBe(true);

      const rejected = await boundedHandlers.GET(get("/api/workflows/runs/bounded-run/events"));
      expect(rejected.status).toBe(429);
      expect(observationCalls).toBe(64);

      await responses[0]?.body?.cancel();
      expect(closeCalls).toEqual([1]);

      const replacement = await boundedHandlers.GET(
        get("/api/workflows/runs/bounded-run/events"),
      );
      expect(replacement.status).toBe(200);
      expect(observationCalls).toBe(65);

      await Promise.all([
        ...responses.slice(1).map((response) => response.body?.cancel()),
        replacement.body?.cancel(),
      ]);
    });

    it("limits active event streams per authorized identity", async () => {
      let identity = "first-user";
      let observationCalls = 0;
      Object.defineProperty(client, "observeRunEvents", {
        configurable: true,
        value: () => {
          observationCalls++;
          return Promise.resolve({
            supported: true,
            initial: {
              id: "identity-bounded-run",
              workflowId: "pipeline",
              status: "running",
              input: {},
              context: {},
              nodeStates: {},
              pendingApprovals: [],
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            events: {
              [Symbol.asyncIterator]() {
                return {
                  next: () => new Promise<IteratorResult<never>>(() => {}),
                };
              },
            },
            close: () => {},
          });
        },
      });

      const identityHandlers = createWorkflowHandler(client, {
        authorize: () => identity,
        maxEventStreams: 3,
        maxEventStreamsPerIdentity: 2,
      });
      const firstUserResponses = await Promise.all(
        Array.from(
          { length: 2 },
          () => identityHandlers.GET(get("/api/workflows/runs/identity-bounded-run/events")),
        ),
      );
      expect(firstUserResponses.every((response) => response.status === 200)).toBe(true);
      expect(
        (await identityHandlers.GET(get("/api/workflows/runs/identity-bounded-run/events")))
          .status,
      ).toBe(429);

      identity = "second-user";
      const secondUserResponse = await identityHandlers.GET(
        get("/api/workflows/runs/identity-bounded-run/events"),
      );
      expect(secondUserResponse.status).toBe(200);
      expect(observationCalls).toBe(3);
      expect(
        (await identityHandlers.GET(get("/api/workflows/runs/identity-bounded-run/events")))
          .status,
      ).toBe(429);

      await Promise.all([
        ...firstUserResponses.map((response) => response.body?.cancel()),
        secondUserResponse.body?.cancel(),
      ]);
    });

    it("keeps the stream reservation until asynchronous teardown settles", async () => {
      const iteratorTeardown = Promise.withResolvers<IteratorResult<never>>();
      const observationTeardown = Promise.withResolvers<void>();
      let returnCalls = 0;
      let closeCalls = 0;
      Object.defineProperty(client, "observeRunEvents", {
        configurable: true,
        value: () =>
          Promise.resolve({
            supported: true,
            initial: {
              id: "async-teardown-run",
              workflowId: "pipeline",
              status: "running",
              input: {},
              context: {},
              nodeStates: {},
              pendingApprovals: [],
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            events: {
              [Symbol.asyncIterator]() {
                return {
                  next: () => new Promise<IteratorResult<never>>(() => {}),
                  return: () => {
                    returnCalls++;
                    return iteratorTeardown.promise;
                  },
                };
              },
            },
            close: () => {
              closeCalls++;
              return observationTeardown.promise;
            },
          }),
      });

      const teardownHandlers = createWorkflowHandler(client, {
        authorize: () => "teardown-user",
        maxEventStreams: 1,
        maxEventStreamsPerIdentity: 1,
      });
      const response = await teardownHandlers.GET(
        get("/api/workflows/runs/async-teardown-run/events"),
      );
      expect(response.status).toBe(200);

      const cancellation = response.body?.cancel();
      await until(
        async () => returnCalls === 1 && closeCalls === 1,
        "asynchronous observation teardown to start",
      );
      expect(
        (await teardownHandlers.GET(get("/api/workflows/runs/async-teardown-run/events")))
          .status,
      ).toBe(429);

      iteratorTeardown.resolve({ value: undefined, done: true });
      observationTeardown.resolve();
      await cancellation;

      const replacement = await teardownHandlers.GET(
        get("/api/workflows/runs/async-teardown-run/events"),
      );
      expect(replacement.status).toBe(200);
      await replacement.body?.cancel();
    });

    it("streams each sequential step boundary before the next side effect runs", async () => {
      await client.destroy();
      const backend = new GatedActivationMemoryBackend({ debug: false });
      client = createWorkflowClient({ backend, debug: false });
      handlers = authorizedHandler(client);
      const firstStarted = Promise.withResolvers<void>();
      const releaseFirst = Promise.withResolvers<void>();
      const secondStarted = Promise.withResolvers<void>();
      const releaseSecond = Promise.withResolvers<void>();
      const controlledTool = (
        id: string,
        started: PromiseWithResolvers<void>,
        release: PromiseWithResolvers<void>,
      ): Tool => ({
        id,
        type: "function",
        description: `Controlled test tool: ${id}`,
        inputSchema: defineSchema((v) => v.object({}).passthrough())(),
        execute: async () => {
          started.resolve();
          await release.promise;
          return { ok: true };
        },
      });
      client.register(
        workflow({
          id: "observable-sequence",
          steps: sequence(
            step("first", {
              tool: controlledTool("controlled-first", firstStarted, releaseFirst),
            }),
            step("second", {
              tool: controlledTool("controlled-second", secondStarted, releaseSecond),
            }),
          ),
        }),
      );

      const handle = await client.start("observable-sequence", {});
      await backend.activationRequested.promise;
      const response = await handlers.GET(get(`/api/workflows/runs/${handle.runId}/events`));
      const reader = response.body?.getReader();
      if (!reader) throw new Error("expected an SSE response body");

      expect((await readEvent(reader))[0]).toBe("snapshot");
      backend.releaseActivation.resolve();
      expect(await readEvent(reader)).toEqual([
        "run.status",
        { type: "run.status", runId: handle.runId, status: "running" },
      ]);
      expect(await readEvent(reader)).toEqual([
        "step.started",
        { type: "step.started", runId: handle.runId, nodeId: "first", attempt: 1 },
      ]);
      await firstStarted.promise;
      releaseFirst.resolve();
      expect(await readEvent(reader)).toEqual([
        "step.completed",
        { type: "step.completed", runId: handle.runId, nodeId: "first", attempt: 1 },
      ]);
      expect(await readEvent(reader)).toEqual([
        "step.started",
        { type: "step.started", runId: handle.runId, nodeId: "second", attempt: 1 },
      ]);
      await secondStarted.promise;
      releaseSecond.resolve();
      expect(await readEvent(reader)).toEqual([
        "step.completed",
        { type: "step.completed", runId: handle.runId, nodeId: "second", attempt: 1 },
      ]);
      expect(await readEvent(reader)).toEqual([
        "run.status",
        { type: "run.status", runId: handle.runId, status: "completed" },
      ]);
      expect((await reader.read()).done).toBe(true);
      await handle.settled();
    });

    it("streams approval.pending with the approval id when a run parks", async () => {
      client.register(
        workflow({
          id: "observable-approval",
          steps: [waitForApproval("review", { message: "Please review" })],
        }),
      );

      // Subscribe before the run parks. The stream itself must name the
      // blocking approval; the approvals endpoint is only consulted below to
      // verify the id matches what was persisted.
      const handle = await client.start("observable-approval", {});
      const response = await handlers.GET(get(`/api/workflows/runs/${handle.runId}/events`));
      const reader = response.body?.getReader();
      if (!reader) throw new Error("expected an SSE response body");

      let approvalFrame: Record<string, unknown> | undefined;
      try {
        for (let frame = 0; frame < 10 && !approvalFrame; frame++) {
          const [name, data] = await readEvent(reader);
          if (name === "approval.pending") approvalFrame = data;
        }
      } finally {
        await reader.cancel();
      }

      await handle.settled();
      const [approval] = await client.getPendingApprovals(handle.runId);
      expect(approval).toBeDefined();
      expect(approvalFrame).toEqual({
        type: "approval.pending",
        runId: handle.runId,
        approvalId: approval?.id,
        nodeId: "review",
        message: "Please review",
      });
    });

    it("streams a finished run's snapshot and closes", async () => {
      // A terminal run has no transitions left. Holding the connection open
      // would strand the caller waiting for an event that cannot arrive.
      const runId = await startRun();

      const response = await handlers.GET(get(`/api/workflows/runs/${runId}/events`));

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
      expect(response.headers.get("connection")).toBe("keep-alive");
      expect(response.headers.get("x-accel-buffering")).toBe("no");

      const frames = await readStream(response);
      expect(frames.length).toBe(1);
      expect(frames[0]?.[0]).toBe("snapshot");
      expect(frames[0]?.[1].id).toBe(runId);
      expect(frames[0]?.[1].status).toBe("completed");
    });

    it("uses the atomic observation snapshot when a run turns terminal during setup", async () => {
      const runId = await startRun();
      const persisted = await client.getRun(runId);
      if (!persisted) throw new Error("expected the run to exist");
      let nextCalls = 0;
      let closeCalls = 0;
      replaceObservation({
        supported: true,
        initial: { ...persisted, status: "cancelled" },
        events: {
          [Symbol.asyncIterator]: () => ({
            next: () => {
              nextCalls++;
              return Promise.resolve({ value: undefined, done: true as const });
            },
          }),
        },
        close: () => {
          closeCalls++;
          return Promise.resolve();
        },
      });

      const response = await handlers.GET(get(`/api/workflows/runs/${runId}/events`));
      const frames = await readStream(response);

      expect(frames.map(([name]) => name)).toEqual(["snapshot"]);
      expect(frames[0]?.[1].status).toBe("cancelled");
      expect(nextCalls).toBe(0);
      expect(closeCalls).toBe(1);
    });

    it("does not reread the raw initial status after encoding a valid terminal snapshot", async () => {
      const runId = await startRun();
      const persisted = await client.getRun(runId);
      if (!persisted) throw new Error("expected the run to exist");
      const initial = { ...persisted };
      let statusReads = 0;
      Object.defineProperty(initial, "status", {
        configurable: true,
        enumerable: true,
        get: () => {
          statusReads++;
          if (statusReads > 1) {
            throw new Error("status can only be read once");
          }
          return "completed";
        },
      });
      replaceObservation({
        supported: true,
        initial,
        events: {
          [Symbol.asyncIterator]: () => ({
            next: () => Promise.resolve({ value: undefined, done: true as const }),
            return: () => Promise.resolve({ value: undefined, done: true as const }),
          }),
        },
        close: () => Promise.resolve(),
      });

      const response = await handlers.GET(get(`/api/workflows/runs/${runId}/events`));
      const frames = await readStream(response);

      assertEquals(frames.map(([name]) => name), ["snapshot"]);
      assertEquals(frames[0]?.[1].status, "completed");
      assertEquals(statusReads, 1);
    });

    it("streams transitions written by a separate client sharing the backend", async () => {
      await client.destroy();
      const backend = new MemoryBackend({ debug: false });
      client = createWorkflowClient({ backend, debug: false });
      handlers = authorizedHandler(client);
      const writer = createWorkflowClient({ backend, debug: false });
      writer.register(
        workflow({ id: "shared-slow", steps: [step("only", { tool: slowTool("shared-slow") })] }),
      );
      try {
        const { runId } = await writer.start("shared-slow", {});

        const response = await handlers.GET(get(`/api/workflows/runs/${runId}/events`));
        const collected = readStream(response);

        await writer.cancel(runId);

        const frames = await collected;
        const names = frames.map(([name]) => name);

        expect(names[0]).toBe("snapshot");
        expect(names).toContain("run.status");

        const terminal = frames.findLast(([name]) => name === "run.status");
        expect(terminal?.[1].status).toBe("cancelled");
        expect(terminal?.[1].runId).toBe(runId);
      } finally {
        await writer.destroy();
      }
    });

    it("does not leak the run's context through the snapshot", () => {
      // The snapshot frame is the same projection the run detail endpoint
      // returns, so it must not widen what that endpoint exposes.
      return startRun().then(async (runId) => {
        const response = await handlers.GET(get(`/api/workflows/runs/${runId}/events`));
        const snapshotFrame = (await readStream(response))[0]?.[1];
        expect(snapshotFrame).toBeDefined();

        const detail = await (await handlers.GET(get(`/api/workflows/runs/${runId}`))).json();

        expect(snapshotFrame).toEqual(detail);
      });
    });

    it("404s for a run that does not exist", async () => {
      const response = await handlers.GET(get("/api/workflows/runs/missing/events"));

      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).not.toBe("text/event-stream");
    });

    it("returns a sanitized 501 when the backend cannot observe runs", async () => {
      replaceObservation({ supported: false, reason: "unsupported" });

      const response = await handlers.GET(get("/api/workflows/runs/anything/events"));

      expect(response.status).toBe(501);
      expect(response.headers.get("content-type")).not.toBe("text/event-stream");
      expect(await response.json()).toEqual({
        message: "Workflow event observation is not supported",
      });
    });

    it("cleans up the observation when the response body is cancelled", async () => {
      const runId = await startRun();
      const persisted = await client.getRun(runId);
      if (!persisted) throw new Error("expected the run to exist");
      const initial = { ...persisted, status: "running" as const };
      let returnCalls = 0;
      let closeCalls = 0;
      replaceObservation({
        supported: true,
        initial,
        events: {
          [Symbol.asyncIterator]: () => ({
            next: () => new Promise<IteratorResult<never>>(() => {}),
            return: () => {
              returnCalls++;
              return Promise.resolve({ value: undefined, done: true as const });
            },
          }),
        },
        close: () => {
          closeCalls++;
          return Promise.resolve();
        },
      });

      const response = await handlers.GET(get(`/api/workflows/runs/${runId}/events`));
      await response.body?.cancel();

      expect(returnCalls).toBe(1);
      expect(closeCalls).toBe(1);
    });

    it("cleans up the observation when the request is aborted", async () => {
      const runId = await startRun();
      const persisted = await client.getRun(runId);
      if (!persisted) throw new Error("expected the run to exist");
      const initial = { ...persisted, status: "running" as const };
      let returnCalls = 0;
      let closeCalls = 0;
      replaceObservation({
        supported: true,
        initial,
        events: {
          [Symbol.asyncIterator]: () => ({
            next: () => new Promise<IteratorResult<never>>(() => {}),
            return: () => {
              returnCalls++;
              return Promise.resolve({ value: undefined, done: true as const });
            },
          }),
        },
        close: () => {
          closeCalls++;
          return Promise.resolve();
        },
      });

      const controller = new AbortController();
      const request = new Request(
        `http://localhost:3000/api/workflows/runs/${runId}/events`,
        { signal: controller.signal },
      );
      const response = await handlers.GET(request);

      controller.abort();
      await until(() => Promise.resolve(closeCalls === 1), "the observation to close");

      expect(returnCalls).toBe(1);
      expect(closeCalls).toBe(1);
      await response.body?.cancel().catch(() => {});
      expect(returnCalls).toBe(1);
      expect(closeCalls).toBe(1);
    });

    it("cleans up after sending a terminal status event", async () => {
      const runId = await startRun();
      const persisted = await client.getRun(runId);
      if (!persisted) throw new Error("expected the run to exist");
      const initial = { ...persisted, status: "running" as const };
      let returnCalls = 0;
      let closeCalls = 0;
      replaceObservation({
        supported: true,
        initial,
        events: {
          [Symbol.asyncIterator]: () => ({
            next: () =>
              Promise.resolve({
                value: { type: "run.status", runId, status: "cancelled" },
                done: false as const,
              }),
            return: () => {
              returnCalls++;
              return Promise.resolve({ value: undefined, done: true as const });
            },
          }),
        },
        close: () => {
          closeCalls++;
          return Promise.resolve();
        },
      });

      const response = await handlers.GET(get(`/api/workflows/runs/${runId}/events`));
      const frames = await readStream(response);

      expect(frames.map(([name]) => name)).toEqual(["snapshot", "run.status"]);
      expect(returnCalls).toBe(1);
      expect(closeCalls).toBe(1);
    });

    it("sends one sanitized error frame when observation fails after streaming starts", async () => {
      const runId = await startRun();
      const persisted = await client.getRun(runId);
      if (!persisted) throw new Error("expected the run to exist");
      const initial = { ...persisted, status: "running" as const };
      let returnCalls = 0;
      let closeCalls = 0;
      replaceObservation({
        supported: true,
        initial,
        events: {
          [Symbol.asyncIterator]: () => ({
            next: () => Promise.reject(new Error("sensitive observation detail")),
            return: () => {
              returnCalls++;
              return Promise.resolve({ value: undefined, done: true as const });
            },
          }),
        },
        close: () => {
          closeCalls++;
          return Promise.resolve();
        },
      });

      const response = await handlers.GET(get(`/api/workflows/runs/${runId}/events`));
      const frames = await readStream(response);

      expect(frames.map(([name]) => name)).toEqual(["snapshot", "error"]);
      expect(frames[1]?.[1]).toEqual({
        code: "workflow_observation_failed",
        message: "Workflow event observation failed",
        retryable: true,
      });
      expect(JSON.stringify(frames)).not.toContain("sensitive observation detail");
      expect(returnCalls).toBe(1);
      expect(closeCalls).toBe(1);
    });

    it("sends a sanitized error and closes when the snapshot cannot be encoded", async () => {
      const runId = await startRun();
      const persisted = await client.getRun(runId);
      if (!persisted) throw new Error("expected the run to exist");
      let nextCalls = 0;
      let returnCalls = 0;
      let closeCalls = 0;
      replaceObservation({
        supported: true,
        initial: {
          ...persisted,
          status: "running",
          currentNodes: [1n] as unknown as string[],
        },
        events: {
          [Symbol.asyncIterator]: () => ({
            next: () => {
              nextCalls++;
              return Promise.resolve({ value: undefined, done: true as const });
            },
            return: () => {
              returnCalls++;
              return Promise.resolve({ value: undefined, done: true as const });
            },
          }),
        },
        close: () => {
          closeCalls++;
          return Promise.resolve();
        },
      });

      const response = await handlers.GET(get(`/api/workflows/runs/${runId}/events`));
      const frames = await readStream(response);

      // Reconnecting re-reads the same stored run, so the client must not retry.
      assertEquals(frames, [["error", {
        code: "workflow_snapshot_serialization_failed",
        message: "Workflow run snapshot could not be serialized",
        retryable: false,
      }]]);
      assertEquals(nextCalls, 0);
      assertEquals(returnCalls, 1);
      assertEquals(closeCalls, 1);
    });

    it("does not reread status after projecting an ongoing snapshot", async () => {
      const runId = await startRun();
      const persisted = await client.getRun(runId);
      if (!persisted) throw new Error("expected the run to exist");
      // A stateful accessor can serialize cleanly and then throw on the
      // follow-up terminal-status read; the stream must use the projected
      // snapshot and not synthesize a false serialization error.
      let statusReads = 0;
      const initial = { ...persisted };
      Object.defineProperty(initial, "status", {
        enumerable: true,
        get(): WorkflowRun["status"] {
          statusReads++;
          if (statusReads > 1) throw new Error("stateful status detail");
          return "running";
        },
      });
      let returnCalls = 0;
      let closeCalls = 0;
      replaceObservation({
        supported: true,
        initial: initial as WorkflowRun,
        events: {
          [Symbol.asyncIterator]: () => ({
            next: () => Promise.resolve({ value: undefined, done: true as const }),
            return: () => {
              returnCalls++;
              return Promise.resolve({ value: undefined, done: true as const });
            },
          }),
        },
        close: () => {
          closeCalls++;
          return Promise.resolve();
        },
      });

      const response = await handlers.GET(get(`/api/workflows/runs/${runId}/events`));
      const frames = await readStream(response);

      assertEquals(frames.map(([name]) => name), ["snapshot"]);
      assertEquals(frames[0]?.[1].status, "running");
      assertEquals(statusReads, 1);
      assertEquals(JSON.stringify(frames).includes("stateful status detail"), false);
      assertEquals(returnCalls, 1);
      assertEquals(closeCalls, 1);
    });

    it("logs only a classification when the snapshot raises run content", async () => {
      const runId = await startRun();
      const persisted = await client.getRun(runId);
      if (!persisted) throw new Error("expected the run to exist");
      const initial = {
        ...persisted,
        status: "running" as const,
        input: {
          toJSON: () => {
            throw Object.assign(new Error("sensitive customer detail"), {
              name: "sensitive customer detail",
            });
          },
        },
      };
      Object.defineProperty(initial, "id", {
        configurable: true,
        get: () => {
          throw new Error("sensitive customer id");
        },
      });
      replaceObservation({
        supported: true,
        initial,
        events: {
          [Symbol.asyncIterator]: () => ({
            next: () => Promise.resolve({ value: undefined, done: true as const }),
            return: () => Promise.resolve({ value: undefined, done: true as const }),
          }),
        },
        close: () => Promise.resolve(),
      });

      const entries: LogEntry[] = [];
      const unsubscribe = __subscribeLogRecordEmitter((entry) => {
        if (entry.level === "error" && entry.component === "workflow-http") {
          entries.push(entry);
        }
      });
      let frames: Array<[string, Record<string, unknown>]>;
      try {
        const response = await handlers.GET(get(`/api/workflows/runs/${runId}/events`));
        frames = await readStream(response);
      } finally {
        unsubscribe();
      }

      assertEquals(frames.map(([name]) => name), ["error"]);
      assertEquals(entries.length, 1);
      // The logger hoists the `runId` context key to the `run_id` entry field.
      assertEquals(entries[0]?.run_id, runId);
      assertEquals(entries[0]?.context, { errorName: "serialization_error" });
      assertEquals(entries[0]?.error, undefined);
      assertEquals(JSON.stringify(entries).includes("sensitive customer detail"), false);
      assertEquals(JSON.stringify(frames).includes("sensitive customer detail"), false);
    });

    it("pulls at most one backend event while the consumer is backpressured", async () => {
      const runId = await startRun();
      const persisted = await client.getRun(runId);
      if (!persisted) throw new Error("expected the run to exist");
      const initial = { ...persisted, status: "running" as const };
      const pending = Promise.withResolvers<IteratorResult<never>>();
      const nextCalled = Promise.withResolvers<void>();
      let nextCalls = 0;
      let returnCalls = 0;
      replaceObservation({
        supported: true,
        initial,
        events: {
          [Symbol.asyncIterator]: () => ({
            next: () => {
              nextCalls++;
              nextCalled.resolve();
              return pending.promise;
            },
            return: () => {
              returnCalls++;
              return Promise.resolve({ value: undefined, done: true as const });
            },
          }),
        },
        close: () => Promise.resolve(),
      });

      const response = await handlers.GET(get(`/api/workflows/runs/${runId}/events`));
      const reader = response.body?.getReader();
      if (!reader) throw new Error("expected an SSE response body");

      expect(await readFrame(reader)).toContain("event: snapshot");
      await nextCalled.promise;
      await Promise.resolve();
      expect(nextCalls).toBe(1);

      await reader.cancel();
      expect(returnCalls).toBe(1);
    });
  });
});
