import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import type { AgentContext, AgentResponse } from "../../types.ts";
import { costTrackingMiddleware, createCostTracker } from "./tracker.ts";

function createResponse(): AgentResponse {
  return {
    text: "ok",
    messages: [],
    toolCalls: [],
    status: "completed",
    usage: {
      promptTokens: 1_000_000,
      completionTokens: 0,
      totalTokens: 1_000_000,
    },
  };
}

function createContext(overrides?: Partial<AgentContext>): AgentContext {
  return {
    agentId: "agent",
    model: "openai/gpt-4.1",
    input: "hello",
    data: {},
    platform: {},
    ...overrides,
  };
}

describe("costTrackingMiddleware", () => {
  it("returns a destroyable middleware that resets tracked totals", async () => {
    const exceeded: number[] = [];
    const middleware = costTrackingMiddleware({
      pricing: { openai: { input: 1, output: 0 } },
      limits: { daily: 1.5 },
      onLimitExceeded(summary) {
        exceeded.push(summary.requests);
      },
    });
    const context = createContext();
    const next = async (): Promise<AgentResponse> => createResponse();

    await middleware(context, next);
    await middleware(context, next);

    assertEquals(typeof middleware.destroy, "function");
    assertEquals(exceeded.length, 1);

    middleware.destroy();

    await middleware(context, next);
    assertEquals(exceeded.length, 1);

    middleware.destroy();
  });

  it("throws a VeryfrontError with cost-limit-exceeded slug when daily limit exceeded", async () => {
    const middleware = costTrackingMiddleware({
      pricing: { openai: { input: 1, output: 0 } },
      limits: { daily: 0.5 },
    });
    const context = createContext();
    const next = async (): Promise<AgentResponse> => createResponse();

    // First call costs $1 (1M tokens * $1/1M), exceeds $0.50 limit
    await middleware(context, next);

    // Second call should be blocked before execution
    const error = await assertRejects(
      () => middleware(context, next),
      VeryfrontError,
    );
    assertEquals(error.slug, "cost-limit-exceeded");

    middleware.destroy();
  });

  it("throws a VeryfrontError when monthly limit exceeded", async () => {
    const middleware = costTrackingMiddleware({
      pricing: { openai: { input: 1, output: 0 } },
      limits: { monthly: 0.5 },
    });
    const context = createContext();
    const next = async (): Promise<AgentResponse> => createResponse();

    await middleware(context, next);

    const error = await assertRejects(
      () => middleware(context, next),
      VeryfrontError,
    );
    assertEquals(error.slug, "cost-limit-exceeded");

    middleware.destroy();
  });

  it("throws a VeryfrontError when per-user daily limit exceeded", async () => {
    const middleware = costTrackingMiddleware({
      pricing: { openai: { input: 1, output: 0 } },
      limits: { userDaily: 0.5 },
    });
    const userContext = createContext({ data: { userId: "user-1" } });
    const next = async (): Promise<AgentResponse> => createResponse();

    await middleware(userContext, next);

    const error = await assertRejects(
      () => middleware(userContext, next),
      VeryfrontError,
    );
    assertEquals(error.slug, "cost-limit-exceeded");

    middleware.destroy();
  });

  it("tracks per-user costs independently", async () => {
    const middleware = costTrackingMiddleware({
      pricing: { openai: { input: 1, output: 0 } },
      limits: { userDaily: 0.5 },
    });
    const user1Context = createContext({ data: { userId: "user-1" } });
    const user2Context = createContext({ data: { userId: "user-2" } });
    const next = async (): Promise<AgentResponse> => createResponse();

    // user-1 exceeds limit
    await middleware(user1Context, next);

    // user-2 should still be allowed (independent tracking)
    await middleware(user2Context, next);

    // user-1 should be blocked
    await assertRejects(() => middleware(user1Context, next), VeryfrontError);

    middleware.destroy();
  });

  it("allows requests when under budget", async () => {
    const middleware = costTrackingMiddleware({
      pricing: { openai: { input: 1, output: 0 } },
      limits: { daily: 10 },
    });
    const context = createContext();
    const next = async (): Promise<AgentResponse> => createResponse();

    // $1 per call, limit is $10 — should succeed
    const result = await middleware(context, next);
    assertEquals(result.status, "completed");

    middleware.destroy();
  });

  it("fires onLimitExceeded for per-user daily limit", async () => {
    const exceeded: number[] = [];
    const middleware = costTrackingMiddleware({
      pricing: { openai: { input: 1, output: 0 } },
      limits: { userDaily: 0.5 },
      onLimitExceeded(summary) {
        exceeded.push(summary.requests);
      },
    });
    const context = createContext({ data: { userId: "user-1" } });
    const next = async (): Promise<AgentResponse> => createResponse();

    // First call costs $1, exceeds $0.50 user daily limit
    await middleware(context, next);
    assertEquals(exceeded.length, 1);

    middleware.destroy();
  });

  it("fires onLimitExceeded at most once per track call even when multiple limits exceeded", async () => {
    const exceeded: number[] = [];
    const middleware = costTrackingMiddleware({
      pricing: { openai: { input: 1, output: 0 } },
      // Both daily and monthly set below 1 call cost ($1)
      limits: { daily: 0.5, monthly: 0.5 },
      onLimitExceeded(summary) {
        exceeded.push(summary.requests);
      },
    });
    const context = createContext();
    const next = async (): Promise<AgentResponse> => createResponse();

    // Single call costs $1, exceeds both daily ($0.50) and monthly ($0.50)
    await middleware(context, next);

    // onLimitExceeded should fire exactly once, not twice
    assertEquals(exceeded.length, 1);

    middleware.destroy();
  });
});

