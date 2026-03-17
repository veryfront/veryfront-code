import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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
