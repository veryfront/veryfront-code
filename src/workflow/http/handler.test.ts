import "#veryfront/schemas/_test-setup.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { withEnv } from "#veryfront/testing/deno-compat.ts";
import { expect } from "#std/expect.ts";
import { delay } from "#std/async.ts";
import type { Tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { PendingApproval, RunFilter, WorkflowRun } from "../types.ts";
import { MemoryBackend } from "../backends/memory.ts";
import { createWorkflowClient, type WorkflowClient } from "../api/workflow-client.ts";
import { step, waitForApproval, workflow } from "../dsl/index.ts";
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

function slowTool(id: string): Tool {
  return {
    id,
    type: "function",
    description: `Slow test tool: ${id}`,
    inputSchema: defineSchema((v) => v.object({}).passthrough())(),
    execute: async () => {
      await delay(5_000);
      return { ok: true };
    },
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
    handlers = createWorkflowHandler(client);
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
    const context = run.context as Record<string, unknown>;
    expect(context.env).toBeUndefined();
    expect(run._tenant).toBeUndefined();
    expect(run.workerId).toBeUndefined();
    expect(run.heartbeatAt).toBeUndefined();
    expect(run.checkpoints).toBeUndefined();
    // useWorkflow derives status, progress and approvals from exactly these.
    expect(run.status).toBeDefined();
    expect(run.nodeStates).toBeDefined();
  });

  it("uses the approvals hydrated by the run read", async () => {
    await client.destroy();
    const backend = new CountingMemoryBackend({ debug: false });
    client = createWorkflowClient({ backend, debug: false });
    client.register(
      workflow({ id: "pipeline", steps: [step("only", { tool: passthroughTool("noop") })] }),
    );
    handlers = createWorkflowHandler(client);

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
    expect(listed?.workerId).toBeUndefined();
    expect(listed?.checkpoints).toBeUndefined();
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

    // useWorkflow surfaces approvals off the run body, so the run has to carry
    // them, not just the approval manager.
    const runResponse = await handlers.GET(get(`/api/workflows/runs/${runId}`));
    const run = await runResponse.json() as { pendingApprovals?: Array<{ id: string }> };
    expect(run.pendingApprovals?.length).toBe(1);
    const approvalId = run.pendingApprovals?.[0]?.id;
    expect(typeof approvalId).toBe("string");

    const fetched = await handlers.GET(
      get(`/api/workflows/runs/${runId}/approvals/${approvalId}`),
    );
    expect(fetched.status).toBe(200);

    const decided = await handlers.POST(
      post(`/api/workflows/runs/${runId}/approvals/${approvalId}`, {
        approved: true,
        approver: "tester",
      }),
    );
    expect(decided.status).toBe(200);
  });

  it("rejects an approval decision that omits the approved flag", async () => {
    const runId = await startRun();

    const response = await handlers.POST(
      post(`/api/workflows/runs/${runId}/approvals/whatever`, { approver: "tester" }),
    );

    expect(response.status).toBe(400);
  });

  it("resolves routes against a custom basePath", async () => {
    const mounted = createWorkflowHandler(client, { basePath: "/api/flows" });

    const response = await mounted.POST(post("/api/flows/pipeline/start", { input: {} }));
    expect(response.status).toBe(200);

    // The default mount point must not answer once basePath moved.
    expect((await mounted.GET(get("/api/workflows/runs"))).status).toBe(404);
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
    handlers = createWorkflowHandler(client);

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
});
