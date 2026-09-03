import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgentContext, AgentResponse, Message } from "../../types.ts";
import { normalizeInput } from "../../runtime/input-utils.ts";
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

    const originalNow = Date.now;
    const normalizedAt = (stamp: number, text: string): Message[] => {
      Date.now = () => stamp;
      try {
        return normalizeInput([
          { role: "user", parts: [{ type: "text", text }] },
        ] as unknown as Message[]);
      } finally {
        Date.now = originalNow;
      }
    };

    const contextFor = (input: Message[]): AgentContext => ({
      agentId: "agent",
      input,
      platform: {},
    });

    const first = await middleware(contextFor(normalizedAt(1_000, "hello")), next);
    const second = await middleware(contextFor(normalizedAt(2_000, "hello")), next);

    assertEquals(first.text, "response-1");
    assertEquals(second.text, "response-1", "synthesized fields must not change the cache key");
    assertEquals(executions, 1);

    const third = await middleware(contextFor(normalizedAt(3_000, "different")), next);
    assertEquals(third.text, "response-2", "different content must miss the cache");

    middleware.destroy();
  });

  it("keeps caller-supplied message identity in the cache key", async () => {
    // An explicit `id` or `timestamp` can shape the provider request through
    // hooks such as `resolveRuntimeState`, so calls that differ only in those
    // caller-supplied fields must not share a cached response.
    const middleware = cacheMiddleware({ strategy: "memory" });
    let executions = 0;
    const next = async (): Promise<AgentResponse> => createResponse(`response-${++executions}`);

    const contextWithId = (id: string): AgentContext => ({
      agentId: "agent",
      input: normalizeInput([
        { id, role: "user", parts: [{ type: "text", text: "hello" }], timestamp: 1_000 },
      ]),
      platform: {},
    });

    const first = await middleware(contextWithId("caller-1"), next);
    const second = await middleware(contextWithId("caller-2"), next);
    const repeat = await middleware(contextWithId("caller-1"), next);

    assertEquals(first.text, "response-1");
    assertEquals(second.text, "response-2", "an explicit id is part of cache identity");
    assertEquals(repeat.text, "response-1", "the same explicit id still hits the cache");
    assertEquals(executions, 2);

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
