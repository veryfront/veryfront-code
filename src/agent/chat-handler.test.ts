/**
 * Chat Handler Tests
 *
 * Tests createChatHandler request extraction via duck-typing,
 * ensuring it accepts native Request objects and APIContext wrappers
 * without relying on instanceof checks (which break under dnt).
 *
 * @module agent/chat-handler.test
 */

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createChatHandler } from "./chat-handler.ts";

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
});
