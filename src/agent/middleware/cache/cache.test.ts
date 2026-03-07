import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgentContext, AgentResponse } from "../../types.ts";
import { cacheMiddleware } from "./cache.ts";

function createResponse(text: string): AgentResponse {
  return {
    text,
    messages: [],
    toolCalls: [],
    status: "completed",
  };
}

describe("cacheMiddleware", () => {
  it("returns a destroyable middleware that clears cached entries", async () => {
    const middleware = cacheMiddleware({ strategy: "ttl", ttl: 60_000 });
    const context: AgentContext = { agentId: "agent", input: "hello", platform: {} };
    let executions = 0;

    const next = async (): Promise<AgentResponse> => createResponse(`response-${++executions}`);

    const first = await middleware(context, next);
    const second = await middleware(context, next);

    assertEquals(typeof middleware.destroy, "function");
    assertEquals(first.text, "response-1");
    assertEquals(second.text, "response-1");
    assertEquals(executions, 1);

    middleware.destroy();

    const third = await middleware(context, next);
    assertEquals(third.text, "response-2");
    assertEquals(executions, 2);

    middleware.destroy();
  });
});
