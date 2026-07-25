import "#veryfront/schemas/_test-setup.ts";
import { convertUiMessagesToProviderModelMessages } from "#veryfront/chat/conversation";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DEFAULT_MAX_BODY_SIZE_BYTES } from "#veryfront/utils/constants/index.ts";
import {
  buildHostedChatRequestForwardedPropsFromRuntimeAgentInvocation,
  buildHostedChatRequestFromRuntimeAgentInvocation,
  buildParsedHostedChatRequest,
  hostedChatRequestSchema,
  hostedChatRuntimeOverridesSchema,
  parseHostedChatRequestFromRequest,
  parseRuntimeAgentRunInvocationHostedChatRequestFromRequest,
  RuntimeAgentRunInvocationSchema,
} from "../index.ts";
import type { ParsedHostedChatRequest } from "./chat-request-parser.ts";

const conversationId = "10000000-1000-4000-8000-100000000001";
const messageId = "10000000-1000-4000-8000-100000000002";
const inputAnchorMessageId = "10000000-1000-4000-8000-100000000003";
const userId = "10000000-1000-4000-8000-100000000004";
const projectId = "10000000-1000-4000-8000-100000000005";
const branchId = "10000000-1000-4000-8000-100000000006";
const environmentId = "10000000-1000-4000-8000-100000000008";
const runtimeSource = { type: "release", releaseId: "release-42" } as const;
const replayToolName = "github__get_pr_diff";
const replayOutput = { files: ["src/chat/conversation.ts"] };
const rawReplayToolCallPart = {
  type: "tool_call",
  id: "tool-call-1",
  name: replayToolName,
  input: { pullNumber: 3077 },
  state: "completed",
} as const;
const rawReplayToolResultPart = {
  type: "tool_result",
  tool_call_id: rawReplayToolCallPart.id,
  tool_name: replayToolName,
  output: replayOutput,
  is_error: false,
} as const;
const rawReplayParts = [rawReplayToolCallPart, rawReplayToolResultPart] as const;

type ParsedHostedChatRequestMessagePart = ParsedHostedChatRequest["messages"][number]["parts"][
  number
];

const parsedHostedChatRequestReplayToolCallPart: ParsedHostedChatRequestMessagePart = {
  type: "tool_call",
  toolCallId: rawReplayToolCallPart.id,
  toolName: replayToolName,
  input: {},
  state: "output-available",
  output: replayOutput,
};

function createHostedChatRequestBody(messages: unknown[]): {
  messages: unknown[];
  context: {
    conversationId: string;
    projectId: string;
    branchId: string;
  };
} {
  return {
    messages,
    context: {
      conversationId,
      projectId,
      branchId,
    },
  };
}

function assertHostedChatRequestError(messages: unknown[], expectedMessage: string): void {
  const parsed = hostedChatRequestSchema.safeParse(createHostedChatRequestBody(messages));

  assertEquals(parsed.success, false);
  if (!parsed.success) {
    assertStringIncludes(
      parsed.error instanceof Error ? parsed.error.message : String(parsed.error),
      expectedMessage,
    );
  }
}

function createRuntimeInvocation(): ReturnType<typeof RuntimeAgentRunInvocationSchema.parse> {
  return RuntimeAgentRunInvocationSchema.parse({
    run: {
      agentServiceId: "runtime-provider",
      agentId: "builder",
      conversationId,
      runId: "run_root_1",
      messageId,
      inputAnchorMessageId,
      requestedByUserId: userId,
      project: {
        projectId,
        projectSlug: "demo-project",
        runtimeTargetKind: "preview_branch",
        runtimeTargetBranchId: branchId,
      },
      parentConversationId: "10000000-1000-4000-8000-100000000007",
      parentRunId: "run_parent_1",
      spawnedFromToolCallId: "tool_1",
    },
    messages: [{ id: "user-message-1", role: "user", parts: [{ type: "text", text: "Hello" }] }],
    tools: [{
      name: "studio_focus_component",
      inputSchema: {
        type: "object",
        properties: {
          componentId: { type: "string" },
        },
      },
    }],
    context: [{ type: "text", text: "Current file: app.tsx" }],
    agentSource: runtimeSource,
    forwardedProps: { activeChatId: "chat_123" },
  });
}

