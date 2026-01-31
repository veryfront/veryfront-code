import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { delay } from "#std/async.ts";
import { scaleMs } from "#veryfront/testing";
import type { Tool } from "#veryfront/tool";
import { z } from "zod";
import { MemoryBackend } from "../backends/memory.ts";
import { createWorkflowClient, WorkflowClient } from "../api/workflow-client.ts";
import { branch, loop, parallel, step, waitForApproval, workflow } from "../dsl/index.ts";

function createMockTool(name: string, handler: (input: any) => any): Tool {
  return {
    id: name,
    type: "function",
    description: `Mock tool: ${name}`,
    inputSchema: z.object({}).passthrough(),
    execute: (input) => Promise.resolve(handler(input)),
  };
}

async function waitForCondition(
  check: () => Promise<boolean>,
  timeout: number,
  errorMessage: string,
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (await check()) return;
    await delay(50);
  }

  throw new Error(errorMessage);
}

async function waitForStatus(
  client: WorkflowClient,
  runId: string,
  expectedStatus: string,
  timeout = 5000,
): Promise<void> {
  await waitForCondition(
    async () => (await client.getRun(runId))?.status === expectedStatus,
    timeout,
    `Timeout waiting for status "${expectedStatus}"`,
  );
}

async function waitForApprovals(
  client: WorkflowClient,
  runId: string,
  count: number,
  timeout = 5000,
): Promise<void> {
  await waitForCondition(
    async () => (await client.getPendingApprovals(runId)).length >= count,
    timeout,
    `Timeout waiting for ${count} approvals`,
  );
}

