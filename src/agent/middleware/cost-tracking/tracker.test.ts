import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgentContext, AgentResponse } from "../../types.ts";
import { costTrackingMiddleware } from "./tracker.ts";

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
    const context: AgentContext = {
      agentId: "agent",
      model: "openai/gpt-4.1",
      input: "hello",
      data: {},
      platform: {},
    };
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
});
