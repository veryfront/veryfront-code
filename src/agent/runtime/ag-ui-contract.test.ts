import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getAgUiRuntimeRequestSchema,
  normalizeAgUiBrowserRuntimeRequest,
  parseAgUiRuntimeRequest,
  parseAgUiRuntimeRequestOrError,
} from "../index.ts";

describe("agent/runtime-ag-ui-contract", () => {
  it("exports the canonical runtime AG-UI request schema from veryfront/agent", () => {
    const parsed = getAgUiRuntimeRequestSchema().parse({
      threadId: crypto.randomUUID(),
      runId: "run_1",
      parentRunId: "run_parent",
      state: { phase: "draft" },
      messages: [
        {
          id: "sys_1",
          role: "system",
          content: "You are helpful",
        },
        {
          id: "user_1",
          role: "user",
          content: "Hello",
        },
        {
          id: "assistant_1",
          role: "assistant",
          content: "Working on it",
          toolCalls: [{
            id: "tool_1",
            type: "function",
            function: {
              name: "search_docs",
              arguments: JSON.stringify({ query: "ag-ui" }),
            },
          }],
        },
      ],
      context: [{
        description: "Current file",
        value: "src/main.ts",
      }],
    });

    assertEquals(parsed.parentRunId, "run_parent");
    assertEquals(parsed.state, { phase: "draft" });
    assertEquals(parsed.tools, []);
    assertEquals(parsed.context, [{ description: "Current file", value: "src/main.ts" }]);
  });

  it("parses a valid runtime AG-UI request body through the public helper", async () => {
    const parsed = await parseAgUiRuntimeRequest(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: crypto.randomUUID(),
          runId: "run_1",
          messages: [
            {
              id: "user_1",
              role: "user",
              content: "Hello",
            },
          ],
          context: [],
          tools: [],
        }),
      }),
    );

    assertEquals(parsed.runId, "run_1");
    assertEquals(parsed.messages.length, 1);
  });

  it("normalizes runtime browser request defaults without leaking non-object state", () => {
    const normalized = normalizeAgUiBrowserRuntimeRequest(
      getAgUiRuntimeRequestSchema().parse({
        threadId: crypto.randomUUID(),
        runId: "run_1",
        state: "not-an-object",
        messages: [
          {
            id: "user_1",
            role: "user",
            content: "Hello",
          },
        ],
        context: [],
        tools: [],
      }),
      {
        threadId: crypto.randomUUID(),
        runId: "run_override",
      },
    );

    assertEquals(normalized.runId, "run_override");
    assertEquals(Array.isArray(normalized.messages), true);
    assertEquals("state" in normalized, false);
  });

  it("returns a 400 response for malformed runtime AG-UI JSON bodies", async () => {
    const result = await parseAgUiRuntimeRequestOrError(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not-json",
      }),
    );

    assertInstanceOf(result, Response);
    assertEquals(result.status, 400);
    const body = await result.json();
    assertEquals(body.error, "Invalid AG-UI runtime request");
    assertEquals(body.details, [{ path: [], message: "Malformed JSON request body" }]);
  });

  it("returns a 400 response when the runtime AG-UI request has no body", async () => {
    const result = await parseAgUiRuntimeRequestOrError(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );

    assertInstanceOf(result, Response);
    assertEquals(result.status, 400);
    const body = await result.json();
    assertEquals(body.error, "Invalid AG-UI runtime request");
    assertEquals(body.details, [{ path: [], message: "Malformed JSON request body" }]);
  });

  it("returns a 400 response for an invalid runtime AG-UI Content-Length header", async () => {
    const result = await parseAgUiRuntimeRequestOrError(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "invalid",
        },
        body: "{}",
      }),
    );

    assertInstanceOf(result, Response);
    assertEquals(result.status, 400);
    const body = await result.json();
    assertEquals(body.error, "Invalid AG-UI runtime request");
    assertEquals(body.details, [{ path: [], message: "Malformed JSON request body" }]);
  });

  it("returns a 400 response for invalid runtime AG-UI payloads", async () => {
    const result = await parseAgUiRuntimeRequestOrError(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: "not-a-uuid",
          runId: "run_1",
          messages: [],
        }),
      }),
    );

    assertInstanceOf(result, Response);
    assertEquals(result.status, 400);
    const body = await result.json();
    assertEquals(body.error, "Invalid AG-UI runtime request");
    assertEquals(Array.isArray(body.details), true);
  });
});
