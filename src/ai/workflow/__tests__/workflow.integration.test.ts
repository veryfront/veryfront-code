/**
 * Workflow Integration Tests
 *
 * Tests the full workflow execution pipeline including:
 * - DAG execution
 * - Loop handling
 * - Retry logic
 * - Timeout enforcement
 * - Approval flow
 */

import { afterEach, beforeEach, describe, it } from "jsr:@std/testing/bdd";
import { expect } from "jsr:@std/expect";
import { createWorkflowClient, WorkflowClient } from "../api/workflow-client.ts";
import { branch, loop, parallel, step, waitForApproval, workflow } from "../dsl/index.ts";
import { MemoryBackend } from "../backends/memory.ts";
import type { Tool } from "../../types/tool.ts";
import { z } from "zod";

// Mock tool for testing
const createMockTool = (name: string, handler: (input: any) => any): Tool => ({
  id: name,
  description: `Mock tool: ${name}`,
  parameters: z.object({}).passthrough(),
  execute: (input) => Promise.resolve(handler(input)),
});

describe("Workflow Integration", () => {
  let client: WorkflowClient;
  let backend: MemoryBackend;

  beforeEach(() => {
    backend = new MemoryBackend({ debug: false });
    client = createWorkflowClient({
      backend,
      debug: false,
    });
  });

  afterEach(async () => {
    await client.destroy();
  });

  describe("Basic Execution", () => {
    it("should execute a simple step workflow", async () => {
      let toolCalled = false;

      const mockTool = createMockTool("test-tool", (input) => {
        toolCalled = true;
        return { result: "success", input };
      });

      const simpleWorkflow = workflow("simple", {
        steps: [
          step("first", {
            tool: mockTool,
            input: { message: "hello" },
          }),
        ],
      });

      client.register(simpleWorkflow);
      const handle = await client.start("simple", { data: "test" });
      const result = await handle.result();

      expect(toolCalled).toBe(true);
      expect(result.status).toBe("completed");
    });

    it("should execute parallel steps", async () => {
      const executionOrder: string[] = [];

      const tool1 = createMockTool("tool1", async () => {
        await new Promise((r) => setTimeout(r, 50));
        executionOrder.push("tool1");
        return { tool: 1 };
      });

      const tool2 = createMockTool("tool2", async () => {
        await new Promise((r) => setTimeout(r, 10));
        executionOrder.push("tool2");
        return { tool: 2 };
      });

      const parallelWorkflow = workflow("parallel-test", {
        steps: [
          parallel("both", {
            nodes: [
              step("step1", { tool: tool1 }),
              step("step2", { tool: tool2 }),
            ],
          }),
        ],
      });

      client.register(parallelWorkflow);
      const handle = await client.start("parallel-test", {});
      await handle.result();

      // tool2 should finish first since it has shorter delay
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

      const branchWorkflow = workflow("branch-test", {
        steps: [
          branch("check", {
            condition: (ctx) => ctx.input.value > 10,
            then: [step("then-step", { tool: thenTool })],
            else: [step("else-step", { tool: elseTool })],
          }),
        ],
      });

      client.register(branchWorkflow);

      // Test "then" branch
      const handle1 = await client.start("branch-test", { value: 15 });
      await handle1.result();
      expect(executedBranch).toContain("then");

      // Reset and test "else" branch
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

      const loopWorkflow = workflow("loop-test", {
        steps: [
          loop("count-loop", {
            maxIterations: 10,
            while: () => counter < 3,
            steps: [
              step("increment", { tool: incrementTool }),
            ],
          }),
        ],
      });

      client.register(loopWorkflow);
      const handle = await client.start("loop-test", {});
      const result = await handle.result();

      expect(counter).toBe(3);
      expect(result.status).toBe("completed");
    });

    it("should respect maxIterations", async () => {
      let counter = 0;

      const infiniteTool = createMockTool("infinite", () => {
        counter++;
        return { count: counter };
      });

      const loopWorkflow = workflow("max-iter-test", {
        steps: [
          loop("infinite-loop", {
            maxIterations: 5,
            while: () => true, // Always true
            steps: [
              step("run", { tool: infiniteTool }),
            ],
            onMaxIterations: (_ctx, loop) => ({
              hitMax: true,
              iterations: loop.totalIterations,
            }),
          }),
        ],
      });

      client.register(loopWorkflow);
      const handle = await client.start("max-iter-test", {});
      const result = await handle.result();

      expect(counter).toBe(5);
      expect(result.status).toBe("completed");
    });

    it("should pass loop context to steps", async () => {
      const iterations: number[] = [];

      const trackTool = createMockTool("track", (input) => {
        iterations.push(input.iteration);
        return { tracked: true };
      });

      const loopWorkflow = workflow("context-test", {
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
        if (attempts < 3) {
          throw new Error("ECONNRESET");
        }
        return { success: true };
      });

      const retryWorkflow = workflow("retry-test", {
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
      const result = await handle.result();

      expect(attempts).toBe(3);
      expect(result.status).toBe("completed");
    });

    it("should fail after max retries", async () => {
      let attempts = 0;

      const alwaysFailTool = createMockTool("always-fail", () => {
        attempts++;
        throw new Error("ECONNREFUSED");
      });

      const retryWorkflow = workflow("fail-test", {
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
      const result = await handle.result();

      expect(attempts).toBe(3);
      expect(result.status).toBe("failed");
    });
  });

  describe("Timeout Enforcement", () => {
    it("should timeout long-running steps", async () => {
      const slowTool = createMockTool("slow", async () => {
        await new Promise((r) => setTimeout(r, 5000));
        return { result: "done" };
      });

      const timeoutWorkflow = workflow("timeout-test", {
        steps: [
          step("slow-step", {
            tool: slowTool,
            timeout: 100, // 100ms timeout
          }),
        ],
      });

      client.register(timeoutWorkflow);
      const handle = await client.start("timeout-test", {});
      const result = await handle.result();

      expect(result.status).toBe("failed");
      expect(result.error).toMatch(/timed out/i);
    });
  });

  describe("Approval Flow", () => {
    it("should pause at waitForApproval", async () => {
      const mockTool = createMockTool("before", () => ({ before: true }));
      const afterTool = createMockTool("after", () => ({ after: true }));

      const approvalWorkflow = workflow("approval-test", {
        steps: [
          step("before", { tool: mockTool }),
          waitForApproval("need-approval", {
            message: "Please approve",
            timeout: "1h",
          }),
          step("after", { tool: afterTool }),
        ],
      });

      client.register(approvalWorkflow);
      const handle = await client.start("approval-test", {});

      // Wait a bit for workflow to reach approval
      await new Promise((r) => setTimeout(r, 100));

      const run = await client.getRun(handle.runId);
      expect(run?.status).toBe("waiting");

      // Get pending approvals
      const approvals = await client.getPendingApprovals(handle.runId);
      expect(approvals.length).toBe(1);
      expect(approvals[0]?.message).toBe("Please approve");
    });

    it("should resume after approval", async () => {
      let afterExecuted = false;
      const mockTool = createMockTool("before", () => ({ before: true }));
      const afterTool = createMockTool("after", () => {
        afterExecuted = true;
        return { after: true };
      });

      const approvalWorkflow = workflow("resume-test", {
        steps: [
          step("before", { tool: mockTool }),
          waitForApproval("need-approval", {
            message: "Please approve",
            timeout: "1h",
          }),
          step("after", { tool: afterTool }),
        ],
      });

      client.register(approvalWorkflow);
      const handle = await client.start("resume-test", {});

      // Wait for workflow to reach approval
      await new Promise((r) => setTimeout(r, 100));

      // Approve
      const approvals = await client.getPendingApprovals(handle.runId);
      await client.approve(handle.runId, approvals[0]!.id, "test@test.com");

      // Wait for completion
      const result = await handle.result();

      expect(afterExecuted).toBe(true);
      expect(result.status).toBe("completed");
    });
  });
});

describe("Cron Job Pattern", () => {
  it("should support infinite loop with delay (cron pattern)", async () => {
    let iterations = 0;
    const maxIterations = 3; // For test, limit to 3

    const cronTool = createMockTool("cron-task", () => {
      iterations++;
      return { ran: true, iteration: iterations };
    });

    // Simulate a cron-like workflow using loop with delay
    const cronWorkflow = workflow("cron-job", {
      steps: [
        loop("cron-loop", {
          maxIterations, // In production, set high (e.g., 1000000)
          while: () => iterations < maxIterations,
          delay: 50, // 50ms delay between iterations (in prod: "1m", "1h", etc)
          steps: [
            step("run-task", { tool: cronTool }),
          ],
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
    // Should take at least 100ms (2 delays of 50ms between 3 iterations)
    expect(elapsed).toBeGreaterThanOrEqual(100);

    await client.destroy();
  });
});
