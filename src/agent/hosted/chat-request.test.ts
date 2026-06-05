import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildHostedChatRequestForwardedPropsFromRuntimeAgentInvocation,
  buildHostedChatRequestFromRuntimeAgentInvocation,
  hostedChatRequestSchema,
  hostedChatRuntimeOverridesSchema,
  parseHostedChatRequestFromRequest,
  parseRuntimeAgentRunInvocationHostedChatRequestFromRequest,
  RuntimeAgentRunInvocationSchema,
} from "../index.ts";

const conversationId = "10000000-1000-4000-8000-100000000001";
const messageId = "10000000-1000-4000-8000-100000000002";
const inputAnchorMessageId = "10000000-1000-4000-8000-100000000003";
const userId = "10000000-1000-4000-8000-100000000004";
const projectId = "10000000-1000-4000-8000-100000000005";
const branchId = "10000000-1000-4000-8000-100000000006";

function createRuntimeInvocation() {
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
      branchId,
    });
    assertEquals(request.durableRootRun, {
      runId: "run_root_1",
      messageId,
      parentConversationId: "10000000-1000-4000-8000-100000000007",
      parentRunId: "run_parent_1",
      spawnedFromToolCallId: "tool_1",
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
    assertEquals(parsed.conversationId, conversationId);
    assertEquals(parsed.parentRunId, "run_root_1");
    assertEquals(parsed.upstreamParentConversationId, "10000000-1000-4000-8000-100000000007");
    assertEquals(parsed.upstreamParentRunId, "run_parent_1");
    assertEquals(parsed.spawnedFromToolCallId, "tool_1");
    assertEquals(parsed.persistLatestUserMessageBeforeDurableRun, false);
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
});
