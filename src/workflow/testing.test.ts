import "#veryfront/schemas/_test-setup.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import type { Tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { step, waitForApproval, workflow } from "./dsl/index.ts";
import { startWorkflowTest, type WorkflowTestHarness } from "./testing.ts";

function recordingTool(id: string, order: string[]): Tool {
  return {
    id,
    type: "function",
    description: `Test tool: ${id}`,
    inputSchema: defineSchema((v) => v.object({}).passthrough())(),
    execute: () => {
      order.push(id);
      // Distinct completion timestamps: `steps()` orders by completedAt, and a
      // same-millisecond tie would make the ordering assertion meaningless.
      return new Promise((resolve) => setTimeout(() => resolve({ ok: true, id }), 2));
    },
  };
}

function explodingTool(id: string): Tool {
  return {
    id,
    type: "function",
    description: `Failing test tool: ${id}`,
    inputSchema: defineSchema((v) => v.object({}).passthrough())(),
    execute: () => Promise.reject(new Error("tool blew up")),
  };
}

function stallingTool(id: string): Tool {
  return {
    id,
    type: "function",
    description: `Stalling test tool: ${id}`,
    inputSchema: defineSchema((v) => v.object({}).passthrough())(),
    execute: () => new Promise(() => {}),
  };
}

describe("workflow/testing", { sanitizeOps: false, sanitizeResources: false }, () => {
  const open: WorkflowTestHarness[] = [];

  afterEach(async () => {
    while (open.length) await open.pop()?.dispose();
  });

  async function start(
    ...args: Parameters<typeof startWorkflowTest>
  ): Promise<WorkflowTestHarness> {
    const harness = await startWorkflowTest(...args);
    open.push(harness);
    return harness;
  }

  it("runs a workflow to completion and reports the steps in order", async () => {
    const order: string[] = [];
    const harness = await start(
      workflow({
        id: "pipeline",
        steps: [
          step("fetch", { tool: recordingTool("fetch", order) }),
          step("load", { tool: recordingTool("load", order) }),
        ],
      }),
      { input: { source: "s3://bucket/key" } },
    );

    const run = await harness.settled();

    expect(run.status).toBe("completed");
    await harness.assertSteps(["fetch", "load"]);
    expect(order).toEqual(["fetch", "load"]);
  });

  it("exposes the context the steps accumulated", async () => {
    const harness = await start(
      workflow({ id: "one-step", steps: [step("only", { tool: recordingTool("only", []) })] }),
      {},
    );

    await harness.settled();

    expect(await harness.context()).toBeDefined();
  });

  it("resolves an approval by the node id the author wrote", async () => {
    // Addressing by node id is the point: the approval's own id is generated,
    // so a test would otherwise have to read the run to find it first.
    const harness = await start(
      workflow({
        id: "gated",
        steps: [
          step("prepare", { tool: recordingTool("prepare", []) }),
          waitForApproval("review", { message: "ok?" }),
          step("publish", { tool: recordingTool("publish", []) }),
        ],
      }),
      {},
    );

    await harness.reaches("waiting");
    await harness.approve("review");

    const run = await harness.settled();
    expect(run.status).toBe("completed");
    await harness.assertSteps(["prepare", "review", "publish"]);
  });

  it("waits for the approval to exist before deciding it", async () => {
    // No `reaches("waiting")` first: approve() must poll for the approval
    // rather than race the run into existence.
    const harness = await start(
      workflow({
        id: "gated-immediate",
        steps: [
          waitForApproval("review", { message: "ok?" }),
          step("publish", { tool: recordingTool("publish", []) }),
        ],
      }),
      {},
    );

    await harness.approve("review");

    expect((await harness.settled()).status).toBe("completed");
  });

  it("surfaces a rejected approval as a run that did not complete", async () => {
    const harness = await start(
      workflow({
        id: "gated-reject",
        steps: [
          waitForApproval("review", { message: "ok?" }),
          step("publish", { tool: recordingTool("publish", []) }),
        ],
      }),
      {},
    );

    await harness.reject("review", { comment: "not this time" });
    const run = await harness.settled();

    expect(run.status).not.toBe("completed");
    expect(await harness.steps()).not.toContain("publish");
  });

  it("reports pending approvals", async () => {
    const harness = await start(
      workflow({
        id: "gated-list",
        steps: [waitForApproval("review", { message: "ok?" })],
      }),
      {},
    );

    const approvals = await harness.approvals();

    expect(approvals.length).toBeGreaterThanOrEqual(1);
    expect(approvals[0]?.nodeId).toBe("review");
  });

  it("settles a failing run instead of hanging on it", async () => {
    const harness = await start(
      workflow({ id: "broken", steps: [step("boom", { tool: explodingTool("boom") })] }),
      {},
    );

    const run = await harness.settled();

    expect(run.status).toBe("failed");
    await harness.assertStatus("failed");
  });

  it("cancels a run", async () => {
    const harness = await start(
      workflow({ id: "stalls", steps: [step("forever", { tool: stallingTool("forever") })] }),
      {},
    );

    await harness.cancel();

    expect((await harness.settled()).status).toBe("cancelled");
  });

  describe("failure reporting", () => {
    it("names the run's state when a wait times out, not just the deadline", async () => {
      // The whole reason this harness exists: a timeout that says only "timed
      // out" sends the author back to add logging.
      const harness = await start(
        workflow({ id: "stalls-2", steps: [step("forever", { tool: stallingTool("forever") })] }),
        { timeoutMs: 60 },
      );

      const error = await harness.settled().then(() => null, (e: Error) => e);

      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain(harness.runId);
      expect(message).toContain("status=running");
      // A run mid-step persists no node state, so the engine genuinely cannot
      // name the stuck step. The message has to say that rather than print an
      // empty list that reads like a corrupt run.
      expect(message).toContain("unrecorded");

      await harness.cancel();
    });

    it("names the pending approvals when waiting for the wrong node", async () => {
      const harness = await start(
        workflow({ id: "gated-3", steps: [waitForApproval("review", { message: "ok?" })] }),
        { timeoutMs: 60 },
      );

      const error = await harness.approve("nonexistent").then(() => null, (e: Error) => e);

      expect((error as Error).message).toContain('node "nonexistent"');
      expect((error as Error).message).toContain("review");
    });

    it("shows what actually ran when a step assertion fails", async () => {
      const harness = await start(
        workflow({ id: "pipeline-2", steps: [step("only", { tool: recordingTool("only", []) })] }),
        {},
      );
      await harness.settled();

      const error = await harness.assertSteps(["only", "missing"]).then(
        () => null,
        (e: Error) => e,
      );

      expect((error as Error).message).toContain("ran [only]");
      expect((error as Error).message).toContain("missing");
    });
  });

  it("names the step a paused run is waiting on", async () => {
    // The counterpart to the case above: a run that pauses does persist its
    // node states, so the diagnostic can name the node -- and this pins which
    // of the two shapes a given status produces.
    const harness = await start(
      workflow({
        id: "gated-diag",
        steps: [
          step("prepare", { tool: recordingTool("prepare", []) }),
          waitForApproval("review", { message: "ok?" }),
        ],
      }),
      { timeoutMs: 2_000 },
    );
    await harness.reaches("waiting");

    const error = await harness.reaches("completed").then(() => null, (e: Error) => e);

    const message = (error as Error).message;
    expect(message).toContain("executing: review");
    expect(message).toContain("prepare=completed");
    expect(message).toContain("pending approvals: review");
  });

  it("isolates harnesses from each other", async () => {
    // Each harness gets its own backend by default, so one test's run is never
    // visible to another's assertions.
    const a = await start(
      workflow({ id: "iso", steps: [step("s", { tool: recordingTool("s", []) })] }),
      {},
    );
    const b = await start(
      workflow({ id: "iso", steps: [step("s", { tool: recordingTool("s", []) })] }),
      {},
    );

    await a.settled();
    await b.settled();

    expect(a.runId).not.toBe(b.runId);
    expect(await a.client.getRun(b.runId)).toBeNull();
  });

  it("is safe to dispose more than once", async () => {
    const harness = await startWorkflowTest(
      workflow({ id: "disposable", steps: [step("s", { tool: recordingTool("s", []) })] }),
      {},
    );
    await harness.settled();

    await harness.dispose();
    await harness.dispose();
  });
});
