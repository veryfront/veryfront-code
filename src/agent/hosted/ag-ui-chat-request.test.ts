import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgUiRuntimeRequest } from "../runtime/ag-ui-contract.ts";
import {
  buildParsedHostedAgUiRequest,
  createHostedAgUiValidationErrorResponse,
  deriveHostedAgUiChatContext,
} from "./ag-ui-chat-request.ts";

function createAgUiInput(overrides: Partial<AgUiRuntimeRequest> = {}): AgUiRuntimeRequest {
  return {
    threadId: "11111111-1111-4111-8111-111111111111",
    runId: "run-1",
    messages: [],
    tools: [],
    context: [],
    ...overrides,
  };
}

function createToolConversationMessages(userContent: string): AgUiRuntimeRequest["messages"] {
  return [
    {
      id: "system-1",
      role: "system",
      content: "You are helpful.",
    },
    {
      id: "user-1",
      role: "user",
      content: userContent,
    },
    {
      id: "assistant-1",
      role: "assistant",
      content: "Working on it",
      toolCalls: [
        {
          id: "tool-call-1",
          type: "function",
          function: {
            name: "search_files",
            arguments: '{"query":"auth"}',
          },
        },
      ],
    },
    {
      id: "tool-1",
      role: "tool",
      toolCallId: "tool-call-1",
      content: '{"matches":2}',
    },
  ];
}

describe("agent/hosted-ag-ui-chat-request", () => {
  it("derives hosted chat context from AG-UI context entries", () => {
    const result = deriveHostedAgUiChatContext(
      createAgUiInput({
        context: [
          { description: "veryfront.projectId", value: '"project-1"' },
          { description: "veryfront.branchId", value: '"branch-1"' },
          { description: "veryfront.conversationId", value: '"conversation-1"' },
          { description: "veryfront.environmentContext", value: "Editor: local" },
          { description: "veryfront.model", value: "openai/gpt-5.4" },
          { description: "veryfront.allowDelegation", value: "true" },
          { description: "veryfront.runtimeOverrides", value: '{"maxSteps":4}' },
        ],
      }),
    );

    assertEquals(result, {
      validatedContext: {
        projectId: "project-1",
        branchId: "branch-1",
        conversationId: "conversation-1",
        environmentContext: "Editor: local",
      },
      projectId: "project-1",
      conversationId: "conversation-1",
      model: "openai/gpt-5.4",
      allowDelegation: true,
      runtimeOverrides: { maxSteps: 4 },
    });
  });

  it("prefers forwarded config over AG-UI context entries", () => {
    const result = deriveHostedAgUiChatContext(
      createAgUiInput({
        context: [
          { description: "veryfront.projectId", value: '"project-from-context"' },
          { description: "veryfront.model", value: "openai/gpt-5.4" },
        ],
        forwardedProps: {
          veryfront: {
            projectId: "project-from-forwarded",
            branchId: "branch-from-forwarded",
            conversationId: "conversation-from-forwarded",
            environmentContext: "Forwarded environment",
            model: "anthropic/claude-sonnet-4-5",
            allowDelegation: false,
            runtimeOverrides: { maxSteps: 8 },
          },
        },
      }),
      { forwardedConfigNamespace: "veryfront" },
    );

    assertEquals(result, {
      validatedContext: {
        projectId: "project-from-forwarded",
        branchId: "branch-from-forwarded",
        conversationId: "conversation-from-forwarded",
        environmentContext: "Forwarded environment",
      },
      projectId: "project-from-forwarded",
      conversationId: "conversation-from-forwarded",
      model: "anthropic/claude-sonnet-4-5",
      allowDelegation: false,
      runtimeOverrides: { maxSteps: 8 },
    });
  });

  it("builds parsed hosted AG-UI requests and verifies project access", async () => {
    let verifiedProjectId: string | undefined;
    let verifiedAuthToken: string | undefined;
    const parsed = await buildParsedHostedAgUiRequest({
      agUiInput: createAgUiInput({
        parentRunId: "run-parent-1",
        messages: createToolConversationMessages("Hello"),
        context: [
          { description: "veryfront.projectId", value: '"project-1"' },
          { description: "veryfront.model", value: "openai/gpt-5.4" },
          { description: "veryfront.allowDelegation", value: "true" },
        ],
        forwardedProps: {
          unrelated: "ok",
        },
      }),
      authToken: "auth-token",
      userId: "user-1",
      verifyProjectAccess: ({ projectId, authToken }) => {
        verifiedProjectId = projectId;
        verifiedAuthToken = authToken;
        return Promise.resolve({ success: true });
      },
    });

    if (parsed instanceof Response) {
      throw new Error("Expected parsed request");
    }

    assertEquals(verifiedProjectId, "project-1");
    assertEquals(verifiedAuthToken, "auth-token");
    assertEquals(parsed.userId, "user-1");
    assertEquals(parsed.authToken, "auth-token");
    assertEquals(parsed.projectId, "project-1");
    assertEquals(parsed.parentRunId, "run-parent-1");
    assertEquals(parsed.model, "openai/gpt-5.4");
    assertEquals(parsed.allowDelegation, true);
    assertEquals(parsed.forwardedProps, { unrelated: "ok" });
    assertEquals(parsed.persistLatestUserMessageBeforeDurableRun, true);
    assertEquals(parsed.messages, [
      {
        id: "system-1",
        role: "system",
        parts: [{ type: "text", text: "You are helpful." }],
      },
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          { type: "text", text: "Working on it" },
          {
            type: "dynamic-tool",
            toolName: "search_files",
            toolCallId: "tool-call-1",
            input: { query: "auth" },
            state: "output-available",
            output: { matches: 2 },
          },
        ],
      },
    ]);
  });

  it("returns stable project-access error responses", async () => {
    const response = await buildParsedHostedAgUiRequest({
      agUiInput: createAgUiInput({
        context: [{ description: "veryfront.projectId", value: '"project-1"' }],
      }),
      authToken: "auth-token",
      userId: "user-1",
      verifyProjectAccess: () =>
        Promise.resolve({
          success: false,
          error: {
            errorCode: "FORBIDDEN",
            message: "denied",
            statusCode: 401,
          },
        }),
    });

    if (!(response instanceof Response)) {
      throw new Error("Expected project-access response");
    }

    assertEquals(response.status, 403);
    assertEquals(await response.json(), {
      errorCode: "FORBIDDEN",
      message: "denied",
    });
  });

  it("preserves hosted validation error envelopes", async () => {
    const response = await createHostedAgUiValidationErrorResponse(
      Response.json(
        {
          error: "Invalid AG-UI runtime request",
          details: [{ message: "Expected array, received string" }],
        },
        { status: 400 },
      ),
    );

    assertEquals(response.status, 400);
    assertEquals(await response.json(), {
      errorCode: "VALIDATION_ERROR",
      message: "Invalid AG-UI request: Expected array, received string",
    });
  });
});
