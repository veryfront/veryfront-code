import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgentContext, AgentResponse, Message } from "#veryfront/agent/types.ts";
import { normalizeInput } from "#veryfront/agent/runtime/input-utils.ts";
import { cacheMiddleware, createCache } from "./cache.ts";

/**
 * Wait until the wall clock leaves the current millisecond.
 *
 * `normalizeInput` derives synthetic message ids and timestamps from
 * `Date.now()`, so two inputs built inside one millisecond carry identical
 * synthesized identity and prove nothing about what the cache key ignores.
 */
async function leaveCurrentMillisecond(): Promise<void> {
  const start = Date.now();
  while (Date.now() === start) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

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

  it("hits for identical messages despite synthesized ids and timestamps", async () => {
    const middleware = cacheMiddleware({ strategy: "memory" });
    let executions = 0;
    const next = async (): Promise<AgentResponse> => createResponse(`response-${++executions}`);
    const inputFor = (text: string): Message[] =>
      normalizeInput([
        { role: "user", parts: [{ type: "text", text }] },
      ] as unknown as Message[]);
    const contextFor = (input: Message[]): AgentContext => ({
      agentId: "agent",
      input,
      platform: {},
    });

    const first = inputFor("hello");
    await leaveCurrentMillisecond();
    const second = inputFor("hello");
    assertEquals(
      first[0]?.id === second[0]?.id,
      false,
      "the two inputs must carry different synthesized ids for this to prove anything",
    );

    assertEquals((await middleware(contextFor(first), next)).text, "response-1");
    assertEquals((await middleware(contextFor(second), next)).text, "response-1");
    await leaveCurrentMillisecond();
    assertEquals((await middleware(contextFor(inputFor("different")), next)).text, "response-2");
    assertEquals(executions, 2);
    middleware.destroy();
  });

  it("keeps caller-supplied message identity in the cache key", async () => {
    const middleware = cacheMiddleware({ strategy: "memory" });
    let executions = 0;
    const next = async (): Promise<AgentResponse> => createResponse(`response-${++executions}`);
    const contextWithId = (id: string): AgentContext => ({
      agentId: "agent",
      input: normalizeInput([{
        id,
        role: "user",
        parts: [{ type: "text", text: "hello" }],
        timestamp: 1_000,
      }]),
      platform: {},
    });

    assertEquals((await middleware(contextWithId("caller-1"), next)).text, "response-1");
    assertEquals((await middleware(contextWithId("caller-2"), next)).text, "response-2");
    assertEquals((await middleware(contextWithId("caller-1"), next)).text, "response-1");
    assertEquals(executions, 2);
    middleware.destroy();
  });

  it("keeps middleware-rewritten synthetic identity in the cache key", async () => {
    const middleware = cacheMiddleware({ strategy: "memory" });
    let executions = 0;
    const next = async (): Promise<AgentResponse> => createResponse(`response-${++executions}`);
    const contextWithIdentity = (id: string, timestamp: number): AgentContext => {
      const [message] = normalizeInput("hello");
      message!.id = id;
      message!.timestamp = timestamp;
      return { agentId: "agent", input: [message!], platform: {} };
    };

    assertEquals(
      (await middleware(contextWithIdentity("rewritten-1", 1_000), next)).text,
      "response-1",
    );
    assertEquals(
      (await middleware(contextWithIdentity("rewritten-2", 2_000), next)).text,
      "response-2",
    );
    assertEquals(
      (await middleware(contextWithIdentity("rewritten-1", 1_000), next)).text,
      "response-1",
    );
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
