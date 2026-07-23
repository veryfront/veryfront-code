import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgentContext, AgentResponse } from "../../types.ts";
import { cacheMiddleware, createCache } from "./cache.ts";

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

  it("rejects invalid cache capacities", () => {
    assertThrows(
      () => createCache({ strategy: "lru", maxSize: 0 }),
      Error,
      "maxSize must be a positive safe integer",
    );
  });

  it("bounds memory cache entries", () => {
    const cache = createCache({ strategy: "memory", maxSize: 2 });

    cache.set("first", createResponse("first"));
    cache.set("second", createResponse("second"));
    cache.set("third", createResponse("third"));

    assertEquals(cache.size(), 2);
    assertEquals(cache.get("first"), null);
    assertEquals(cache.get("second")?.text, "second");
    cache.destroy();
  });

  it("snapshots cached responses on writes and reads", () => {
    const cache = createCache({ strategy: "memory" });
    const original = createResponse("original");
    original.metadata = { nested: { value: "original" } };

    cache.set("prompt", original);
    (original.metadata?.nested as { value: string }).value = "mutated after write";

    const firstRead = cache.get("prompt");
    assertEquals(firstRead?.metadata, { nested: { value: "original" } });
    (firstRead?.metadata?.nested as { value: string }).value = "mutated after read";

    assertEquals(cache.get("prompt")?.metadata, { nested: { value: "original" } });
    cache.destroy();
  });
});