describe("Workflow Integration", { sanitizeOps: false, sanitizeResources: false }, () => {
  let client: WorkflowClient;
  let backend: MemoryBackend;

  beforeEach((): void => {
    backend = new MemoryBackend({ debug: false });
    client = createWorkflowClient({ backend, debug: false });
  });

  afterEach(async (): Promise<void> => {
    await client.destroy();
  });

  describe("Basic Execution", () => {
    it("should execute a simple step workflow", async () => {
      let toolCalled = false;

      const mockTool = createMockTool("test-tool", (input) => {
        toolCalled = true;
        return { result: "success", input };
      });

      const simpleWorkflow = workflow({
        id: "simple",
        steps: [
          step("first", {
            tool: mockTool,
            input: { message: "hello" },
          }),
        ],
      });

      client.register(simpleWorkflow);
      const handle = await client.start("simple", { data: "test" });
      await handle.result();

      expect(toolCalled).toBe(true);
      expect((await client.getRun(handle.runId))?.status).toBe("completed");
    });

    it("should execute parallel steps", async () => {
      const executionOrder: string[] = [];

      const tool1 = createMockTool("tool1", async () => {
        await delay(50);
        executionOrder.push("tool1");
        return { tool: 1 };
      });

      const tool2 = createMockTool("tool2", async () => {
        await delay(10);
        executionOrder.push("tool2");
        return { tool: 2 };
      });

      const parallelWorkflow = workflow({
        id: "parallel-test",
        steps: [
          parallel("both", [
            step("step1", { tool: tool1 }),
            step("step2", { tool: tool2 }),
          ]),
        ],
      });

      client.register(parallelWorkflow);
      const handle = await client.start("parallel-test", {});
      await handle.result();

      expect(executionOrder).toContain("tool1");
      expect(executionOrder).toContain("tool2");
    });

    it("should execute branch based on condition", async () => {
      const executedBranch: string[] = [];

      const thenTool = createMockTool("then-tool", () => {
        executedBranch.push("then");
        return { branch: "then" };
      });

      const elseTool = createMockTool("else-tool", () => {
        executedBranch.push("else");
        return { branch: "else" };
      });

      const branchWorkflow = workflow({
        id: "branch-test",
        steps: [
          branch("check", {
            condition: (ctx) => (ctx.input as { value: number }).value > 10,
            then: [step("then-step", { tool: thenTool })],
            else: [step("else-step", { tool: elseTool })],
          }),
        ],
      });

      client.register(branchWorkflow);

      const handle1 = await client.start("branch-test", { value: 15 });
      await handle1.result();
      expect(executedBranch).toContain("then");

      executedBranch.length = 0;
      const handle2 = await client.start("branch-test", { value: 5 });
      await handle2.result();
      expect(executedBranch).toContain("else");
    });
  });

  describe("Loop Execution", () => {
    it("should execute loop until condition is false", async () => {
      let counter = 0;

      const incrementTool = createMockTool("increment", () => {
        counter++;
        return { count: counter };
      });

      const loopWorkflow = workflow({
        id: "loop-test",
        steps: [
          loop("count-loop", {
            maxIterations: 10,
            while: () => counter < 3,
            steps: [step("increment", { tool: incrementTool })],
          }),
        ],
      });

      client.register(loopWorkflow);
      const handle = await client.start("loop-test", {});
      await handle.result();

      expect(counter).toBe(3);
      expect((await client.getRun(handle.runId))?.status).toBe("completed");
    });

    it("should respect maxIterations", async () => {
      let counter = 0;

      const infiniteTool = createMockTool("infinite", () => {
        counter++;
        return { count: counter };
      });

      const loopWorkflow = workflow({
        id: "max-iter-test",
        steps: [
          loop("infinite-loop", {
            maxIterations: 5,
            while: () => true,
            steps: [step("run", { tool: infiniteTool })],
            onMaxIterations: (_ctx, loop) => ({
              hitMax: true,
              iterations: loop.totalIterations,
            }),
          }),
        ],
      });

      client.register(loopWorkflow);
      const handle = await client.start("max-iter-test", {});
      await handle.result();

      expect(counter).toBe(5);
      expect((await client.getRun(handle.runId))?.status).toBe("completed");
    });

    it("should pass loop context to steps", async () => {
      const iterations: number[] = [];

      const trackTool = createMockTool("track", (input) => {
        iterations.push(input.iteration);
        return { tracked: true };
      });

      const loopWorkflow = workflow({
        id: "context-test",
        steps: [
          loop("track-loop", {
            maxIterations: 3,
            while: (_ctx, loop) => loop.iteration < 3,
            steps: (_ctx, loop) => [
              step("track", {
                tool: trackTool,
                input: { iteration: loop.iteration },
              }),
            ],
          }),
        ],
      });

      client.register(loopWorkflow);
      const handle = await client.start("context-test", {});
      await handle.result();

      expect(iterations).toEqual([0, 1, 2]);
    });
  });

  describe("Retry Logic", () => {
    it("should retry on failure", async () => {
      let attempts = 0;

      const flakeyTool = createMockTool("flakey", () => {
        attempts++;
        if (attempts < 3) throw new Error("ECONNRESET");
        return { success: true };
      });

      const retryWorkflow = workflow({
        id: "retry-test",
        steps: [
          step("flakey-step", {
            tool: flakeyTool,
            retry: {
              maxAttempts: 5,
              backoff: "fixed",
              initialDelay: 10,
            },
          }),
        ],
      });

      client.register(retryWorkflow);
      const handle = await client.start("retry-test", {});
      await handle.result();

      expect(attempts).toBe(3);
      expect((await client.getRun(handle.runId))?.status).toBe("completed");
    });

    it("should fail after max retries", async () => {
      let attempts = 0;

      const alwaysFailTool = createMockTool("always-fail", () => {
        attempts++;
        throw new Error("ECONNREFUSED");
      });

      const retryWorkflow = workflow({
        id: "fail-test",
        steps: [
          step("fail-step", {
            tool: alwaysFailTool,
            retry: {
              maxAttempts: 3,
              backoff: "fixed",
              initialDelay: 10,
            },
          }),
        ],
      });

      client.register(retryWorkflow);
      const handle = await client.start("fail-test", {});

      await expect(handle.result()).rejects.toThrow();

      expect(attempts).toBe(3);
      expect((await client.getRun(handle.runId))?.status).toBe("failed");
    });
  });

  describe("Timeout Enforcement", () => {
    it("should timeout long-running steps", async () => {
      let timeoutId: number | undefined;

      const slowTool = createMockTool("slow", async () => {
        try {
          await new Promise((resolve) => {
            timeoutId = setTimeout(resolve, scaleMs(5000));
          });
          return { result: "done" };
        } catch {
          return { result: "cancelled" };
        }
      });

      const timeoutWorkflow = workflow({
        id: "timeout-test",
        steps: [
          step("slow-step", {
            tool: slowTool,
            timeout: 100,
          }),
        ],
      });

      client.register(timeoutWorkflow);
      const handle = await client.start("timeout-test", {});

      await expect(handle.result()).rejects.toThrow(/timed out/i);

      if (timeoutId != null) clearTimeout(timeoutId);

      expect((await client.getRun(handle.runId))?.status).toBe("failed");
    });
  });

  describe("Approval Flow", () => {
    it("should pause at waitForApproval", async () => {
      const beforeTool = createMockTool("before", () => ({ before: true }));
      const afterTool = createMockTool("after", () => ({ after: true }));

      const approvalWorkflow = workflow({
        id: "approval-test",
        steps: [
          step("before", { tool: beforeTool }),
          waitForApproval("need-approval", {
            message: "Please approve",
            timeout: "1h",
          }),
          step("after", { tool: afterTool }),
        ],
      });

      client.register(approvalWorkflow);
      const handle = await client.start("approval-test", {});

      await waitForStatus(client, handle.runId, "waiting");
      expect((await client.getRun(handle.runId))?.status).toBe("waiting");

      await waitForApprovals(client, handle.runId, 1);

      const approvals = await client.getPendingApprovals(handle.runId);
      expect(approvals.length).toBe(1);
      expect(approvals[0]?.message).toBe("Please approve");
    });

    it("should resume after approval", async () => {
      let afterExecuted = false;

      const beforeTool = createMockTool("before", () => ({ before: true }));
      const afterTool = createMockTool("after", () => {
        afterExecuted = true;
        return { after: true };
      });

      const approvalWorkflow = workflow({
        id: "resume-test",
        steps: [
          step("before", { tool: beforeTool }),
          waitForApproval("need-approval", {
            message: "Please approve",
            timeout: "1h",
          }),
          step("after", { tool: afterTool }),
        ],
      });

      client.register(approvalWorkflow);
      const handle = await client.start("resume-test", {});

      await waitForStatus(client, handle.runId, "waiting");
      await waitForApprovals(client, handle.runId, 1);

      const approvals = await client.getPendingApprovals(handle.runId);
      await client.approve(handle.runId, approvals[0]!.id, "test@test.com");

      await handle.result();

      expect(afterExecuted).toBe(true);
      expect((await client.getRun(handle.runId))?.status).toBe("completed");
    });
  });
});

describe("Cron Job Pattern", { sanitizeOps: false, sanitizeResources: false }, () => {
  it("should support infinite loop with delay (cron pattern)", async () => {
    let iterations = 0;
    const maxIterations = 3;

    const cronTool = createMockTool("cron-task", () => {
      iterations++;
      return { ran: true, iteration: iterations };
    });

    const cronWorkflow = workflow({
      id: "cron-job",
      steps: [
        loop("cron-loop", {
          maxIterations,
          while: () => iterations < maxIterations,
          delay: 50,
          steps: [step("run-task", { tool: cronTool })],
        }),
      ],
    });

    const backend = new MemoryBackend();
    const client = createWorkflowClient({ backend });
    client.register(cronWorkflow);

    const startTime = Date.now();
    const handle = await client.start("cron-job", {});
    await handle.result();
    const elapsed = Date.now() - startTime;

    expect(iterations).toBe(3);
    expect(elapsed).toBeGreaterThanOrEqual(100);

    await client.destroy();
  });
});