describe("agent/hosted-chat-request", () => {
  it("validates hosted chat request runtime overrides", () => {
    const parsed = hostedChatRuntimeOverridesSchema.parse({
      allowedTools: ["read_file"],
      thinking: 2048,
      maxSteps: 10,
      ignored: true,
    });

    assertEquals(parsed, {
      allowedTools: ["read_file"],
      thinking: 2048,
      maxSteps: 10,
    });
    assertEquals(hostedChatRuntimeOverridesSchema.safeParse({ thinking: 0 }).success, false);
  });

  it("validates hosted chat requests with durable root run descriptors", () => {
    const parsed = hostedChatRequestSchema.parse({
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Hello" }] }],
      context: {
        conversationId,
        projectId,
        branchId,
      },
      model: "opus",
      allowDelegation: true,
      runtimeOverrides: {
        thinking: false,
      },
      durableRootRun: {
        runId: "run_root_1",
        messageId,
        latestEventId: 2,
        latestExternalEventSequence: 3,
        parentConversationId: "10000000-1000-4000-8000-100000000007",
        parentRunId: "run_parent_1",
        spawnedFromToolCallId: "tool_1",
      },
    });

    assertEquals(parsed.durableRootRun?.runId, "run_root_1");
    assertEquals(parsed.context.branchId, branchId);
    assertEquals(
      hostedChatRequestSchema.safeParse({
        messages: [],
        context: { projectId: null, branchId: null },
        durableRootRun: { runId: "run 1", messageId },
      }).success,
      false,
    );
  });

  it("accepts runtime context metadata on hosted chat request messages", () => {
    const parsed = hostedChatRequestSchema.parse({
      messages: [
        {
          id: "context_compaction_summary:user-kept",
          role: "system",
          parts: [{ type: "text", text: "Previous context summary:\nEarlier work." }],
          metadata: {
            veryfrontRuntimeContext: "context_compaction_summary",
            firstKeptEntryId: "user-kept",
          },
        },
      ],
      context: {
        conversationId,
        projectId,
        branchId,
      },
    });

    assertEquals(parsed.messages[0]?.metadata, {
      veryfrontRuntimeContext: "context_compaction_summary",
      firstKeptEntryId: "user-kept",
    });
  });

  it("preserves raw replay tool parts in hosted chat requests", () => {
    const parsed = hostedChatRequestSchema.parse(
      createHostedChatRequestBody([
        {
          id: "assistant-message-1",
          role: "assistant",
          parts: rawReplayParts,
        },
      ]),
    );

    assertEquals(parsed.messages[0]?.parts as unknown, rawReplayParts);
  });

  it("rejects raw replay tool parts on provider-incompatible message roles", () => {
    assertHostedChatRequestError(
      [
        {
          id: "user-message-1",
          role: "user",
          parts: [rawReplayToolCallPart],
        },
        {
          id: "tool-message-1",
          role: "tool",
          parts: [rawReplayToolResultPart],
        },
      ],
      "tool_call is only allowed in assistant messages",
    );

    assertHostedChatRequestError(
      [
        {
          id: "assistant-message-1",
          role: "assistant",
          parts: [rawReplayToolCallPart],
        },
        {
          id: "user-message-1",
          role: "user",
          parts: [rawReplayToolResultPart],
        },
      ],
      "tool_result is only allowed in assistant or tool messages",
    );
  });

  it("accepts normalized UI tool results in tool messages", async () => {
    const parsed = await parseHostedChatRequestFromRequest(
      new Request("https://agent.example.com/api/runs", {
        method: "POST",
        body: JSON.stringify(
          createHostedChatRequestBody([
            {
              id: "assistant-message-1",
              role: "assistant",
              parts: [rawReplayToolCallPart],
            },
            {
              id: "tool-message-1",
              role: "tool",
              parts: [parsedHostedChatRequestReplayToolCallPart],
            },
          ]),
        ),
      }),
      {
        authenticate: () => Promise.resolve({ userId, authToken: "token_1" }),
        verifyProjectAccess: () => Promise.resolve({ success: true }),
      },
    );

    if (parsed instanceof Response) {
      throw new Error("Expected parsed request");
    }

    assertEquals(parsed.messages[1]?.parts, [parsedHostedChatRequestReplayToolCallPart]);
  });

  it("rejects duplicate replay tool-call ids", () => {
    const parsed = hostedChatRequestSchema.safeParse(
      createHostedChatRequestBody([
        {
          id: "assistant-message-1",
          role: "assistant",
          parts: [
            rawReplayToolCallPart,
            {
              ...rawReplayToolCallPart,
              name: "github__get_pr",
            },
          ],
        },
      ]),
    );

    assertEquals(parsed.success, false);
    if (!parsed.success) {
      const validationError = parsed.error as {
        message?: unknown;
        issues?: Array<{ path: Array<string | number> }>;
      };
      assertStringIncludes(
        typeof validationError.message === "string" ? validationError.message : "",
        "tool_call id must be unique",
      );
      assertEquals(validationError.issues?.[0]?.path, [
        "messages",
        0,
        "parts",
        1,
        "id",
      ]);
    }
  });

  it("rejects orphan raw replay tool results without a tool name", () => {
    const parsed = hostedChatRequestSchema.safeParse(
      createHostedChatRequestBody([
        {
          id: "tool-message-1",
          role: "tool",
          parts: [
            {
              type: "tool_result",
              tool_call_id: "missing-tool-call",
              output: { files: [] },
            },
          ],
        },
      ]),
    );

    assertEquals(parsed.success, false);
    if (!parsed.success) {
      const validationError = parsed.error as {
        message?: unknown;
        issues?: Array<{ path: Array<string | number> }>;
      };
      assertStringIncludes(
        typeof validationError.message === "string" ? validationError.message : "",
        "tool_result requires a preceding matching tool_call",
      );
      assertEquals(validationError.issues?.[0]?.path, [
        "messages",
        0,
        "parts",
        0,
        "tool_call_id",
      ]);
    }
  });

  it("rejects explicit raw tool-result names without a matching call or with a mismatch", () => {
    assertHostedChatRequestError(
      [
        {
          id: "tool-message-1",
          role: "tool",
          parts: [
            {
              ...rawReplayToolResultPart,
              tool_call_id: "missing-tool-call",
            },
          ],
        },
      ],
      "tool_result requires a preceding matching tool_call",
    );

    assertHostedChatRequestError(
      [
        {
          id: "assistant-message-1",
          role: "assistant",
          parts: [rawReplayToolCallPart],
        },
        {
          id: "tool-message-1",
          role: "tool",
          parts: [
            {
              ...rawReplayToolResultPart,
              tool_name: "github__get_pr",
            },
          ],
        },
      ],
      "tool_result tool_name must match its preceding tool_call",
    );
  });

  it("parses hosted chat requests with raw replay tool parts", async () => {
    const parsed = await parseHostedChatRequestFromRequest(
      new Request("https://agent.example.com/api/runs", {
        method: "POST",
        body: JSON.stringify(
          createHostedChatRequestBody([
            {
              id: "assistant-message-1",
              role: "assistant",
              parts: [rawReplayToolCallPart],
            },
            {
              id: "tool-message-1",
              role: "tool",
              parts: [
                {
                  type: "tool_result",
                  tool_call_id: rawReplayToolCallPart.id,
                  output: replayOutput,
                  is_error: false,
                },
              ],
            },
          ]),
        ),
      }),
      {
        authenticate: () => Promise.resolve({ userId, authToken: "token_1" }),
        verifyProjectAccess: () => Promise.resolve({ success: true }),
      },
    );

    if (parsed instanceof Response) {
      throw new Error("Expected parsed request");
    }

    assertEquals(
      parsed.messages[0]?.parts[0] as unknown,
      {
        type: "tool_call",
        toolCallId: rawReplayToolCallPart.id,
        toolName: replayToolName,
        input: rawReplayToolCallPart.input,
        state: "completed",
      },
    );

    assertEquals(
      parsed.messages[1]?.parts[0] as unknown,
      parsedHostedChatRequestReplayToolCallPart,
    );
    assertEquals(convertUiMessagesToProviderModelMessages(parsed.messages), [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: rawReplayToolCallPart.id,
            toolName: replayToolName,
            input: rawReplayToolCallPart.input,
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: rawReplayToolCallPart.id,
            toolName: replayToolName,
            output: {
              type: "json",
              value: replayOutput,
            },
          },
        ],
      },
    ]);
  });

  it("merges raw replay results into normalized UI tool parts", async () => {
    const cases = [
      {
        part: {
          type: "tool-web_fetch",
          toolCallId: "named-tool-call",
          input: { url: "https://example.com" },
          state: "input-available",
        },
      },
      {
        part: {
          type: "dynamic-tool",
          toolCallId: "dynamic-tool-call",
          toolName: "lookup",
          input: { query: "Veryfront" },
          state: "input-available",
        },
      },
    ] as const;

    for (const { part } of cases) {
      const parsed = await parseHostedChatRequestFromRequest(
        new Request("https://agent.example.com/api/runs", {
          method: "POST",
          body: JSON.stringify(
            createHostedChatRequestBody([
              {
                id: "assistant-message-1",
                role: "assistant",
                parts: [
                  part,
                  {
                    type: "tool_result",
                    tool_call_id: part.toolCallId,
                    output: replayOutput,
                    is_error: false,
                  },
                ],
              },
            ]),
          ),
        }),
        {
          authenticate: () => Promise.resolve({ userId, authToken: "token_1" }),
          verifyProjectAccess: () => Promise.resolve({ success: true }),
        },
      );

      if (parsed instanceof Response) {
        throw new Error("Expected parsed request");
      }

      assertEquals(parsed.messages[0]?.parts, [
        {
          ...part,
          state: "output-available",
          output: replayOutput,
        },
      ]);
    }
  });

  it("preserves structured raw replay error details", async () => {
    const replayErrorOutput = { code: "denied", retryable: false };
    const parsed = await parseHostedChatRequestFromRequest(
      new Request("https://agent.example.com/api/runs", {
        method: "POST",
        body: JSON.stringify(
          createHostedChatRequestBody([
            {
              id: "assistant-message-1",
              role: "assistant",
              parts: [rawReplayToolCallPart],
            },
            {
              id: "tool-message-1",
              role: "tool",
              parts: [{
                ...rawReplayToolResultPart,
                output: replayErrorOutput,
                is_error: true,
              }],
            },
          ]),
        ),
      }),
      {
        authenticate: () => Promise.resolve({ userId, authToken: "token_1" }),
        verifyProjectAccess: () => Promise.resolve({ success: true }),
      },
    );

    if (parsed instanceof Response) {
      throw new Error("Expected parsed request");
    }

    assertEquals(parsed.messages[1]?.parts[0], {
      type: "tool_call",
      toolCallId: rawReplayToolCallPart.id,
      toolName: replayToolName,
      input: {},
      state: "output-error",
      output: replayErrorOutput,
      errorText: '{"code":"denied","retryable":false}',
    });
  });

  it("builds a hosted chat request from a runtime agent invocation", () => {
    const invocation = createRuntimeInvocation();
    const forwardedProps = buildHostedChatRequestForwardedPropsFromRuntimeAgentInvocation(
      invocation,
    );
    const request = buildHostedChatRequestFromRuntimeAgentInvocation(invocation);

    assertEquals(forwardedProps?.activeChatId, "chat_123");
    assertEquals(forwardedProps?.runtimeContext, invocation.context);
    assertEquals(forwardedProps?.runtimeTools, invocation.tools);
    assertEquals(request.context, {
      conversationId,
      projectId,
      projectSlug: "demo-project",
      branchId,
      runtimeTargetKind: "preview_branch",
    });
    assertEquals("agentSource" in request, false);
    assertEquals(request.durableRootRun, {
      runId: "run_root_1",
      messageId,
      parentConversationId: "10000000-1000-4000-8000-100000000007",
      parentRunId: "run_parent_1",
      spawnedFromToolCallId: "tool_1",
    });
  });

  it("builds hosted chat requests with raw replay tool parts from runtime invocations", () => {
    const invocation = RuntimeAgentRunInvocationSchema.parse({
      ...createRuntimeInvocation(),
      messages: [
        {
          id: "assistant-message-1",
          role: "assistant",
          parts: rawReplayParts,
        },
      ],
    });

    const request = buildHostedChatRequestFromRuntimeAgentInvocation(invocation);

    assertEquals(request.messages[0]?.parts as unknown, rawReplayParts);
  });

  it("carries environment runtime target metadata from runtime invocations", () => {
    const baseInvocation = createRuntimeInvocation();
    const invocation = RuntimeAgentRunInvocationSchema.parse({
      ...baseInvocation,
      run: {
        ...baseInvocation.run,
        project: {
          projectId,
          projectSlug: "demo-project",
          runtimeTargetKind: "environment",
          runtimeTargetEnvironmentId: environmentId,
        },
      },
    });

    const request = buildHostedChatRequestFromRuntimeAgentInvocation(invocation);

    assertEquals(request.context, {
      conversationId,
      projectId,
      projectSlug: "demo-project",
      branchId: null,
      runtimeTargetKind: "environment",
      runtimeTargetEnvironmentId: environmentId,
    });
  });
  it("carries Studio environment context from runtime context into hosted chat context", () => {
    const invocation = RuntimeAgentRunInvocationSchema.parse({
      ...createRuntimeInvocation(),
      context: [
        {
          type: "json",
          title: "studio_context",
          data: {
            projectId,
            branchId,
            environmentContext: "<date_time>\nToday's date is 2026-06-03\n</date_time>",
          },
        },
      ],
    });

    const request = buildHostedChatRequestFromRuntimeAgentInvocation(invocation);

    assertEquals(
      request.context.environmentContext,
      "<date_time>\nToday's date is 2026-06-03\n</date_time>",
    );
  });

  it("ignores non-Studio JSON context environment fields", () => {
    const invocation = RuntimeAgentRunInvocationSchema.parse({
      ...createRuntimeInvocation(),
      context: [
        {
          type: "json",
          title: "other_context",
          data: {
            environmentContext: "Unrelated context",
          },
        },
      ],
    });

    const request = buildHostedChatRequestFromRuntimeAgentInvocation(invocation);

    assertEquals(request.context.environmentContext, undefined);
  });

  it("parses hosted chat requests with auth and project-access callbacks", async () => {
    const parsed = await parseHostedChatRequestFromRequest(
      new Request("https://agent.example.com/api/runs", {
        method: "POST",
        body: JSON.stringify({
          messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Hello" }] }],
          context: {
            conversationId,
            projectId,
            branchId,
          },
          model: "opus",
          allowDelegation: true,
          forwardedProps: { activeChatId: "chat_123" },
          durableRootRun: {
            runId: "run_root_1",
            messageId,
            parentConversationId: "10000000-1000-4000-8000-100000000007",
            parentRunId: "run_parent_1",
            spawnedFromToolCallId: "tool_1",
          },
        }),
      }),
      {
        authenticate: () => Promise.resolve({ userId, authToken: "token_1" }),
        verifyProjectAccess: ({ projectId: checkedProjectId, authToken }) => {
          assertEquals(checkedProjectId, projectId);
          assertEquals(authToken, "token_1");
          return Promise.resolve({ success: true });
        },
      },
    );

    if (parsed instanceof Response) {
      throw new Error("Expected parsed request");
    }

    assertEquals(parsed.userId, userId);
    assertEquals(parsed.authToken, "token_1");
    assertEquals(parsed.projectId, projectId);
    assertEquals(parsed.projectSlug, undefined);
    assertEquals(parsed.conversationId, conversationId);
    assertEquals(parsed.parentRunId, "run_root_1");
    assertEquals(parsed.upstreamParentConversationId, "10000000-1000-4000-8000-100000000007");
    assertEquals(parsed.upstreamParentRunId, "run_parent_1");
    assertEquals(parsed.spawnedFromToolCallId, "tool_1");
    assertEquals(parsed.persistLatestUserMessageBeforeDurableRun, false);
  });

  it("rejects oversized hosted chat requests before schema parsing", async () => {
    const response = await parseHostedChatRequestFromRequest(
      new Request("https://agent.example.com/api/runs", {
        method: "POST",
        body: JSON.stringify({ padding: "x".repeat(DEFAULT_MAX_BODY_SIZE_BYTES) }),
      }),
      {
        authenticate: () => Promise.resolve({ userId, authToken: "token_1" }),
      },
    );

    if (!(response instanceof Response)) throw new Error("Expected error response");
    assertEquals(response.status, 413);
    assertEquals((await response.json()).errorCode, "REQUEST_TOO_LARGE");
  });

  it("preserves project slug when parsing runtime agent invocation hosted chat requests", async () => {
    const parsed = await parseRuntimeAgentRunInvocationHostedChatRequestFromRequest(
      new Request("https://agent.example.com/api/runs", {
        method: "POST",
        body: JSON.stringify(createRuntimeInvocation()),
      }),
      {
        authenticate: () => Promise.resolve({ userId, authToken: "token_1" }),
        verifyProjectAccess: () => Promise.resolve({ success: true, projectSlug: "demo-project" }),
        runtimeSource,
      },
    );

    if (parsed instanceof Response) {
      throw new Error("Expected parsed request");
    }

    assertEquals(parsed.projectId, projectId);
    assertEquals(parsed.projectSlug, "demo-project");
    assertEquals(parsed.validatedContext.projectSlug, "demo-project");
  });

  it("does not trust a requested slug when project access omits a verified slug", async () => {
    const parsed = await parseRuntimeAgentRunInvocationHostedChatRequestFromRequest(
      new Request("https://agent.example.com/api/runs", {
        method: "POST",
        body: JSON.stringify(createRuntimeInvocation()),
      }),
      {
        authenticate: () => Promise.resolve({ userId, authToken: "token_1" }),
        verifyProjectAccess: () => Promise.resolve({ success: true }),
        runtimeSource,
      },
    );

    if (parsed instanceof Response) {
      throw new Error("Expected parsed request");
    }

    assertEquals(parsed.projectSlug, undefined);
    assertEquals(parsed.validatedContext.projectSlug, undefined);
  });

  it("rejects whitespace-only project slugs before project access", async () => {
    let projectAccessChecks = 0;
    const response = await parseHostedChatRequestFromRequest(
      new Request("https://agent.example.com/api/runs", {
        method: "POST",
        body: JSON.stringify({
          messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Hello" }] }],
          context: {
            conversationId,
            projectId,
            projectSlug: "   ",
            branchId,
          },
        }),
      }),
      {
        authenticate: () => Promise.resolve({ userId, authToken: "token_1" }),
        verifyProjectAccess: () => {
          projectAccessChecks++;
          return Promise.resolve({ success: true, projectSlug: "canonical-project" });
        },
      },
    );

    if (!(response instanceof Response)) {
      throw new Error("Expected validation response");
    }

    assertEquals(response.status, 400);
    assertEquals(projectAccessChecks, 0);
    assertEquals(await response.json(), {
      errorCode: "VALIDATION_ERROR",
      message: "Invalid request: context.projectSlug cannot be blank",
    });
  });

  it("rejects project slugs without project ids when project access is configured", async () => {
    let projectAccessChecks = 0;
    const response = await parseHostedChatRequestFromRequest(
      new Request("https://agent.example.com/api/runs", {
        method: "POST",
        body: JSON.stringify({
          messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Hello" }] }],
          context: {
            conversationId,
            projectId: null,
            projectSlug: "requested-project",
            branchId,
          },
        }),
      }),
      {
        authenticate: () => Promise.resolve({ userId, authToken: "token_1" }),
        verifyProjectAccess: () => {
          projectAccessChecks++;
          return Promise.resolve({ success: true, projectSlug: "requested-project" });
        },
      },
    );

    if (!(response instanceof Response)) {
      throw new Error("Expected validation response");
    }

    assertEquals(response.status, 400);
    assertEquals(projectAccessChecks, 0);
    assertEquals(await response.json(), {
      errorCode: "VALIDATION_ERROR",
      message: "Invalid request: context.projectSlug requires verified context.projectId",
    });
  });

  it("uses the verified project slug when the request omits a slug", async () => {
    const parsed = await parseHostedChatRequestFromRequest(
      new Request("https://agent.example.com/api/runs", {
        method: "POST",
        body: JSON.stringify({
          messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Hello" }] }],
          context: {
            conversationId,
            projectId,
            branchId,
          },
        }),
      }),
      {
        authenticate: () => Promise.resolve({ userId, authToken: "token_1" }),
        verifyProjectAccess: () =>
          Promise.resolve({ success: true, projectSlug: "canonical-project" }),
      },
    );

    if (parsed instanceof Response) {
      throw new Error("Expected parsed request");
    }

    assertEquals(parsed.projectSlug, "canonical-project");
    assertEquals(parsed.validatedContext.projectSlug, "canonical-project");
  });

  it("rejects runtime invocations whose requested slug does not match the verified slug", async () => {
    const response = await parseRuntimeAgentRunInvocationHostedChatRequestFromRequest(
      new Request("https://agent.example.com/api/runs", {
        method: "POST",
        body: JSON.stringify(createRuntimeInvocation()),
      }),
      {
        authenticate: () => Promise.resolve({ userId, authToken: "token_1" }),
        verifyProjectAccess: () => Promise.resolve({ success: true, projectSlug: "other-project" }),
        runtimeSource,
      },
    );

    if (!(response instanceof Response)) {
      throw new Error("Expected validation response");
    }

    assertEquals(response.status, 403);
    assertEquals(await response.json(), {
      errorCode: "FORBIDDEN",
      message: "Project slug does not match verified project access",
    });
  });

  it("preserves request-scoped project agent config from runtime invocations", async () => {
    const parsed = await parseRuntimeAgentRunInvocationHostedChatRequestFromRequest(
      new Request("https://agent.example.com/api/runs", {
        method: "POST",
        body: JSON.stringify({
          ...createRuntimeInvocation(),
          agentConfig: {
            id: "builder",
            name: "Builder",
            description: "Builds with project skills.",
            instructions: "Use project skills.",
            skills: ["support-triage"],
            tools: ["search_knowledge", "get_file"],
          },
        }),
      }),
      {
        authenticate: () => Promise.resolve({ userId, authToken: "token_1" }),
        verifyProjectAccess: () => Promise.resolve({ success: true }),
        runtimeSource,
      },
    );

    if (parsed instanceof Response) {
      throw new Error("Expected parsed request");
    }

    assertEquals(parsed.agentConfig?.skills, ["support-triage"]);
    assertEquals(parsed.agentConfig?.tools, ["search_knowledge", "get_file"]);
  });

  it("rejects parsed hosted chat requests when agent config does not match the requested agent", async () => {
    const response = await buildParsedHostedChatRequest({
      chatRequest: hostedChatRequestSchema.parse({
        messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Hello" }] }],
        context: {
          conversationId,
          projectId,
          branchId,
        },
      }),
      agentId: "builder",
      agentConfig: {
        id: "other-agent",
        name: "Other Agent",
        description: "Does not match the requested agent.",
        instructions: "Use another agent.",
      },
      authToken: "token_1",
      userId,
    });

    if (!(response instanceof Response)) {
      throw new Error("Expected error response");
    }

    assertEquals(response.status, 400);
    assertEquals(await response.json(), {
      errorCode: "VALIDATION_ERROR",
      message: "Invalid runtime agent invocation: agentConfig.id must match the requested agent id",
    });
  });

  it("rejects runtime invocation agent config for a different agent", async () => {
    const response = await parseRuntimeAgentRunInvocationHostedChatRequestFromRequest(
      new Request("https://agent.example.com/api/runs", {
        method: "POST",
        body: JSON.stringify({
          ...createRuntimeInvocation(),
          agentConfig: {
            id: "other-agent",
            name: "Other Agent",
            description: "Does not match the requested agent.",
            instructions: "Use another agent.",
          },
        }),
      }),
      {
        authenticate: () => Promise.resolve({ userId, authToken: "token_1" }),
        verifyProjectAccess: () => Promise.resolve({ success: true }),
        runtimeSource,
      },
    );

    if (!(response instanceof Response)) {
      throw new Error("Expected error response");
    }

    const body = await response.json();
    assertEquals(response.status, 400);
    assertEquals(body.errorCode, "VALIDATION_ERROR");
    assertStringIncludes(body.message, "Invalid runtime agent invocation");
    assertStringIncludes(body.message, "agentConfig.id must match run.agentId");
  });

  it("returns hosted chat project-access errors as stable JSON responses", async () => {
    const response = await parseHostedChatRequestFromRequest(
      new Request("https://agent.example.com/api/runs", {
        method: "POST",
        body: JSON.stringify({
          messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Hello" }] }],
          context: {
            projectId,
            branchId,
          },
        }),
      }),
      {
        authenticate: () => Promise.resolve({ userId, authToken: "token_1" }),
        verifyProjectAccess: () =>
          Promise.resolve({
            success: false,
            error: {
              errorCode: "PROJECT_ACCESS_DENIED",
              message: "Project access denied",
              statusCode: 403,
            },
          }),
      },
    );

    if (!(response instanceof Response)) {
      throw new Error("Expected error response");
    }

    assertEquals(response.status, 403);
    assertEquals(await response.json(), {
      errorCode: "PROJECT_ACCESS_DENIED",
      message: "Project access denied",
    });
  });

  it("parses runtime agent invocations into hosted chat requests", async () => {
    const invocation = createRuntimeInvocation();
    const parsed = await parseRuntimeAgentRunInvocationHostedChatRequestFromRequest(
      new Request("https://agent.example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        body: JSON.stringify(invocation),
      }),
      {
        authenticate: () => Promise.resolve({ userId, authToken: "token_1" }),
        verifyProjectAccess: () => Promise.resolve({ success: true }),
        runtimeSource,
      },
    );

    if (parsed instanceof Response) {
      throw new Error("Expected parsed runtime invocation");
    }

    assertEquals(parsed.messages, invocation.messages);
    assertEquals(parsed.userId, userId);
    assertEquals(parsed.projectId, projectId);
    assertEquals(parsed.conversationId, conversationId);
    assertEquals(parsed.forwardedProps?.runtimeContext, invocation.context);
    assertEquals(parsed.forwardedProps?.runtimeTools, invocation.tools);
    assertEquals(parsed.durableRootRun?.runId, "run_root_1");
  });

  it("fails closed when a control-plane invocation is not bound to this service source", async () => {
    const invocation = createRuntimeInvocation();

    for (
      const [boundSource, expectedErrorCode, expectedStatus] of [
        [undefined, "CONTROL_PLANE_AGENT_SOURCE_UNBOUND", 503],
        [{ type: "release", releaseId: "release-43" }, "CONTROL_PLANE_AGENT_SOURCE_MISMATCH", 409],
      ] as const
    ) {
      const response = await parseRuntimeAgentRunInvocationHostedChatRequestFromRequest(
        new Request("https://agent.example.com/api/control-plane/runs/run_1/stream", {
          method: "POST",
          body: JSON.stringify(invocation),
        }),
        {
          authenticate: () => Promise.resolve({ userId, authToken: "token_1" }),
          verifyProjectAccess: () => Promise.resolve({ success: true }),
          runtimeSource: boundSource,
        },
      );

      if (!(response instanceof Response)) {
        throw new Error("Expected source binding error response");
      }
      assertEquals(response.status, expectedStatus);
      assertEquals(await response.json(), { errorCode: expectedErrorCode });
    }
  });

  it("does not reveal source binding errors before project access succeeds", async () => {
    const response = await parseRuntimeAgentRunInvocationHostedChatRequestFromRequest(
      new Request("https://agent.example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        body: JSON.stringify(createRuntimeInvocation()),
      }),
      {
        authenticate: () => Promise.resolve({ userId, authToken: "token_1" }),
        verifyProjectAccess: () =>
          Promise.resolve({
            success: false,
            error: {
              errorCode: "PROJECT_ACCESS_DENIED",
              message: "Project access denied",
              statusCode: 403,
            },
          }),
        runtimeSource: undefined,
      },
    );

    if (!(response instanceof Response)) {
      throw new Error("Expected project access error response");
    }
    assertEquals(response.status, 403);
    assertEquals(await response.json(), {
      errorCode: "PROJECT_ACCESS_DENIED",
      message: "Project access denied",
    });
  });

  it("rejects mutable branch source selection for a standalone service", async () => {
    const response = await parseRuntimeAgentRunInvocationHostedChatRequestFromRequest(
      new Request("https://agent.example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        body: JSON.stringify({
          ...createRuntimeInvocation(),
          agentSource: { type: "branch", branch: "main" },
        }),
      }),
      {
        authenticate: () => Promise.resolve({ userId, authToken: "token_1" }),
        verifyProjectAccess: () => Promise.resolve({ success: true }),
        runtimeSource,
      },
    );

    if (!(response instanceof Response)) {
      throw new Error("Expected unsupported source error response");
    }
    assertEquals(response.status, 409);
    assertEquals(await response.json(), {
      errorCode: "CONTROL_PLANE_AGENT_SOURCE_UNSUPPORTED",
    });
  });
});
