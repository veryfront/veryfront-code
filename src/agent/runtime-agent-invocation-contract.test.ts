import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  parseRuntimeAgentRunInvocation,
  parseRuntimeAgentRunInvocationOrError,
  RuntimeAgentRunInvocationSchema,
} from "./index.ts";

const conversationId = "10000000-1000-4000-8000-100000000001";
const messageId = "10000000-1000-4000-8000-100000000002";
const inputAnchorMessageId = "10000000-1000-4000-8000-100000000003";
const userId = "10000000-1000-4000-8000-100000000004";
const projectId = "10000000-1000-4000-8000-100000000005";
const branchId = "10000000-1000-4000-8000-100000000006";

function createInvocation(overrides: Record<string, unknown> = {}) {
  return {
    run: {
      agentServiceId: "1-runtime-provider",
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
      validatedClaims: {
        subject: userId,
        projectId,
        projectSlug: "demo-project",
        scopes: ["agent:run"],
      },
    },
    messages: [
      { id: "user-message-1", role: "user", parts: [{ type: "text", text: "Hello" }] },
      {
        id: "tool-message-1",
        role: "tool",
        parts: [{ type: "tool_result", output: { ok: true } }],
      },
    ],
    tools: [{
      name: "studio_focus_component",
      description: "Focus the selected component",
      inputSchema: {
        type: "object",
        properties: {
          componentId: { type: "string" },
        },
      },
    }],
    context: [{ type: "text", text: "Current file: app.tsx" }],
    agentSource: { type: "branch", branch: "main" },
    forwardedProps: { activeChatId: "chat_123" },
    ...overrides,
  };
}

describe("agent/runtime-agent-invocation-contract", () => {
  it("exports the control-plane runtime agent invocation schema from veryfront/agent", () => {
    const parsed = RuntimeAgentRunInvocationSchema.parse(createInvocation());

    assertEquals(parsed.run.agentServiceId, "1-runtime-provider");
    assertEquals(parsed.run.project.runtimeTargetKind, "preview_branch");
    assertEquals(parsed.run.validatedClaims?.scopes, ["agent:run"]);
    assertEquals(parsed.messages.length, 2);
    assertEquals(parsed.tools[0]?.name, "studio_focus_component");
  });

  it("enforces child-run lineage before invoking a runtime agent service", () => {
    const parsed = RuntimeAgentRunInvocationSchema.parse(createInvocation({
      run: {
        agentServiceId: "veryfront-platform-agent",
        agentId: "builder",
        conversationId,
        runId: "run_child_1",
        messageId,
        inputAnchorMessageId,
        requestedByUserId: userId,
        project: {
          projectId,
          projectSlug: "demo-project",
        },
        parentRunId: "run_root_1",
        spawnedFromToolCallId: "tool_1",
      },
    }));

    assertEquals(parsed.run.parentRunId, "run_root_1");

    assertThrows(() =>
      RuntimeAgentRunInvocationSchema.parse(createInvocation({
        run: {
          agentServiceId: "veryfront-platform-agent",
          agentId: "builder",
          conversationId,
          runId: "run_root_1",
          messageId,
          inputAnchorMessageId,
          requestedByUserId: userId,
          project: {
            projectId,
            projectSlug: "demo-project",
          },
          parentRunId: "run_root_1",
        },
      }))
    );

    assertThrows(() =>
      RuntimeAgentRunInvocationSchema.parse(createInvocation({
        run: {
          agentServiceId: "veryfront-platform-agent",
          agentId: "builder",
          conversationId,
          runId: "run_child_1",
          messageId,
          inputAnchorMessageId,
          requestedByUserId: userId,
          project: {
            projectId,
            projectSlug: "demo-project",
          },
          spawnedFromToolCallId: "tool_1",
        },
      }))
    );
  });

  it("rejects project claims that do not match the selected project context", () => {
    assertThrows(() =>
      RuntimeAgentRunInvocationSchema.parse(createInvocation({
        run: {
          agentServiceId: "veryfront-platform-agent",
          agentId: "builder",
          conversationId,
          runId: "run_root_1",
          messageId,
          inputAnchorMessageId,
          requestedByUserId: userId,
          project: {
            projectId,
            projectSlug: "demo-project",
          },
          validatedClaims: {
            subject: userId,
            projectId: "10000000-1000-4000-8000-100000000007",
          },
        },
      }))
    );
  });

  it("parses runtime agent invocation request bodies through the public helper", async () => {
    const parsed = await parseRuntimeAgentRunInvocation(
      new Request("http://localhost/internal/agents/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createInvocation()),
      }),
    );

    assertEquals(parsed.run.runId, "run_root_1");
    assertEquals(parsed.context.length, 1);
  });

  it("returns a 400 response for malformed runtime agent invocation payloads", async () => {
    const result = await parseRuntimeAgentRunInvocationOrError(
      new Request("http://localhost/internal/agents/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run: { runId: "run_1" } }),
      }),
    );

    assertInstanceOf(result, Response);
    assertEquals(result.status, 400);
    const body = await result.json();
    assertEquals(body.error, "Invalid runtime agent invocation");
    assertEquals(Array.isArray(body.details), true);
  });
});
