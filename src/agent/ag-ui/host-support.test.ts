import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createAgUiRunErrorEvent,
  createAgUiSseErrorResponse,
  createAgUiSseResponse,
  normalizeAgUiMessages,
  parseAgUiRequest,
  parseAgUiRequestOrError,
} from "./host-support.ts";
import { convertToTextGenerationRuntimeMessages } from "../runtime/text-generation-runtime-message-converter.ts";
import type { Message } from "../types.ts";

describe("agent/ag-ui-host-support", () => {
  it("parses a valid AG-UI request body through the public helper", async () => {
    const request = new Request("http://localhost/api/ag-ui", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: crypto.randomUUID(),
        runId: "run_1",
        messages: [{
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "hello" }],
        }],
        tools: [],
        context: [],
      }),
    });

    const parsed = await parseAgUiRequest(request);

    assertEquals(parsed.runId, "run_1");
    assertEquals(parsed.messages.length, 1);
    assertEquals(parsed.tools, []);
  });

  it("returns a 400 Response from parseAgUiRequestOrError for invalid AG-UI payloads", async () => {
    const request = new Request("http://localhost/api/ag-ui", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: "not-an-array",
      }),
    });

    const result = await parseAgUiRequestOrError(request);

    assertInstanceOf(result, Response);
    assertEquals(result.status, 400);
    const body = await result.json();
    assertEquals(body.error, "Invalid AG-UI request");
    assertEquals(Array.isArray(body.details), true);
  });

  it("returns a 400 Response for oversized AG-UI text parts", async () => {
    const request = new Request("http://localhost/api/ag-ui", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "x".repeat(10_001) }],
        }],
      }),
    });

    const result = await parseAgUiRequestOrError(request);

    assertInstanceOf(result, Response);
    assertEquals(result.status, 400);
    const body = await result.json();
    assertEquals(body.error, "Invalid AG-UI request");
    assertStringIncludes(
      body.details[0]?.message ?? "",
      "Text message parts must include text less than 10000 characters",
    );
  });

  it("accepts forwarded props above the old 64 KB AG-UI budget", async () => {
    const forwardedProps = {
      runtimeOverrides: {
        integrationToolDefinitions: Array.from({ length: 8 }, (_, index) => ({
          name: `github__bulk_tool_${index}`,
          description: `Definition for github__bulk_tool_${index} `.repeat(300),
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: `Input for github__bulk_tool_${index} `.repeat(300),
              },
            },
          },
        })),
      },
    };
    const request = new Request("http://localhost/api/ag-ui", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "hello" }],
        }],
        forwardedProps,
      }),
    });

    assertEquals(
      new TextEncoder().encode(JSON.stringify(forwardedProps)).byteLength > 64 * 1024,
      true,
    );

    const parsed = await parseAgUiRequest(request);

    assertEquals(parsed.forwardedProps, forwardedProps);
  });

  it("returns a 400 Response from parseAgUiRequestOrError for malformed JSON bodies", async () => {
    const request = new Request("http://localhost/api/ag-ui", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-valid-json",
    });

    const result = await parseAgUiRequestOrError(request);

    assertInstanceOf(result, Response);
    assertEquals(result.status, 400);
    const body = await result.json();
    assertEquals(body.error, "Invalid AG-UI request");
    assertEquals(body.details, [{ path: [], message: "Malformed JSON request body" }]);
  });

  it("normalizes text, tool-call, and tool-result parts through the public helper", () => {
    const messages = normalizeAgUiMessages([
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          { type: "text", text: "hello" },
          {
            type: "tool_call",
            id: "tool-1",
            name: "search_docs",
            args: { query: "ag-ui" },
          },
          {
            type: "tool_result",
            tool_call_id: "tool-1",
            tool_name: "search_docs",
            output: { matches: 2 },
          },
        ],
      },
    ]);

    assertEquals(messages, [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          { type: "text", text: "hello" },
          {
            type: "tool-call",
            toolCallId: "tool-1",
            toolName: "search_docs",
            args: { query: "ag-ui" },
          },
          {
            type: "tool-result",
            toolCallId: "tool-1",
            toolName: "search_docs",
            result: { matches: 2 },
          },
        ],
      },
    ]);
  });

  it("preserves tool outputs stored on assistant tool parts as tool messages", () => {
    const messages = normalizeAgUiMessages([
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-search_docs",
            toolCallId: "tool-1",
            toolName: "search_docs",
            state: "output-available",
            input: { query: "ag-ui" },
            output: { matches: 2 },
          },
        ],
      },
      {
        id: "user-2",
        role: "user",
        parts: [{ type: "text", text: "Summarize that result" }],
      },
    ]);

    assertEquals(messages, [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-search_docs",
            toolCallId: "tool-1",
            toolName: "search_docs",
            args: { query: "ag-ui" },
          },
        ],
      },
      {
        id: "tool_tool-1",
        role: "tool",
        parts: [
          {
            type: "tool-result",
            toolCallId: "tool-1",
            toolName: "search_docs",
            result: { matches: 2 },
          },
        ],
      },
      {
        id: "user-2",
        role: "user",
        parts: [{ type: "text", text: "Summarize that result" }],
      },
    ]);
  });

  it("expands a turn with multiple sequential tool calls into ordered, paired messages", () => {
    const messages = normalizeAgUiMessages([
      { id: "u1", role: "user", parts: [{ type: "text", text: "What does Article 28 require?" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "internal reasoning" },
          {
            type: "tool-load-skill",
            toolCallId: "toolu_load",
            toolName: "load-skill",
            state: "output-available",
            input: { skill: "dpo" },
            output: { ok: true },
          },
          {
            type: "tool-searchGdprCorpus",
            toolCallId: "toolu_search",
            toolName: "searchGdprCorpus",
            state: "output-available",
            input: { query: "article 28" },
            output: { hits: 3 },
          },
          { type: "text", text: "Article 28 requires a data processing agreement." },
        ],
      },
      { id: "u2", role: "user", parts: [{ type: "text", text: "Run a full review." }] },
    ]);

    // Each tool call is flushed with its result immediately after, and the
    // trailing answer lands in its own assistant message after the results.
    assertEquals(messages.map((message) => message.role), [
      "user",
      "assistant",
      "tool",
      "assistant",
      "tool",
      "assistant",
      "user",
    ]);
    assertEquals(messages[1], {
      id: "a1",
      role: "assistant",
      parts: [{
        type: "tool-load-skill",
        toolCallId: "toolu_load",
        toolName: "load-skill",
        args: { skill: "dpo" },
      }],
    });
    assertEquals(messages[2], {
      id: "tool_toolu_load",
      role: "tool",
      parts: [{
        type: "tool-result",
        toolCallId: "toolu_load",
        toolName: "load-skill",
        result: { ok: true },
      }],
    });
    assertEquals(messages[5], {
      id: "a1-2",
      role: "assistant",
      parts: [{ type: "text", text: "Article 28 requires a data processing agreement." }],
    });
  });

  it("replays multi-tool turns without orphaning any tool_result on the wire", () => {
    const normalized = normalizeAgUiMessages([
      { id: "u1", role: "user", parts: [{ type: "text", text: "Question one." }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-load-skill",
            toolCallId: "toolu_load",
            toolName: "load-skill",
            state: "output-available",
            input: {},
            output: { ok: true },
          },
          {
            type: "tool-searchGdprCorpus",
            toolCallId: "toolu_search",
            toolName: "searchGdprCorpus",
            state: "output-available",
            input: { query: "article 28" },
            output: { hits: 3 },
          },
          { type: "text", text: "Done." },
        ],
      },
      { id: "u2", role: "user", parts: [{ type: "text", text: "Follow-up." }] },
    ]);

    const wire = convertToTextGenerationRuntimeMessages(normalized as Message[]);

    // Every tool_result must have a matching tool_use in the immediately
    // preceding message, mirroring the provider API contract that issue #2082
    // violated.
    for (let index = 0; index < wire.length; index += 1) {
      const message = wire[index];
      if (message.role !== "tool") continue;

      const previous = wire[index - 1];
      const toolUseIds = new Set<string>();
      if (previous?.role === "assistant" && Array.isArray(previous.content)) {
        for (const part of previous.content) {
          if (part.type === "tool-call") toolUseIds.add(part.toolCallId);
        }
      }

      for (const part of message.content) {
        if (part.type === "tool-result") {
          assertEquals(
            toolUseIds.has(part.toolCallId),
            true,
            `tool_result ${part.toolCallId} has no matching tool_use in the previous message`,
          );
        }
      }
    }
  });

  it("strips provider-owned tools while still pairing local tools in a multi-tool turn", () => {
    const messages = normalizeAgUiMessages(
      [
        { id: "u1", role: "user", parts: [{ type: "text", text: "Look it up." }] },
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "tool-web_search",
              toolCallId: "toolu_web",
              toolName: "web_search",
              state: "output-available",
              input: { query: "gdpr" },
              output: { results: [] },
            },
            {
              type: "tool-searchGdprCorpus",
              toolCallId: "toolu_search",
              toolName: "searchGdprCorpus",
              state: "output-available",
              input: { query: "article 28" },
              output: { hits: 3 },
            },
            { type: "text", text: "Here is the answer." },
          ],
        },
        { id: "u2", role: "user", parts: [{ type: "text", text: "Thanks." }] },
      ],
      { providerOwnedToolNames: ["web_search"] },
    );

    // The provider-owned web_search call/result is dropped entirely; the local
    // tool is still paired and the trailing answer preserved.
    assertEquals(messages.map((message) => message.role), [
      "user",
      "assistant",
      "tool",
      "assistant",
      "user",
    ]);
    assertEquals(
      messages.some((message) =>
        message.parts.some((part) => "toolCallId" in part && part.toolCallId === "toolu_web")
      ),
      false,
    );
    assertEquals(messages[2], {
      id: "tool_toolu_search",
      role: "tool",
      parts: [{
        type: "tool-result",
        toolCallId: "toolu_search",
        toolName: "searchGdprCorpus",
        result: { hits: 3 },
      }],
    });
  });

  it("drops an assistant message whose parts all normalize away", () => {
    const messages = normalizeAgUiMessages([
      { id: "u1", role: "user", parts: [{ type: "text", text: "Hi" }] },
      { id: "a1", role: "assistant", parts: [{ type: "reasoning", text: "internal only" }] },
    ]);

    assertEquals(messages, [{ id: "u1", role: "user", parts: [{ type: "text", text: "Hi" }] }]);
  });

  it("creates AG-UI SSE run-error responses with the existing wire shape", async () => {
    const event = createAgUiRunErrorEvent("Overloaded right now", "OVERLOADED_ERROR");
    const response = createAgUiSseErrorResponse(event, 503);

    assertEquals(response.status, 503);
    assertEquals(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
    const body = await response.text();
    assertStringIncludes(body, "event: RunError");
    assertStringIncludes(body, '"code":"OVERLOADED_ERROR"');
    assertStringIncludes(body, "Overloaded right now");
  });

  it("creates AG-UI SSE responses with the standard stream headers", () => {
    const response = createAgUiSseResponse(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("event: ping\\ndata: {}\\n\\n"));
          controller.close();
        },
      }),
    );

    assertEquals(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
    assertEquals(response.headers.get("cache-control"), "no-cache, no-transform");
    assertEquals(response.headers.get("connection"), "keep-alive");
    assertEquals(response.headers.get("x-accel-buffering"), "no");
  });
});
