/**
 * Chat Handler Tests
 *
 * Tests createChatHandler request extraction via duck-typing,
 * ensuring it accepts native Request objects and APIContext wrappers
 * without relying on instanceof checks (which break under dnt).
 *
 * @module agent/chat-handler.test
 */

import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createChatHandler } from "./chat-handler.ts";
import { registerAgent } from "./composition/index.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";

describe("createChatHandler", () => {
  // The handler calls extractRequest first. If that fails, it throws
  // "Invalid handler argument". If it succeeds, the handler proceeds
  // to agent lookup / body parsing (returning 400 or 404, not 500).

  it("should accept a native Request (duck-typing, not instanceof)", async () => {
    const handler = createChatHandler("nonexistent-agent");
    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });

    const response = await handler(request);

    // Any non-500 response means extractRequest succeeded.
    // We expect 400 (Zod validation) or 404 (agent not found), not 500.
    assertEquals(response.status < 500, true);
  });

  it("should accept a Pages Router APIContext wrapper", async () => {
    const handler = createChatHandler("nonexistent-agent");
    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });

    // Pages Router passes { request } instead of raw Request
    const ctx = { request };
    const response = await handler(ctx);

    assertEquals(response.status < 500, true);
  });

  it("should throw for non-Request argument", async () => {
    const handler = createChatHandler("nonexistent-agent");

    await assertRejects(
      () => handler({ notARequest: true }),
      Error,
      "Invalid handler argument",
    );
  });

  it("should accept a Request-like object with json/url/method", async () => {
    const handler = createChatHandler("nonexistent-agent");

    // Simulate a cross-runtime Request that doesn't share the same prototype
    // (e.g. undici Request vs native Request) but has the same shape
    const fakeRequest = {
      url: "http://localhost/api/chat",
      method: "POST",
      json: () => Promise.resolve({ messages: [] }),
      headers: new Headers({ "Content-Type": "application/json" }),
    };

    const response = await handler(fakeRequest);

    // Should succeed at extracting the request (not throw 500)
    assertEquals(response.status < 500, true);
  });

  it("should throw for null argument", async () => {
    const handler = createChatHandler("nonexistent-agent");

    await assertRejects(
      () => handler(null),
      Error,
    );
  });

  it("should throw for string argument", async () => {
    const handler = createChatHandler("nonexistent-agent");

    await assertRejects(
      () => handler("not a request"),
      Error,
      "Invalid handler argument",
    );
  });

  it("should run beforeStream and allow message/context customization", async () => {
    const agentId = `hook-agent-${crypto.randomUUID()}`;
    let clearMemoryCalls = 0;
    let streamMessages: Array<{ id: string; role: string; parts: unknown[] }> = [];
    let streamContext: Record<string, unknown> | undefined;

    const fakeAgent = {
      id: agentId,
      config: { model: "openai/gpt-4o", system: "Hook test bot" },
      clearMemory: async () => {
        clearMemoryCalls++;
      },
      stream: async (
        input: {
          messages?: Array<{ id: string; role: string; parts: unknown[] }>;
          context?: Record<string, unknown>;
        },
      ) => {
        streamMessages = input.messages ?? [];
        streamContext = input.context;
        return {
          toDataStreamResponse: () => new Response("ok", { status: 200 }),
        };
      },
    };

    // deno-lint-ignore no-explicit-any
    registerAgent(agentId, fakeAgent as any);

    const handler = createChatHandler(agentId, {
      context: { tenant: "acme" },
      beforeStream: ({ lastUserText, context }) => {
        assertEquals(lastUserText, "Where are the docs?");
        assertEquals(context.tenant, "acme");

        return {
          prepend: [
            {
              role: "system",
              parts: [{ type: "text", text: `Context: ${lastUserText}` }],
            },
          ],
          context: { ...context, rag: true },
        };
      },
    });

    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "Where are the docs?" }],
          },
        ],
      }),
    });

    const response = await handler(request);
    assertEquals(response.status, 200);
    assertEquals(clearMemoryCalls, 1);

    assertEquals(streamMessages.length, 2);
    assertEquals(streamMessages[0]?.role, "system");
    assertEquals(
      (streamMessages[0]?.parts[0] as { text?: string }).text,
      "Context: Where are the docs?",
    );
    assertStringIncludes(streamMessages[0]?.id ?? "", "prepend_");
    assertEquals(streamMessages[1]?.role, "user");
    assertEquals(streamContext?.tenant, "acme");
    assertEquals(streamContext?.rag, true);
  });

  it("should allow beforeStream to short-circuit with a Response", async () => {
    const agentId = `hook-short-circuit-${crypto.randomUUID()}`;
    let clearMemoryCalls = 0;
    let streamCalls = 0;

    const fakeAgent = {
      id: agentId,
      config: { model: "openai/gpt-4o", system: "Short-circuit bot" },
      clearMemory: async () => {
        clearMemoryCalls++;
      },
      stream: async () => {
        streamCalls++;
        return {
          toDataStreamResponse: () => new Response("ok", { status: 200 }),
        };
      },
    };

    // deno-lint-ignore no-explicit-any
    registerAgent(agentId, fakeAgent as any);

    const handler = createChatHandler(agentId, {
      beforeStream: () => Response.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          },
        ],
      }),
    });

    const response = await handler(request);
    const body = await response.json();

    assertEquals(response.status, 401);
    assertEquals(body.error, "Unauthorized");
    assertEquals(clearMemoryCalls, 0);
    assertEquals(streamCalls, 0);
  });

  it("should allow beforeStream to replace and append messages", async () => {
    const agentId = `hook-replace-${crypto.randomUUID()}`;
    let streamMessages: Array<{ id: string; role: string; parts: unknown[] }> = [];

    const fakeAgent = {
      id: agentId,
      config: { model: "openai/gpt-4o", system: "Replace test bot" },
      clearMemory: async () => {},
      stream: async (
        input: { messages?: Array<{ id: string; role: string; parts: unknown[] }> },
      ) => {
        streamMessages = input.messages ?? [];
        return {
          toDataStreamResponse: () => new Response("ok", { status: 200 }),
        };
      },
    };

    // deno-lint-ignore no-explicit-any
    registerAgent(agentId, fakeAgent as any);

    const handler = createChatHandler(agentId, {
      beforeStream: () => ({
        replaceMessages: [
          {
            id: "replacement-user",
            role: "user",
            parts: [{ type: "text", text: "replacement" }],
          },
        ],
        append: [
          {
            role: "system",
            parts: [{ type: "text", text: "tail" }],
          },
        ],
      }),
    });

    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "original" }],
          },
        ],
      }),
    });

    const response = await handler(request);
    assertEquals(response.status, 200);

    assertEquals(streamMessages.length, 2);
    assertEquals(streamMessages[0]?.id, "replacement-user");
    assertEquals((streamMessages[0]?.parts[0] as { text?: string }).text, "replacement");
    assertEquals(streamMessages[1]?.role, "system");
    assertStringIncludes(streamMessages[1]?.id ?? "", "append_");
  });

  it("should not leak system prompt in 503 no_ai_available response", async () => {
    const agentId = `no-ai-agent-${crypto.randomUUID()}`;
    const secretSystemPrompt =
      "TOP SECRET: You are a financial advisor with access to internal data.";

    const fakeAgent = {
      id: agentId,
      config: { model: "local/smollm2-360m", system: secretSystemPrompt },
      clearMemory: async () => {},
      stream: async () => {
        throw toError(
          createError({
            type: "no_ai_available",
            message: "Local AI model unavailable.",
          }),
        );
      },
    };

    // deno-lint-ignore no-explicit-any
    registerAgent(agentId, fakeAgent as any);

    const handler = createChatHandler(agentId);
    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          },
        ],
      }),
    });

    const response = await handler(request);
    assertEquals(response.status, 503);

    const body = await response.json();
    assertEquals(body.code, "NO_AI_AVAILABLE");
    assertEquals(body.fallback, "browser");
    assertEquals(body.systemPrompt, undefined, "Server system prompt must not be sent to client");
    assertEquals(
      JSON.stringify(body).includes(secretSystemPrompt),
      false,
      "Response body must not contain the system prompt anywhere",
    );
  });

  it("should accept agent instance via object-based config", async () => {
    const agentId = `obj-api-agent-${crypto.randomUUID()}`;
    let streamCalled = false;

    const fakeAgent = {
      id: agentId,
      config: { model: "openai/gpt-4o", system: "Object API test" },
      generate: () => {},
      clearMemory: async () => {},
      stream: async () => {
        streamCalled = true;
        return {
          toDataStreamResponse: () => new Response("ok", { status: 200 }),
        };
      },
    };

    // Use the object-based API: createChatHandler({ agent, beforeStream })
    // deno-lint-ignore no-explicit-any
    const handler = createChatHandler({ agent: fakeAgent as any });

    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          },
        ],
      }),
    });

    const response = await handler(request);
    assertEquals(response.status, 200);
    assertEquals(streamCalled, true);
  });

  it("should not leak async system prompt in 503 no_ai_available response", async () => {
    const agentId = `no-ai-async-${crypto.randomUUID()}`;

    const fakeAgent = {
      id: agentId,
      config: {
        model: "local/smollm2-360m",
        system: () => Promise.resolve("CONFIDENTIAL: Internal instructions for the agent."),
      },
      clearMemory: async () => {},
      stream: async () => {
        throw toError(
          createError({
            type: "no_ai_available",
            message: "Local AI model unavailable.",
          }),
        );
      },
    };

    // deno-lint-ignore no-explicit-any
    registerAgent(agentId, fakeAgent as any);

    const handler = createChatHandler(agentId);
    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          },
        ],
      }),
    });

    const response = await handler(request);
    assertEquals(response.status, 503);

    const body = await response.json();
    assertEquals(body.code, "NO_AI_AVAILABLE");
    assertEquals(body.systemPrompt, undefined, "Async system prompt must not be sent to client");
  });
});
