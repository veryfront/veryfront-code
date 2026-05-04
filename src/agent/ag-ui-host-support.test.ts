import { assertEquals, assertInstanceOf, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createAgUiRunErrorEvent,
  createAgUiSseErrorResponse,
  createAgUiSseResponse,
  normalizeAgUiMessages,
  parseAgUiRequest,
  parseAgUiRequestOrError,
} from "./ag-ui-host-support.ts";

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
