import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getInternalAgentStreamRequestSchema,
  getResumeSignalSchema,
  getRuntimeRunAgentInputSchema,
  toRuntimeRunAgentInput,
} from "./schema.ts";

describe("internal-agents/schema", () => {
  it("applies defaults for optional runtime collections", () => {
    const parsed = getRuntimeRunAgentInputSchema().parse({
      threadId: crypto.randomUUID(),
      runId: "run_1",
      messages: [],
    });

    assertEquals(parsed.tools, []);
    assertEquals(parsed.context, []);
  });

  it("rejects oversized injected tool parameters", () => {
    assertThrows(
      () =>
        getRuntimeRunAgentInputSchema().parse({
          threadId: crypto.randomUUID(),
          runId: "run_1",
          messages: [],
          tools: [{
            name: "focusComponent",
            parameters: { payload: "x".repeat(16_500) },
          }],
        }),
      Error,
      "Tool parameters must be less than 16 KB",
    );
  });

  it("rejects runtime context that exceeds the total size limit", () => {
    assertThrows(
      () =>
        getRuntimeRunAgentInputSchema().parse({
          threadId: crypto.randomUUID(),
          runId: "run_1",
          messages: [],
          context: Array.from({ length: 5 }, () => ({
            type: "text" as const,
            text: "x".repeat(14_000),
          })),
        }),
      Error,
      "context must be less than 64 KB total",
    );
  });

  it("defaults resume signals to non-error tool results", () => {
    assertEquals(
      getResumeSignalSchema().parse({
        type: "tool_result",
        toolCallId: "tool_1",
        result: { ok: true },
      }),
      {
        type: "tool_result",
        toolCallId: "tool_1",
        result: { ok: true },
        isError: false,
      },
    );
  });

  it("uses the shared runtime agent source context contract", () => {
    const parsed = getInternalAgentStreamRequestSchema().parse({
      agentId: "agent_1",
      threadId: "10000000-1000-4000-8000-100000000001",
      runId: "run_1",
      messages: [],
      agentSource: {
        type: "environment",
        environmentName: "staging",
        releaseId: "release_1",
      },
    });

    assertEquals(parsed.agentSource, {
      type: "environment",
      environmentName: "staging",
      releaseId: "release_1",
    });
    assertThrows(
      () =>
        getInternalAgentStreamRequestSchema().parse({
          agentId: "agent_1",
          threadId: "10000000-1000-4000-8000-100000000001",
          runId: "run_1",
          messages: [],
          agentSource: { type: "branch", branch: "" },
        }),
      Error,
      "Too small: expected string to have >=1 characters",
    );
  });

  it("accepts a canonical AG-UI-aligned runtime payload", () => {
    const parsed = getRuntimeRunAgentInputSchema().parse({
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
      forwardedProps: {
        runtimeOverrides: {
          allowedTools: ["search_docs"],
        },
      },
    });

    assertEquals(parsed.parentRunId, "run_parent");
    assertEquals(parsed.state, { phase: "draft" });
    assertEquals(parsed.messages[2]?.role, "assistant");
    assertEquals(parsed.context, [{ description: "Current file", value: "src/main.ts" }]);
  });

  it("normalizes legacy internal stream payloads into the canonical runtime input", () => {
    const internalRequest = getInternalAgentStreamRequestSchema().parse({
      agentId: "agent_1",
      threadId: "10000000-1000-4000-8000-100000000001",
      runId: "run_1",
      messages: [
        {
          id: "user_1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
        },
        {
          id: "assistant_1",
          role: "assistant",
          parts: [
            { type: "text", text: "Let me check" },
            {
              type: "tool-call",
              toolCallId: "tool_1",
              toolName: "search_docs",
              args: { query: "ag-ui" },
            },
          ],
        },
      ],
      context: [{ type: "text", text: "Current file: src/main.ts" }],
    });

    assertEquals(toRuntimeRunAgentInput(internalRequest) as unknown, {
      threadId: "10000000-1000-4000-8000-100000000001",
      runId: "run_1",
      messages: [
        {
          id: "user_1",
          role: "user",
          content: "Hello",
        },
        {
          id: "assistant_1",
          role: "assistant",
          content: "Let me check",
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
      tools: [],
      context: [{ type: "text", text: "Current file: src/main.ts" }],
    });
  });

  it("preserves endUserId on internal stream payloads for on-demand integration auth", () => {
    const internalRequest = getInternalAgentStreamRequestSchema().parse({
      agentId: "agent_1",
      threadId: "10000000-1000-4000-8000-100000000001",
      runId: "run_1",
      endUserId: "10000000-1000-4000-8000-100000000004",
      messages: [],
      context: [],
    });

    assertEquals(
      (toRuntimeRunAgentInput(internalRequest) as unknown as { endUserId?: string }).endUserId,
      "10000000-1000-4000-8000-100000000004",
    );
  });

  it("prefers streamed inputText over empty fallback args when normalizing legacy assistant tool calls", () => {
    const internalRequest = getInternalAgentStreamRequestSchema().parse({
      agentId: "agent_1",
      threadId: "10000000-1000-4000-8000-100000000001",
      runId: "run_1",
      messages: [
        {
          id: "assistant_1",
          role: "assistant",
          parts: [
            { type: "text", text: "Writing report" },
            {
              type: "tool-call",
              toolCallId: "tool_1",
              toolName: "create_file",
              args: {},
              inputText: '{"path":"plans/report.md","content":"# Report"}',
            },
          ],
        },
      ],
      context: [],
    });

    assertEquals(
      (toRuntimeRunAgentInput(internalRequest) as unknown as { messages: unknown }).messages,
      [
        {
          id: "assistant_1",
          role: "assistant",
          content: "Writing report",
          toolCalls: [{
            id: "tool_1",
            type: "function",
            function: {
              name: "create_file",
              arguments: JSON.stringify({
                path: "plans/report.md",
                content: "# Report",
              }),
            },
          }],
        },
      ],
    );
  });

  it("repairs leading-quote streamed inputText before serializing legacy assistant tool calls", () => {
    const internalRequest = getInternalAgentStreamRequestSchema().parse({
      agentId: "agent_1",
      threadId: "10000000-1000-4000-8000-100000000001",
      runId: "run_1",
      messages: [
        {
          id: "assistant_1",
          role: "assistant",
          parts: [
            {
              type: "tool-call",
              toolCallId: "tool_1",
              toolName: "create_file",
              args: {},
              inputText: '"path":"plans/report.md","content":"# Report"}',
            },
          ],
        },
      ],
      context: [],
    });

    assertEquals(
      (toRuntimeRunAgentInput(internalRequest) as unknown as { messages: unknown }).messages,
      [
        {
          id: "assistant_1",
          role: "assistant",
          toolCalls: [{
            id: "tool_1",
            type: "function",
            function: {
              name: "create_file",
              arguments: JSON.stringify({
                path: "plans/report.md",
                content: "# Report",
              }),
            },
          }],
        },
      ],
    );
  });

  it("preserves canonical runtime messages on the compatibility route", () => {
    const internalRequest = getInternalAgentStreamRequestSchema().parse({
      agentId: "agent_1",
      threadId: "10000000-1000-4000-8000-100000000001",
      runId: "run_1",
      messages: [
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
        {
          id: "tool_1",
          role: "tool",
          toolCallId: "tool_1",
          content: "Found docs",
        },
      ],
      context: [],
    });

    assertEquals(
      (toRuntimeRunAgentInput(internalRequest) as unknown as { messages: unknown }).messages,
      [
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
        {
          id: "tool_1",
          role: "tool",
          toolCallId: "tool_1",
          content: "Found docs",
        },
      ],
    );
  });

  it("normalizes legacy tool_call and tool_result parts", () => {
    const internalRequest = getInternalAgentStreamRequestSchema().parse({
      agentId: "agent_1",
      threadId: "10000000-1000-4000-8000-100000000001",
      runId: "run_1",
      messages: [
        {
          id: "assistant_1",
          role: "assistant",
          parts: [{
            type: "tool_call",
            id: "tool_legacy",
            name: "search_docs",
            args: { query: "ag-ui" },
          }],
        },
        {
          id: "tool_message_1",
          role: "tool",
          parts: [{
            type: "tool_result",
            tool_call_id: "tool_legacy",
            output: { ok: true },
          }],
        },
      ],
      context: [],
    });

    assertEquals(
      (toRuntimeRunAgentInput(internalRequest) as unknown as { messages: unknown }).messages,
      [
        {
          id: "assistant_1",
          role: "assistant",
          toolCalls: [{
            id: "tool_legacy",
            type: "function",
            function: {
              name: "search_docs",
              arguments: JSON.stringify({ query: "ag-ui" }),
            },
          }],
        },
        {
          id: "tool_message_1",
          role: "tool",
          toolCallId: "tool_legacy",
          content: JSON.stringify({ ok: true }),
        },
      ],
    );
  });
});