describe("createCostTracker", () => {
  it("isOverBudget returns null when under all limits", () => {
    const tracker = createCostTracker({
      pricing: { openai: { input: 1, output: 0 } },
      limits: { daily: 100, monthly: 1000, userDaily: 50 },
    });

    assertEquals(tracker.isOverBudget(), null);
    assertEquals(tracker.isOverBudget("user-1"), null);

    tracker.destroy();
  });

  it("isOverBudget returns message when daily limit exceeded", () => {
    const tracker = createCostTracker({
      pricing: { openai: { input: 1, output: 0 } },
      limits: { daily: 0.5 },
    });

    tracker.track("agent", "openai/gpt-4.1", createResponse());

    const result = tracker.isOverBudget();
    assertEquals(result, "Daily cost limit exceeded");

    tracker.destroy();
  });

  it("isOverBudget returns message when monthly limit exceeded", () => {
    const tracker = createCostTracker({
      pricing: { openai: { input: 1, output: 0 } },
      limits: { monthly: 0.5 },
    });

    tracker.track("agent", "openai/gpt-4.1", createResponse());

    const result = tracker.isOverBudget();
    assertEquals(result, "Monthly cost limit exceeded");

    tracker.destroy();
  });

  it("isOverBudget returns message when per-user daily limit exceeded", () => {
    const tracker = createCostTracker({
      pricing: { openai: { input: 1, output: 0 } },
      limits: { userDaily: 0.5 },
    });

    tracker.track("agent", "openai/gpt-4.1", createResponse(), "user-1");

    const result = tracker.isOverBudget("user-1");
    assertEquals(result, "Per-user daily cost limit exceeded");

    // Different user should be fine
    assertEquals(tracker.isOverBudget("user-2"), null);

    tracker.destroy();
  });

  it("userDailyTotals reset on daily clear", () => {
    const tracker = createCostTracker({
      pricing: { openai: { input: 1, output: 0 } },
      limits: { userDaily: 0.5 },
    });

    tracker.track("agent", "openai/gpt-4.1", createResponse(), "user-1");
    assertEquals(tracker.isOverBudget("user-1"), "Per-user daily cost limit exceeded");

    // clear simulates daily reset
    tracker.clear();
    assertEquals(tracker.isOverBudget("user-1"), null);

    tracker.destroy();
  });

  it("onLimitExceeded fires at most once per track call when multiple limits exceeded", () => {
    const exceeded: string[] = [];
    const tracker = createCostTracker({
      pricing: { openai: { input: 1, output: 0 } },
      limits: { daily: 0.5, monthly: 0.5 },
      onLimitExceeded() {
        exceeded.push("called");
      },
    });

    tracker.track("agent", "openai/gpt-4.1", createResponse());

    // Should fire once, not once per exceeded limit
    assertEquals(exceeded.length, 1);

    tracker.destroy();
  });

  it("caps userDailyTotals size to prevent unbounded memory growth", () => {
    const tracker = createCostTracker({
      pricing: { openai: { input: 1, output: 0 } },
      limits: { daily: 1_000_000 },
      maxTrackedUsers: 3,
    });

    // Track 5 different users — only 3 should be retained
    for (let i = 0; i < 5; i++) {
      tracker.track("agent", "openai/gpt-4.1", createResponse(), `user-${i}`);
    }

    assertEquals(tracker.getTrackedUserCount() <= 3, true);

    tracker.destroy();
  });
});
