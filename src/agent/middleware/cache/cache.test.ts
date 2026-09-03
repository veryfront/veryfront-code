import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
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

  it("hits the cache for identical messages despite synthesized ids and timestamps", async () => {
    // The runtime normalizes structured input before middleware runs, stamping
    // the current time onto messages that omit `id`/`timestamp`. The same
    // caller message on a later millisecond must still produce the same key.
    const middleware = cacheMiddleware({ strategy: "memory" });
    let executions = 0;
    const next = async (): Promise<AgentResponse> => createResponse(`response-${++executions}`);

    const contextAt = (stamp: number): AgentContext => ({
      agentId: "agent",
      input: [
        {
          id: `msg_${stamp}_0`,
          role: "user",
          parts: [{ type: "text", text: "hello" }],
          timestamp: stamp,
        },
      ],
      platform: {},
    });

    const first = await middleware(contextAt(1_000), next);
    const second = await middleware(contextAt(2_000), next);

    assertEquals(first.text, "response-1");
    assertEquals(second.text, "response-1", "synthesized fields must not change the cache key");
    assertEquals(executions, 1);

    const third = await middleware(
      {
        agentId: "agent",
        input: [
          {
            id: "msg_3000_0",
            role: "user",
            parts: [{ type: "text", text: "different" }],
            timestamp: 3_000,
          },
        ],
        platform: {},
      },
      next,
    );
    assertEquals(third.text, "response-2", "different content must miss the cache");

    middleware.destroy();
  });
});

describe("createCache key isolation", () => {
  it("scopes entries by project so one project cannot read another's response", () => {
    const cache = createCache({ strategy: "memory" });

    cache.set("hello", createResponse("p1-response"), { projectId: "p1" });
    cache.set("hello", createResponse("p2-response"), { projectId: "p2" });

    assertEquals(
      cache.get("hello", { projectId: "p2" })?.text,
      "p2-response",
      "a second project must not read the first project's cached response",
    );
    assertEquals(
      cache.get("hello", { projectId: "p1" })?.text,
      "p1-response",
      "each project reads back its own cached response",
    );
    assertEquals(cache.size(), 2, "per-project entries must not collide");
    assertEquals(
      cache.get("hello", {}),
      null,
      "an unscoped context must not read project-scoped entries",
    );
  });

  it("honors the project.id fallback when reading a project-scoped entry", () => {
    const cache = createCache({ strategy: "memory" });

    cache.set("hello", createResponse("p1-response"), { project: { id: "p1" } });

    assertEquals(
      cache.get("hello", { projectId: "p1" })?.text,
      "p1-response",
      "a project.id context resolves to the same project scope as projectId",
    );
  });

  it("honors the renderContext.projectId fallback when reading a project-scoped entry", () => {
    const cache = createCache({ strategy: "memory" });

    cache.set("hello", createResponse("p1-response"), { renderContext: { projectId: "p1" } });

    assertEquals(
      cache.get("hello", { projectId: "p1" })?.text,
      "p1-response",
      "a renderContext.projectId context resolves to the same project scope as projectId",
    );
  });
});
