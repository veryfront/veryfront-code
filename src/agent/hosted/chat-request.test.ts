import "#veryfront/schemas/_test-setup.ts";
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

const conversationId = "10000000-1000-4000-8000-100000000001";
const messageId = "10000000-1000-4000-8000-100000000002";
const inputAnchorMessageId = "10000000-1000-4000-8000-100000000003";
const userId = "10000000-1000-4000-8000-100000000004";
const projectId = "10000000-1000-4000-8000-100000000005";
const branchId = "10000000-1000-4000-8000-100000000006";
const environmentId = "10000000-1000-4000-8000-100000000008";
const runtimeSource = { type: "release", releaseId: "release-42" } as const;

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
        verifyProjectAccess: () => Promise.resolve({ success: true }),
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
