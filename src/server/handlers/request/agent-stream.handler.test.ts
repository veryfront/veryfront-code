import "#veryfront/schemas/_test-setup.ts";
import { INVALID_ARGUMENT, NETWORK_ERROR, SERVICE_OVERLOADED } from "#veryfront/errors";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
  refreshLoggerConfig,
} from "#veryfront/utils/logger/index.ts";
import { createEmptyDiscoveryResult } from "#veryfront/discovery";
import type { Agent, AgentMessage } from "#veryfront/agent";
import type { AgentSystem } from "#veryfront/agent/types.ts";
import type { ChatSystemMessage } from "#veryfront/chat/types.ts";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import {
  getRuntimeRemoteToolSources,
  type RuntimeRemoteToolConfig,
} from "#veryfront/agent/runtime/mcp-server-tool-sources.ts";
import { getRuntimeSourceIntegrationPolicy } from "#veryfront/agent/runtime/runtime-tool-config.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  installMockFetch,
  observeFetchRequestInit,
  restoreMockFetch,
  withMockFetch,
} from "#veryfront/testing/mock-fetch.ts";
import { DEFAULT_MAX_BODY_SIZE_BYTES } from "#veryfront/utils/constants/index.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { getVerifiedCacheApiCredential } from "#veryfront/cache/verified-api-credential-context.ts";
import { AgentRunResumeHandler } from "./agent-run-resume.handler.ts";
import { AgentStreamHandler, type AgentStreamHandlerDeps } from "./agent-stream.handler.ts";
import type { HandlerContext } from "../types.ts";
import {
  type CapturedApplicationError,
  createAgent,
  createAgentWithConfig,
  createControlPlaneSignature,
  createCtx as createSingleProjectCtx,
  createInjectedToolRuntime,
  encodeDataStreamEvent,
  readRemainingText,
  readUntil,
  stubApplicationErrorReporter,
} from "./internal-agent-run.test-helpers.ts";
import {
  createAgentStreamRequestBody,
  createNoopEnvAdapter,
  createNoopFsAdapter,
  createSourceCapableAgentStreamContext as createCtx,
  TrackingSessionManager,
} from "./agent-stream.handler.test-helpers.ts";
import { __resetServerShuttingDownForTests, markServerShuttingDown } from "../../shutdown-state.ts";
import {
  getCurrentRequestContext,
  runWithRequestContext,
} from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { EnvironmentVariableCache } from "../../project-env/cache.ts";
import { flattenSystemInstructions } from "#veryfront/agent/runtime/tool-inventory.ts";
import { resolveAgentSystem } from "#veryfront/agent/runtime/effective-agent-system.ts";

// Literal public addresses exercise guarded egress deterministically without
// depending on external DNS answers for production or reserved test hosts.
const TEST_PUBLIC_API_ORIGIN = "https://93.184.216.34";
const TEST_PUBLIC_STUDIO_MCP_URL = "https://93.184.216.35/studio-mcp";

function createTestAgentStreamHandler(deps: AgentStreamHandlerDeps): AgentStreamHandler {
  return new AgentStreamHandler({
    loadAgentSourceEnvironment: () => Promise.resolve({}),
    ...deps,
  });
}

function createRuntimeAgentRunInvocationBody() {
  return JSON.stringify({
    run: {
      agentServiceId: "veryfront-platform-agent",
      agentId: "assistant-1",
      conversationId: "10000000-1000-4000-8000-100000000001",
      runId: "run_1",
      messageId: "10000000-1000-4000-8000-100000000002",
      inputAnchorMessageId: "10000000-1000-4000-8000-100000000003",
      requestedByUserId: "10000000-1000-4000-8000-100000000004",
      project: {
        projectId: "10000000-1000-4000-8000-100000000005",
        projectSlug: "incident-responder-cwy27d",
        runtimeTargetKind: "preview_branch",
        runtimeTargetBranchId: "10000000-1000-4000-8000-100000000006",
      },
      validatedClaims: {
        subject: "10000000-1000-4000-8000-100000000004",
        projectId: "10000000-1000-4000-8000-100000000005",
        projectSlug: "incident-responder-cwy27d",
        scopes: ["agent:run"],
      },
    },
    agentSource: { type: "branch", branch: "main" },
    messages: [
      { id: "user-message-1", role: "user", parts: [{ type: "text", text: "Hello" }] },
    ],
    tools: [{
      name: "studio_focus_component",
      description: "Focus a component in Studio",
      inputSchema: {
        type: "object",
        properties: {
          componentId: { type: "string" },
        },
      },
    }],
    context: [{ type: "text", text: "Current file: app.tsx" }],
    forwardedProps: { clientId: "veryfront-studio" },
  });
}

describe("server/handlers/request/agent-stream.handler", () => {
  it("rejects a preview source whose signed branch ID differs from the trusted target", async () => {
    let discoveryCalls = 0;
    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls += 1;
        return createEmptyDiscoveryResult();
      },
      getAgent: () => undefined,
      getAllAgentIds: () => [],
      sessionManager: new AgentRunSessionManager(),
    });
    const body = createAgentStreamRequestBody({
      project: {
        runtimeTargetKind: "preview_branch",
        runtimeTargetBranchId: "10000000-1000-4000-8000-100000000006",
      },
      agentSource: { type: "branch", branch: "main" },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "run_1",
    });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      {
        ...createCtx(publicKeyPem),
        branchId: "20000000-2000-4000-8000-200000000006",
      },
    );

    assertExists(result.response);
    assertEquals(result.response.status, 403);
    assertEquals(result.response.headers.get("content-type"), "application/problem+json");
    assertEquals(discoveryCalls, 0);
  });

  it("accepts a non-main default branch only when it matches trusted proxy metadata", async () => {
    let discoveryCalls = 0;
    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls += 1;
        return createEmptyDiscoveryResult();
      },
      getAgent: () => undefined,
      getAllAgentIds: () => [],
      sessionManager: new AgentRunSessionManager(),
    });
    const body = createAgentStreamRequestBody({
      project: {
        runtimeTargetKind: "main_branch",
        runtimeTargetBranchId: null,
      },
      agentSource: { type: "branch", branch: "trunk" },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "run_1",
    });
    const ctx = createCtx(publicKeyPem);
    ctx.defaultBranchName = "trunk";

    const accepted = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      ctx,
    );
    assertExists(accepted.response);
    assertEquals(accepted.response.status, 404);
    assertEquals(discoveryCalls, 1);

    discoveryCalls = 0;
    ctx.defaultBranchName = "main";
    const rejected = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      ctx,
    );
    assertExists(rejected.response);
    assertEquals(rejected.response.status, 403);
    assertEquals(discoveryCalls, 0);
  });

  it("streams AG-UI events for a valid signed request", async () => {
    let discoveryCalls = 0;
    let streamContext: Record<string, unknown> | undefined;
    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls += 1;
        return createEmptyDiscoveryResult();
      },
      getAgent: (id) => id === "assistant-1" ? createAgent("assistant-1") : undefined,
      getAllAgentIds: () => ["assistant-1"],
      sessionManager: new AgentRunSessionManager(),
      resolveRuntimeOwnerInvokeUrl: async () => "http://10.0.0.7:20000/channels/invoke",
      createRuntime: () => ({
        stream: async (_messages, context, callbacks) => {
          streamContext = context;
          callbacks?.onFinish?.({
            text: "hello from runtime",
            messages: [],
            toolCalls: [],
            status: "completed",
            usage: {
              promptTokens: 21,
              completionTokens: 13,
              totalTokens: 34,
            },
            metadata: {
              finishReason: "stop",
            },
          });

          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encodeDataStreamEvent({ type: "message-start", messageId: "assistant-msg-1" }),
              );
              controller.enqueue(encodeDataStreamEvent({ type: "step-start" }));
              controller.enqueue(
                encodeDataStreamEvent({ type: "reasoning-start", id: "reasoning-1" }),
              );
              controller.enqueue(
                encodeDataStreamEvent({
                  type: "reasoning-delta",
                  id: "reasoning-1",
                  delta: "thinking through the answer",
                }),
              );
              controller.enqueue(
                encodeDataStreamEvent({ type: "reasoning-end", id: "reasoning-1" }),
              );
              controller.enqueue(
                encodeDataStreamEvent({
                  type: "data-message-metadata",
                  data: { status: "running" },
                }),
              );
              controller.enqueue(encodeDataStreamEvent({ type: "text-start", id: "text-1" }));
              controller.enqueue(
                encodeDataStreamEvent({
                  type: "text-delta",
                  id: "text-1",
                  delta: "hello from runtime",
                }),
              );
              controller.enqueue(encodeDataStreamEvent({ type: "text-end", id: "text-1" }));
              controller.enqueue(encodeDataStreamEvent({ type: "step-end" }));
              controller.close();
            },
          });
        },
      }),
    });

    const body = createAgentStreamRequestBody({
      credentials: { authToken: "request-scoped-user-token" },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(discoveryCalls, 1);
    assertEquals(streamContext?.authToken, "request-scoped-user-token");
    assertEquals(result.response.headers.get("content-type"), "text/event-stream");
    assertEquals(
      result.response.headers.get("x-veryfront-runtime-owner-invoke-url"),
      "http://10.0.0.7:20000/channels/invoke",
    );

    const text = await result.response.text();
    assertStringIncludes(text, "event: RunStarted");
    assertStringIncludes(text, "event: TextMessageContent");
    assertStringIncludes(text, "event: RunFinished");
    assertStringIncludes(text, '"inputTokens":21');
    assertStringIncludes(text, "event: StepStarted");
    assertStringIncludes(text, "event: StepFinished");
    assertStringIncludes(text, "event: Custom");
    assertStringIncludes(text, '"name":"message-metadata"');
    assertEquals(text.includes("event: ActivitySnapshot"), false);
    assertEquals(text.includes("event: ActivityDelta"), false);
    assertStringIncludes(text, "event: ReasoningMessageStart");
    assertStringIncludes(text, "event: ReasoningMessageContent");
    assertStringIncludes(text, "event: ReasoningMessageEnd");
  });

  it("streams AG-UI events for the signed runtime agent invocation envelope", async () => {
    let discoveryCalls = 0;
    let streamContext: Record<string, unknown> | undefined;
    let runtimeSystem: unknown;
    let runtimeMessages: AgentMessage[] | undefined;
    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls += 1;
        return createEmptyDiscoveryResult();
      },
      getAgent: (id) => id === "assistant-1" ? createAgent("assistant-1") : undefined,
      getAllAgentIds: () => ["assistant-1"],
      sessionManager: new AgentRunSessionManager(),
      createRuntime: (runtimeAgent) => ({
        stream: async (messages, context, callbacks) => {
          runtimeSystem = runtimeAgent.config.system;
          runtimeMessages = messages;
          streamContext = context;
          callbacks?.onFinish?.({
            text: "hello from runtime",
            messages: [],
            toolCalls: [],
            status: "completed",
            usage: {
              promptTokens: 3,
              completionTokens: 4,
              totalTokens: 7,
            },
            metadata: {
              finishReason: "stop",
            },
          });

          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encodeDataStreamEvent({ type: "message-start", messageId: "assistant-msg-1" }),
              );
              controller.enqueue(encodeDataStreamEvent({ type: "text-start", id: "text-1" }));
              controller.enqueue(
                encodeDataStreamEvent({
                  type: "text-delta",
                  id: "text-1",
                  delta: "hello from runtime",
                }),
              );
              controller.enqueue(encodeDataStreamEvent({ type: "text-end", id: "text-1" }));
              controller.close();
            },
          });
        },
      }),
    });

    const invocation = JSON.parse(createRuntimeAgentRunInvocationBody());
    invocation.context = [{
      type: "json",
      title: "studio_context",
      data: { branchId: null },
    }];
    invocation.messages[0].parts.push({
      type: "file",
      uploadId: "20000000-2000-4000-8000-200000000001",
      uploadPath: "_chat/user/screenshot.png",
      mediaType: "image/png",
      url: "https://uploads.example.com/screenshot.png",
      filename: "screenshot.png",
    });
    const body = JSON.stringify(invocation);
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(discoveryCalls, 1);
    assertEquals(streamContext?.runId, "run_1");
    assertEquals(streamContext?.threadId, "10000000-1000-4000-8000-100000000001");
    const resolvedRuntimeSystem = await resolveAgentSystem(
      runtimeSystem as Agent["config"]["system"],
      undefined,
    );
    assertEquals(Array.isArray(resolvedRuntimeSystem), true);
    assertStringIncludes(
      flattenSystemInstructions(resolvedRuntimeSystem as ChatSystemMessage[]),
      "You are helpful.",
    );
    assertEquals(
      runtimeMessages?.[0]?.parts as unknown,
      [
        { type: "text", text: "Hello" },
        {
          type: "file",
          mediaType: "image/png",
          url: "https://uploads.example.com/screenshot.png",
          filename: "screenshot.png",
          uploadId: "20000000-2000-4000-8000-200000000001",
          uploadPath: "_chat/user/screenshot.png",
        },
        {
          type: "text",
          text: "Attached files from earlier conversation context:\n\n" +
            "<uploaded_files>\n" +
            '<file name="screenshot.png" upload_id="20000000-2000-4000-8000-200000000001" ' +
            'path="_chat/user/screenshot.png" url="https://uploads.example.com/screenshot.png" ' +
            'type="image/png" />\n' +
            "</uploaded_files>",
        },
      ],
    );
    const prompt = flattenSystemInstructions(resolvedRuntimeSystem as ChatSystemMessage[]);
    assertStringIncludes(
      prompt,
      'branch_id: "10000000-1000-4000-8000-100000000006"',
    );
    assertEquals(prompt.includes("branch_id: main"), false);

    const text = await result.response.text();
    assertStringIncludes(text, "event: RunStarted");
    assertStringIncludes(text, "event: TextMessageContent");
    assertStringIncludes(text, "event: RunFinished");
  });

  it("accepts the public control-plane stream route", async () => {
    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: (id) => id === "assistant-1" ? createAgent("assistant-1") : undefined,
      getAllAgentIds: () => ["assistant-1"],
      sessionManager: new AgentRunSessionManager(),
      createRuntime: () => ({
        stream: async (_messages, _context, callbacks) => {
          callbacks?.onFinish?.({
            text: "hello from runtime",
            messages: [],
            toolCalls: [],
            status: "completed",
            usage: undefined,
            metadata: { finishReason: "stop" },
          });

          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.close();
            },
          });
        },
      }),
    });

    const body = createAgentStreamRequestBody();
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
  });

  it("selects a requested agent and its local tools from a multi-agent runtime", async () => {
    const agents = new Map([
      ["assistant-1", createAgent("assistant-1")],
      [
        "assistant-2",
        createAgentWithConfig("assistant-2", {
          tools: { local_lookup: true },
        }),
      ],
    ]);
    let localToolsAgentId: string | undefined;
    let runtimeAgentId: string | undefined;
    let runtimeToolNames: string[] | undefined;

    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: (id) => agents.get(id),
      getAllAgentIds: () => [...agents.keys()],
      getLocalTools: (agentId) => {
        localToolsAgentId = agentId;
        return { local_lookup: true };
      },
      sessionManager: new AgentRunSessionManager(),
      createRuntime: (runtimeAgent, mergedTools) => {
        runtimeAgentId = runtimeAgent.id;
        runtimeToolNames = mergedTools && mergedTools !== true
          ? Object.keys(mergedTools).sort()
          : [];

        return {
          stream: async (_messages, _context, callbacks) => {
            callbacks?.onFinish?.({
              text: "selected assistant-2",
              messages: [],
              toolCalls: [],
              status: "completed",
              usage: undefined,
              metadata: { finishReason: "stop" },
            });

            return new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  encodeDataStreamEvent({ type: "message-start", messageId: "assistant-msg-1" }),
                );
                controller.enqueue(encodeDataStreamEvent({ type: "text-start", id: "text-1" }));
                controller.enqueue(
                  encodeDataStreamEvent({
                    type: "text-delta",
                    id: "text-1",
                    delta: "selected assistant-2",
                  }),
                );
                controller.enqueue(encodeDataStreamEvent({ type: "text-end", id: "text-1" }));
                controller.close();
              },
            });
          },
        };
      },
    });

    const body = createAgentStreamRequestBody({ agentId: "assistant-2" });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "run_1",
    });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    await result.response.text();
    assertEquals(localToolsAgentId, "assistant-2");
    assertEquals(runtimeAgentId, "assistant-2");
    assertEquals(runtimeToolNames, ["local_lookup", "studio_focus_component"]);
  });

  it("rejects the removed internal AG-UI request shape on the public stream route", async () => {
    let discoveryCalls = 0;
    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls++;
        return createEmptyDiscoveryResult();
      },
      getAgent: () => undefined,
      getAllAgentIds: () => [],
      sessionManager: new AgentRunSessionManager(),
    });

    const body = JSON.stringify({
      agentId: "assistant-1",
      threadId: "10000000-1000-4000-8000-100000000001",
      runId: "run_1",
      agentSource: { type: "branch", branch: "main" },
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
          content: "hello",
        },
      ],
      context: [{
        description: "Current file",
        value: "src/main.ts",
      }],
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 400);
    assertEquals(discoveryCalls, 0);
  });

  it("accepts canonical runtime invocation payloads from the API executor", async () => {
    let streamContext: Record<string, unknown> | undefined;
    let streamMessages: Array<Record<string, unknown>> | undefined;
    let injectedToolSchema: unknown;

    const inputSchema = {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    };

    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: (id) => id === "incident-responder" ? createAgent("incident-responder") : undefined,
      getAllAgentIds: () => ["incident-responder"],
      sessionManager: new AgentRunSessionManager(),
      createRuntime: (_agent, mergedTools) => {
        const tools = mergedTools as Record<string, { inputSchemaJson?: unknown }> | undefined;
        injectedToolSchema = tools?.studio_search_files?.inputSchemaJson;

        return {
          stream: async (messages, context, callbacks) => {
            streamMessages = messages as Array<Record<string, unknown>>;
            streamContext = context;
            callbacks?.onFinish?.({
              text: "hello from runtime",
              messages: [],
              toolCalls: [],
              status: "completed",
              usage: {
                promptTokens: 2,
                completionTokens: 3,
                totalTokens: 5,
              },
              metadata: {
                finishReason: "stop",
              },
            });

            return new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  encodeDataStreamEvent({ type: "message-start", messageId: "assistant-msg-1" }),
                );
                controller.enqueue(encodeDataStreamEvent({ type: "text-start", id: "text-1" }));
                controller.enqueue(
                  encodeDataStreamEvent({
                    type: "text-delta",
                    id: "text-1",
                    delta: "hello from runtime",
                  }),
                );
                controller.enqueue(encodeDataStreamEvent({ type: "text-end", id: "text-1" }));
                controller.close();
              },
            });
          },
        };
      },
    });

    const body = JSON.stringify({
      run: {
        agentServiceId: "veryfront-platform-agent",
        agentId: "incident-responder",
        conversationId: "10000000-1000-4000-8000-100000000001",
        runId: "run_1",
        messageId: "20000000-2000-4000-8000-200000000001",
        inputAnchorMessageId: "20000000-2000-4000-8000-200000000001",
        requestedByUserId: "30000000-3000-4000-8000-300000000001",
        project: {
          projectId: "40000000-4000-4000-8000-400000000001",
          projectSlug: "incident-responder-cwy27d",
          runtimeTargetKind: "preview_branch",
          runtimeTargetBranchId: "50000000-5000-4000-8000-500000000001",
        },
      },
      agentSource: { type: "branch", branch: "main" },
      messages: [
        {
          id: "msg_1",
          role: "user",
          parts: [{ type: "text", text: "hi" }],
        },
      ],
      tools: [
        {
          name: "studio_search_files",
          description: "Search files",
          inputSchema,
        },
      ],
      context: [{ type: "text", text: "Current file: app.tsx" }],
      forwardedProps: {
        runtimeOverrides: {
          allowedTools: ["studio_search_files"],
        },
      },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });
    const ctx = createCtx(publicKeyPem);
    ctx.branchId = "50000000-5000-4000-8000-500000000001";

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      ctx,
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(streamContext, {
      threadId: "10000000-1000-4000-8000-100000000001",
      runId: "run_1",
      context: [{ type: "text", text: "Current file: app.tsx" }],
      forwardedProps: {
        runtimeOverrides: {
          allowedTools: ["studio_search_files"],
        },
      },
    });
    assertEquals(streamMessages?.[0]?.role, "user");
    assertEquals(injectedToolSchema, inputSchema);
  });

  it("runs control-plane streams with request-scoped project agent config", async () => {
    let capturedSystem: unknown;
    let capturedSkills: unknown;
    let capturedTools: unknown;
    let capturedAllowedRemoteTools: string[] | undefined;
    let platformMcpFetchCalls = 0;
    const originalApiUrl = Deno.env.get("VERYFRONT_API_URL");
    const originalApiBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");

    Deno.env.set("VERYFRONT_API_URL", TEST_PUBLIC_API_ORIGIN);
    Deno.env.delete("VERYFRONT_API_BASE_URL");
    installMockFetch(
      ((url, init) => {
        if (String(url) === `${TEST_PUBLIC_API_ORIGIN}/mcp`) {
          platformMcpFetchCalls += 1;
          assertEquals(
            new Headers(observeFetchRequestInit(init).headers).get("authorization"),
            "Bearer request-scoped-user-token",
          );
          return Promise.resolve(
            new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id: "veryfront-platform-mcp:tools:list",
                result: {
                  tools: [
                    {
                      name: "search_knowledge",
                      description: "Search project knowledge",
                      inputSchema: { type: "object", properties: {} },
                    },
                    {
                      name: "get_file",
                      description: "Read a project file",
                      inputSchema: { type: "object", properties: {} },
                    },
                  ],
                },
              }),
              { headers: { "content-type": "application/json" } },
            ),
          );
        }

        if (String(url) === `${TEST_PUBLIC_API_ORIGIN}/projects/demo-project/environments`) {
          return Promise.resolve(
            new Response(JSON.stringify({ data: [] }), {
              headers: { "content-type": "application/json" },
            }),
          );
        }

        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      }) as typeof fetch,
    );

    try {
      const handler = createTestAgentStreamHandler({
        ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
        getAgent: (id) => id === "assistant-1" ? createAgent("assistant-1") : undefined,
        getAllAgentIds: () => ["assistant-1"],
        sessionManager: new AgentRunSessionManager(),
        createRuntime: (runtimeAgent) => {
          const runtimeConfig = runtimeAgent.config as
            & typeof runtimeAgent.config
            & RuntimeRemoteToolConfig;
          capturedSystem = runtimeConfig.system;
          capturedSkills = runtimeConfig.skills;
          capturedTools = runtimeConfig.tools;
          capturedAllowedRemoteTools = runtimeConfig.__vfAllowedRemoteTools;

          return {
            stream: async (_messages, _context, callbacks) => {
              callbacks?.onFinish?.({
                text: "ok",
                messages: [],
                toolCalls: [],
                status: "completed",
                usage: {
                  promptTokens: 1,
                  completionTokens: 1,
                  totalTokens: 2,
                },
              });

              return new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.close();
                },
              });
            },
          };
        },
      });

      const body = createAgentStreamRequestBody({
        credentials: { authToken: "request-scoped-user-token" },
        agentConfig: {
          id: "assistant-1",
          name: "Project Assistant",
          description: "Uses project-scoped tools with skills disabled.",
          instructions: "Use project-scoped instructions.",
          skills: [],
          tools: ["search_knowledge", "get_file"],
        },
      });
      const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
        requestId: "run_1",
      });

      const result = await handler.handle(
        new Request("https://example.com/api/control-plane/runs/run_1/stream", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-veryfront-control-plane-jws": jws,
          },
          body,
        }),
        createCtx(publicKeyPem),
      );

      assertExists(result.response);
      assertEquals(result.response.status, 200);
      const resolvedSystem = typeof capturedSystem === "function"
        ? await (capturedSystem as () => Promise<AgentSystem>)()
        : capturedSystem as AgentSystem;
      assertStringIncludes(
        typeof resolvedSystem === "string"
          ? resolvedSystem
          : flattenSystemInstructions(resolvedSystem),
        "Use project-scoped instructions.",
      );
      assertEquals(capturedSkills, []);
      assertEquals((capturedTools as Record<string, unknown>).search_knowledge, true);
      assertEquals((capturedTools as Record<string, unknown>).get_file, true);
      assertEquals(capturedAllowedRemoteTools, ["get_file", "search_knowledge"]);
      assertEquals(platformMcpFetchCalls, 1);
    } finally {
      restoreMockFetch();
      if (originalApiUrl === undefined) Deno.env.delete("VERYFRONT_API_URL");
      else Deno.env.set("VERYFRONT_API_URL", originalApiUrl);
      if (originalApiBaseUrl === undefined) Deno.env.delete("VERYFRONT_API_BASE_URL");
      else Deno.env.set("VERYFRONT_API_BASE_URL", originalApiBaseUrl);
    }
  });

  it("does not pass undeclared forwarded remote tool allowlists into the runtime agent config", async () => {
    let capturedAllowedTools: string[] | undefined;

    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: (id) => id === "assistant-1" ? createAgent("assistant-1") : undefined,
      getAllAgentIds: () => ["assistant-1"],
      sessionManager: new AgentRunSessionManager(),
      createRuntime: (agent) => {
        capturedAllowedTools = (agent.config as typeof agent.config & RuntimeRemoteToolConfig)
          .__vfAllowedRemoteTools;

        return {
          stream: async (_messages, _context, callbacks) => {
            callbacks?.onFinish?.({
              text: "ok",
              messages: [],
              toolCalls: [],
              status: "completed",
              usage: {
                promptTokens: 1,
                completionTokens: 1,
                totalTokens: 2,
              },
            });

            return new ReadableStream<Uint8Array>({
              start(controller) {
                controller.close();
              },
            });
          },
        };
      },
    });

    const body = createAgentStreamRequestBody({
      forwardedProps: {
        runtimeOverrides: {
          allowedTools: ["gmail__list_emails", "gmail__get_email"],
        },
      },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(capturedAllowedTools, undefined);
  });

  it("loads and applies integration restrictions from the exact requested source", async () => {
    let capturedSourcePolicy: ReturnType<typeof getRuntimeSourceIntegrationPolicy>;
    let discoveryConfig: HandlerContext["config"];
    const fetchUrls: string[] = [];

    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async (ctx) => {
        discoveryConfig = ctx.config;
        return createEmptyDiscoveryResult();
      },
      getAgent: (id) =>
        id === "assistant-1"
          ? createAgentWithConfig("assistant-1", {
            mcpServers: [],
            tools: {
              gmail__list_emails: true,
              gmail__delete_email: true,
            },
          })
          : undefined,
      getAllAgentIds: () => ["assistant-1"],
      sessionManager: new AgentRunSessionManager(),
      createRuntime: (agent) => ({
        stream: async (_messages, _context, callbacks) => {
          capturedSourcePolicy = getRuntimeSourceIntegrationPolicy(agent.config);

          callbacks?.onFinish?.({
            text: "ok",
            messages: [],
            toolCalls: [],
            status: "completed",
            usage: undefined,
          });
          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.close();
            },
          });
        },
      }),
    });

    const contextCalls: string[] = [];
    const configReads: string[] = [];
    const sourceEvents: string[] = [];
    const fs = createNoopFsAdapter([]);
    Object.assign(fs, {
      getUnderlyingAdapter: () => fs,
      isVeryfrontAdapter: () => true,
      ensureSourceSnapshotFresh: async () => {
        sourceEvents.push("source-fresh");
      },
      exists: async (path: string) => path === "/veryfront.config.ts",
      readFile: async () => {
        const branch = getCurrentRequestContext()?.branch ?? "main";
        sourceEvents.push("config-read");
        configReads.push(branch);
        return branch === "restrict-gmail"
          ? 'export default { integrations: { allow: { gmail: { allowedTools: ["list_emails"] } } } };'
          : "export default {};";
      },
      runWithContext: (
        projectSlug: string,
        token: string,
        fn: () => Promise<unknown>,
        projectId?: string,
        options?: {
          productionMode?: boolean;
          releaseId?: string | null;
          branch?: string | null;
          environmentName?: string | null;
        },
      ) => {
        contextCalls.push(options?.branch ?? "main");
        return runWithRequestContext({ projectSlug, projectId, token, ...options }, fn);
      },
    });

    const body = createAgentStreamRequestBody({
      project: {
        runtimeTargetKind: "preview_branch",
        runtimeTargetBranchId: "50000000-5000-4000-8000-500000000002",
      },
      agentSource: { type: "branch", branch: "restrict-gmail" },
      credentials: { authToken: "request-scoped-user-token" },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });
    const ctx = createCtx(publicKeyPem);
    ctx.branchId = "50000000-5000-4000-8000-500000000002";
    ctx.branchName = "restrict-gmail";
    ctx.adapter = {
      ...ctx.adapter,
      env: createNoopEnvAdapter(publicKeyPem),
      fs,
    };

    const result = await withMockFetch(
      (input) => {
        fetchUrls.push(String(input));
        return Promise.reject(new Error(`unexpected fetch: ${input}`));
      },
      () =>
        handler.handle(
          new Request("https://example.com/api/control-plane/runs/run_1/stream", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-veryfront-control-plane-jws": jws,
            },
            body,
          }),
          ctx,
        ),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(fetchUrls, []);
    assertEquals(contextCalls, ["restrict-gmail"]);
    assertEquals(configReads, ["restrict-gmail"]);
    assertEquals(sourceEvents.slice(0, 2), ["source-fresh", "config-read"]);
    assertEquals(discoveryConfig?.integrations, {
      allow: { gmail: { allowedTools: ["list_emails"] } },
    });
    assertEquals(capturedSourcePolicy, {
      schemaVersion: 1,
      mode: "allowlist",
      integrations: { gmail: { allowedToolIds: ["list_emails"] } },
    });
  });

  it("fails closed before discovery when the runtime cannot select the signed source", async () => {
    let discoveryCalls = 0;
    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls += 1;
        return createEmptyDiscoveryResult();
      },
      getAgent: () => undefined,
      getAllAgentIds: () => [],
      sessionManager: new AgentRunSessionManager(),
    });
    const body = createAgentStreamRequestBody();
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createSingleProjectCtx(publicKeyPem),
    );

    assertEquals(result.response?.status, 400);
    assertEquals(discoveryCalls, 0);
  });

  it("rejects a missing source before discovery", async () => {
    let discoveryCalls = 0;
    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls += 1;
        return createEmptyDiscoveryResult();
      },
      getAgent: () => undefined,
      getAllAgentIds: () => [],
      sessionManager: new AgentRunSessionManager(),
    });
    const body = createAgentStreamRequestBody({ agentSource: undefined });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertEquals(result.response?.status, 400);
    assertEquals(discoveryCalls, 0);
  });

  it("does not use an outer config when the exact source config cannot load", async () => {
    let discoveryCalls = 0;
    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls += 1;
        return createEmptyDiscoveryResult();
      },
      getAgent: () => undefined,
      getAllAgentIds: () => [],
      sessionManager: new AgentRunSessionManager(),
    });
    const fs = createNoopFsAdapter([]);
    Object.assign(fs, {
      exists: async (path: string) => path === "/veryfront.config.ts",
      readFile: async () => "export default { integrations:",
    });
    const body = createAgentStreamRequestBody();
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });
    const ctx = createCtx(publicKeyPem);
    ctx.config = {};
    ctx.adapter = { ...ctx.adapter, fs };

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      ctx,
    );

    assertEquals(result.response?.status, 400);
    assertEquals(discoveryCalls, 0);
  });

  it("drops undeclared Studio runtime tool allowlists for untrusted clients", async () => {
    let capturedAllowedTools: string[] | undefined;

    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: (id) => id === "assistant-1" ? createAgent("assistant-1") : undefined,
      getAllAgentIds: () => ["assistant-1"],
      sessionManager: new AgentRunSessionManager(),
      createRuntime: (agent) => {
        capturedAllowedTools = (agent.config as typeof agent.config & RuntimeRemoteToolConfig)
          .__vfAllowedRemoteTools;

        return {
          stream: async (_messages, _context, callbacks) => {
            callbacks?.onFinish?.({
              text: "ok",
              messages: [],
              toolCalls: [],
              status: "completed",
              usage: {
                promptTokens: 1,
                completionTokens: 1,
                totalTokens: 2,
              },
            });

            return new ReadableStream<Uint8Array>({
              start(controller) {
                controller.close();
              },
            });
          },
        };
      },
    });

    const body = createAgentStreamRequestBody({
      forwardedProps: {
        clientId: "external-client",
        runtimeOverrides: {
          allowedTools: ["studio_todo_write"],
        },
      },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(capturedAllowedTools, undefined);
  });

  it("does not auto-expose Studio MCP tools from self-asserted Studio metadata", async () => {
    let capturedAllowedRemoteTools: string[] | undefined;
    let capturedRemoteToolNames: string[] = [];
    const originalStudioMcpUrl = Deno.env.get("VERYFRONT_STUDIO_MCP_URL");

    Deno.env.set("VERYFRONT_STUDIO_MCP_URL", TEST_PUBLIC_STUDIO_MCP_URL);
    installMockFetch(
      ((url, init) => {
        assertEquals(String(url), TEST_PUBLIC_STUDIO_MCP_URL);
        const headers = new Headers(observeFetchRequestInit(init).headers);
        assertEquals(headers.get("authorization"), "Bearer request-scoped-user-token");
        assertEquals(headers.get("x-project-id"), "proj-1");
        assertEquals(headers.get("x-conversation-id"), "10000000-1000-4000-8000-100000000001");

        return Promise.resolve(
          new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: "studio-mcp:tools:list",
              result: {
                tools: [
                  {
                    name: "studio_todo_write",
                    description: "Write the assistant task list",
                    inputSchema: { type: "object", properties: {} },
                  },
                  {
                    name: "studio_panel_control",
                    description: "Control Studio panels",
                    inputSchema: { type: "object", properties: {} },
                  },
                ],
              },
            }),
            { headers: { "content-type": "application/json" } },
          ),
        );
      }) as typeof fetch,
    );

    try {
      const handler = createTestAgentStreamHandler({
        ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
        getAgent: (id) => id === "assistant-1" ? createAgent("assistant-1") : undefined,
        getAllAgentIds: () => ["assistant-1"],
        sessionManager: new AgentRunSessionManager(),
        createRuntime: (runtimeAgent) => ({
          stream: async (_messages, _context, callbacks) => {
            const runtimeConfig = runtimeAgent.config as
              & typeof runtimeAgent.config
              & RuntimeRemoteToolConfig;
            capturedAllowedRemoteTools = runtimeConfig.__vfAllowedRemoteTools;
            capturedRemoteToolNames = (await runtimeConfig.__vfRemoteToolSources?.[0]?.listTools({
              projectId: "proj-1",
            }))?.map((tool) => tool.name) ?? [];
            callbacks?.onFinish?.({
              text: "ok",
              messages: [],
              toolCalls: [],
              status: "completed",
              usage: {
                promptTokens: 1,
                completionTokens: 1,
                totalTokens: 2,
              },
            });

            return new ReadableStream<Uint8Array>({
              start(controller) {
                controller.close();
              },
            });
          },
        }),
      });

      const body = createAgentStreamRequestBody({
        credentials: { authToken: "request-scoped-user-token" },
        forwardedProps: {
          clientId: "veryfront-studio",
          veryfront: {
            client: {
              id: "veryfront-studio",
              type: "web",
              platform: "browser",
            },
          },
          runtimeOverrides: {
            allowedTools: ["studio_todo_write"],
          },
        },
      });
      const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

      const result = await handler.handle(
        new Request("https://example.com/api/control-plane/runs/run_1/stream", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-veryfront-control-plane-jws": jws,
          },
          body,
        }),
        createCtx(publicKeyPem),
      );

      assertExists(result.response);
      assertEquals(result.response.status, 200);
      assertEquals(capturedAllowedRemoteTools, undefined);
      assertEquals(capturedRemoteToolNames, []);
    } finally {
      restoreMockFetch();
      if (originalStudioMcpUrl === undefined) Deno.env.delete("VERYFRONT_STUDIO_MCP_URL");
      else Deno.env.set("VERYFRONT_STUDIO_MCP_URL", originalStudioMcpUrl);
    }
  });

  it("injects the trusted Studio source for explicit Studio MCP configuration", async () => {
    const originalStudioMcpUrl = Deno.env.get("VERYFRONT_STUDIO_MCP_URL");
    let capturedRemoteToolNames: string[] = [];
    let capturedAllowedRemoteTools: string[] | undefined;
    Deno.env.set("VERYFRONT_STUDIO_MCP_URL", TEST_PUBLIC_STUDIO_MCP_URL);
    installMockFetch(
      ((url, init) => {
        assertEquals(String(url), TEST_PUBLIC_STUDIO_MCP_URL);
        const headers = new Headers(observeFetchRequestInit(init).headers);
        assertEquals(headers.get("authorization"), "Bearer request-scoped-user-token");
        assertEquals(headers.get("x-project-id"), "proj-1");
        assertEquals(headers.get("x-conversation-id"), "10000000-1000-4000-8000-100000000001");
        return Promise.resolve(
          new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: "studio-mcp:tools:list",
              result: {
                tools: [{
                  name: "studio_todo_write",
                  description: "Write the assistant task list",
                  inputSchema: { type: "object", properties: {} },
                }],
              },
            }),
            { headers: { "content-type": "application/json" } },
          ),
        );
      }) as typeof fetch,
    );

    try {
      const handler = createTestAgentStreamHandler({
        ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
        getAgent: (id) =>
          id === "assistant-1"
            ? createAgentWithConfig("assistant-1", {
              tools: { studio_todo_write: true },
              mcpServers: [{
                kind: "veryfront-studio",
                toolPolicy: { allow: ["studio_todo_write"] },
              }],
            })
            : undefined,
        getAllAgentIds: () => ["assistant-1"],
        sessionManager: new AgentRunSessionManager(),
        createRuntime: (runtimeAgent) => ({
          stream: async (_messages, _context, callbacks) => {
            capturedAllowedRemoteTools = (runtimeAgent.config as RuntimeRemoteToolConfig)
              .__vfAllowedRemoteTools;
            const studioSource = getRuntimeRemoteToolSources(runtimeAgent.config)?.find(
              (source) => source.id === "studio-mcp",
            );
            capturedRemoteToolNames = (await studioSource?.listTools({ projectId: "proj-1" }))
              ?.map((tool) => tool.name) ?? [];
            callbacks?.onFinish?.({
              text: "ok",
              messages: [],
              toolCalls: [],
              status: "completed",
              usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
            });
            return new ReadableStream<Uint8Array>({
              start(controller) {
                controller.close();
              },
            });
          },
        }),
      });
      const body = createAgentStreamRequestBody({
        credentials: { authToken: "request-scoped-user-token" },
        forwardedProps: {
          clientId: "veryfront-studio",
          veryfront: {
            client: { id: "veryfront-studio", type: "web", platform: "browser" },
          },
        },
      });
      const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
        requestId: "run_1",
      });

      const result = await handler.handle(
        new Request("https://example.com/api/control-plane/runs/run_1/stream", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-veryfront-control-plane-jws": jws,
          },
          body,
        }),
        createCtx(publicKeyPem),
      );

      assertExists(result.response);
      assertEquals(result.response.status, 200, await result.response.clone().text());
      assertEquals(capturedRemoteToolNames, ["studio_todo_write"]);
      assertEquals(capturedAllowedRemoteTools, ["studio_todo_write"]);
    } finally {
      restoreMockFetch();
      if (originalStudioMcpUrl === undefined) Deno.env.delete("VERYFRONT_STUDIO_MCP_URL");
      else Deno.env.set("VERYFRONT_STUDIO_MCP_URL", originalStudioMcpUrl);
    }
  });

  it("discovers policy-filtered Studio tools for an explicit broad selector", async () => {
    const originalStudioMcpUrl = Deno.env.get("VERYFRONT_STUDIO_MCP_URL");
    let capturedAllowedRemoteTools: string[] | undefined;
    Deno.env.set("VERYFRONT_STUDIO_MCP_URL", TEST_PUBLIC_STUDIO_MCP_URL);
    installMockFetch(
      (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: "studio-mcp:tools:list",
              result: {
                tools: [
                  { name: "studio_todo_write", description: "Write todos", inputSchema: {} },
                  { name: "studio_panel_control", description: "Control panels", inputSchema: {} },
                ],
              },
            }),
            { headers: { "content-type": "application/json" } },
          ),
        )) as typeof fetch,
    );
    try {
      const handler = createTestAgentStreamHandler({
        ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
        getAgent: (id) =>
          id === "assistant-1"
            ? createAgentWithConfig("assistant-1", {
              tools: true,
              mcpServers: [{
                kind: "veryfront-studio",
                toolPolicy: { allow: ["studio_todo_write"] },
              }],
            })
            : undefined,
        getAllAgentIds: () => ["assistant-1"],
        sessionManager: new AgentRunSessionManager(),
        createRuntime: (runtimeAgent) => ({
          stream: async (_messages, _context, callbacks) => {
            capturedAllowedRemoteTools = (runtimeAgent.config as RuntimeRemoteToolConfig)
              .__vfAllowedRemoteTools;
            callbacks?.onFinish?.({
              text: "ok",
              messages: [],
              toolCalls: [],
              status: "completed",
              usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
            });
            return new ReadableStream<Uint8Array>({ start: (controller) => controller.close() });
          },
        }),
      });
      const body = createAgentStreamRequestBody({
        credentials: { authToken: "request-scoped-user-token" },
        forwardedProps: {
          clientId: "veryfront-studio",
          veryfront: { client: { id: "veryfront-studio", type: "web", platform: "browser" } },
        },
      });
      const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
        requestId: "run_1",
      });
      const result = await handler.handle(
        new Request("https://example.com/api/control-plane/runs/run_1/stream", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-veryfront-control-plane-jws": jws,
          },
          body,
        }),
        createCtx(publicKeyPem),
      );

      assertEquals(result.response?.status, 200);
      assertEquals(capturedAllowedRemoteTools, ["studio_todo_write"]);
    } finally {
      restoreMockFetch();
      if (originalStudioMcpUrl === undefined) Deno.env.delete("VERYFRONT_STUDIO_MCP_URL");
      else Deno.env.set("VERYFRONT_STUDIO_MCP_URL", originalStudioMcpUrl);
    }
  });

  it("continues with no Studio grants when broad discovery fails", async () => {
    const originalStudioMcpUrl = Deno.env.get("VERYFRONT_STUDIO_MCP_URL");
    let capturedAllowedRemoteTools: string[] | undefined;
    Deno.env.set("VERYFRONT_STUDIO_MCP_URL", TEST_PUBLIC_STUDIO_MCP_URL);
    installMockFetch(() => Promise.reject(new Error("Studio discovery unavailable")));
    try {
      const handler = createTestAgentStreamHandler({
        ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
        getAgent: (id) =>
          id === "assistant-1"
            ? createAgentWithConfig("assistant-1", {
              tools: true,
              mcpServers: [{ kind: "veryfront-studio" }],
            })
            : undefined,
        getAllAgentIds: () => ["assistant-1"],
        sessionManager: new AgentRunSessionManager(),
        createRuntime: (runtimeAgent) => ({
          stream: async (_messages, _context, callbacks) => {
            capturedAllowedRemoteTools = (runtimeAgent.config as RuntimeRemoteToolConfig)
              .__vfAllowedRemoteTools;
            callbacks?.onFinish?.({
              text: "ok",
              messages: [],
              toolCalls: [],
              status: "completed",
              usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
            });
            return new ReadableStream<Uint8Array>({ start: (controller) => controller.close() });
          },
        }),
      });
      const body = createAgentStreamRequestBody({
        credentials: { authToken: "request-scoped-user-token" },
        forwardedProps: {
          clientId: "veryfront-studio",
          veryfront: { client: { id: "veryfront-studio", type: "web", platform: "browser" } },
        },
      });
      const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
        requestId: "run_1",
      });
      const result = await handler.handle(
        new Request("https://example.com/api/control-plane/runs/run_1/stream", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-veryfront-control-plane-jws": jws,
          },
          body,
        }),
        createCtx(publicKeyPem),
      );

      assertEquals(result.response?.status, 200);
      assertEquals(capturedAllowedRemoteTools, []);
    } finally {
      restoreMockFetch();
      if (originalStudioMcpUrl === undefined) Deno.env.delete("VERYFRONT_STUDIO_MCP_URL");
      else Deno.env.set("VERYFRONT_STUDIO_MCP_URL", originalStudioMcpUrl);
    }
  });

  it("rejects explicit Studio MCP for a non-Studio client", async () => {
    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: (id) =>
        id === "assistant-1"
          ? createAgentWithConfig("assistant-1", {
            tools: true,
            mcpServers: [{ kind: "veryfront-studio" }],
          })
          : undefined,
      getAllAgentIds: () => ["assistant-1"],
      sessionManager: new AgentRunSessionManager(),
    });
    const body = createAgentStreamRequestBody({
      credentials: { authToken: "request-scoped-user-token" },
      forwardedProps: { clientId: "external-client" },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "run_1",
    });
    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertEquals(result.response?.status, 403);
  });

  it("preserves an explicit Studio MCP opt-out", async () => {
    let studioMcpFetchCalls = 0;
    let capturedAllowedRemoteTools: string[] | undefined;
    let capturedRemoteSourceCount = -1;
    const originalStudioMcpUrl = Deno.env.get("VERYFRONT_STUDIO_MCP_URL");

    Deno.env.set("VERYFRONT_STUDIO_MCP_URL", TEST_PUBLIC_STUDIO_MCP_URL);
    installMockFetch(
      ((url) => {
        if (String(url) === TEST_PUBLIC_STUDIO_MCP_URL) {
          studioMcpFetchCalls += 1;
        }
        return Promise.resolve(new Response(null, { status: 503 }));
      }) as typeof fetch,
    );

    try {
      const handler = createTestAgentStreamHandler({
        ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
        getAgent: (id) =>
          id === "assistant-1"
            ? createAgentWithConfig("assistant-1", {
              tools: { studio_todo_write: true },
              mcpServers: [],
            })
            : undefined,
        getAllAgentIds: () => ["assistant-1"],
        sessionManager: new AgentRunSessionManager(),
        createRuntime: (runtimeAgent) => {
          const runtimeConfig = runtimeAgent.config as
            & typeof runtimeAgent.config
            & RuntimeRemoteToolConfig;
          capturedAllowedRemoteTools = runtimeConfig.__vfAllowedRemoteTools;
          capturedRemoteSourceCount = runtimeConfig.__vfRemoteToolSources?.length ?? 0;

          return {
            stream: async (_messages, _context, callbacks) => {
              callbacks?.onFinish?.({
                text: "ok",
                messages: [],
                toolCalls: [],
                status: "completed",
                usage: {
                  promptTokens: 1,
                  completionTokens: 1,
                  totalTokens: 2,
                },
              });
              return new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.close();
                },
              });
            },
          };
        },
      });

      const body = createAgentStreamRequestBody({
        credentials: { authToken: "request-scoped-user-token" },
        forwardedProps: {
          clientId: "veryfront-studio",
          veryfront: {
            client: {
              id: "veryfront-studio",
              type: "web",
              platform: "browser",
            },
          },
          runtimeOverrides: {
            allowedTools: ["studio_todo_write"],
          },
        },
      });
      const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
        requestId: "run_1",
      });

      const result = await handler.handle(
        new Request("https://example.com/api/control-plane/runs/run_1/stream", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-veryfront-control-plane-jws": jws,
          },
          body,
        }),
        createCtx(publicKeyPem),
      );

      assertExists(result.response);
      assertEquals(result.response.status, 200);
      assertEquals(studioMcpFetchCalls, 0);
      assertEquals(capturedAllowedRemoteTools, ["studio_todo_write"]);
      assertEquals(capturedRemoteSourceCount, 0);
    } finally {
      restoreMockFetch();
      if (originalStudioMcpUrl === undefined) Deno.env.delete("VERYFRONT_STUDIO_MCP_URL");
      else Deno.env.set("VERYFRONT_STUDIO_MCP_URL", originalStudioMcpUrl);
    }
  });

  it("fails closed for malformed runtime integration tool allowlists from forwarded props", async () => {
    let capturedAllowedTools: string[] | undefined;

    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: (id) => id === "assistant-1" ? createAgent("assistant-1") : undefined,
      getAllAgentIds: () => ["assistant-1"],
      sessionManager: new AgentRunSessionManager(),
      createRuntime: (agent) => {
        capturedAllowedTools = (agent.config as typeof agent.config & RuntimeRemoteToolConfig)
          .__vfAllowedRemoteTools;

        return {
          stream: async (_messages, _context, callbacks) => {
            callbacks?.onFinish?.({
              text: "ok",
              messages: [],
              toolCalls: [],
              status: "completed",
              usage: {
                promptTokens: 1,
                completionTokens: 1,
                totalTokens: 2,
              },
            });

            return new ReadableStream<Uint8Array>({
              start(controller) {
                controller.close();
              },
            });
          },
        };
      },
    });

    const body = createAgentStreamRequestBody({
      forwardedProps: {
        runtimeOverrides: {
          allowedTools: ["gmail__list_emails", 123],
        },
      },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(capturedAllowedTools, []);
  });

  it("does not probe platform MCP for boolean tools already supplied by the run", async () => {
    let fetchCalls = 0;
    installMockFetch(async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ tools: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    try {
      const handler = createTestAgentStreamHandler({
        ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
        getAgent: (id) =>
          id === "assistant-1"
            ? createAgentWithConfig("assistant-1", {
              tools: { studio_focus_component: true },
            })
            : undefined,
        getAllAgentIds: () => ["assistant-1"],
        sessionManager: new AgentRunSessionManager(),
        createRuntime: () => ({
          stream: async (_messages, _context, callbacks) => {
            callbacks?.onFinish?.({
              text: "ok",
              messages: [],
              toolCalls: [],
              status: "completed",
              usage: {
                promptTokens: 1,
                completionTokens: 1,
                totalTokens: 2,
              },
            });

            return new ReadableStream<Uint8Array>({
              start(controller) {
                controller.close();
              },
            });
          },
        }),
      });

      const body = createAgentStreamRequestBody();
      const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
        requestId: "run_1",
      });

      const result = await handler.handle(
        new Request("https://example.com/api/control-plane/runs/run_1/stream", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-veryfront-control-plane-jws": jws,
          },
          body,
        }),
        createCtx(publicKeyPem),
      );

      assertExists(result.response);
      assertEquals(result.response.status, 200);
      assertEquals(fetchCalls, 0);
    } finally {
      restoreMockFetch();
    }
  });

  it("fails closed when platform MCP is opted out or discovery fails", async () => {
    try {
      for (
        const testCase of [
          {
            id: "explicit-opt-out",
            name: "explicit opt-out",
            mcpServers: [] as const,
            expectedFetchCalls: 0,
          },
          {
            id: "failed-discovery",
            name: "failed discovery",
            mcpServers: undefined,
            expectedFetchCalls: 1,
          },
        ]
      ) {
        let mcpFetchCalls = 0;
        let capturedAllowedRemoteTools: string[] | undefined;
        let capturedRemoteSourceCount = -1;
        installMockFetch(
          ((url) => {
            if (String(url).endsWith("/mcp")) {
              mcpFetchCalls += 1;
              return Promise.reject(new Error(`${testCase.name} discovery unavailable`));
            }
            return Promise.resolve(new Response(null, { status: 503 }));
          }) as typeof fetch,
        );

        const handler = createTestAgentStreamHandler({
          ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
          getAgent: (id) =>
            id === "assistant-1"
              ? createAgentWithConfig("assistant-1", {
                tools: { get_file: true },
                ...(testCase.mcpServers === undefined
                  ? {}
                  : { mcpServers: [...testCase.mcpServers] }),
              })
              : undefined,
          getAllAgentIds: () => ["assistant-1"],
          sessionManager: new AgentRunSessionManager(),
          createRuntime: (runtimeAgent) => {
            const runtimeConfig = runtimeAgent.config as
              & typeof runtimeAgent.config
              & RuntimeRemoteToolConfig;
            capturedAllowedRemoteTools = runtimeConfig.__vfAllowedRemoteTools;
            capturedRemoteSourceCount = runtimeConfig.__vfRemoteToolSources?.length ?? 0;
            return {
              stream: async (_messages, _context, callbacks) => {
                callbacks?.onFinish?.({
                  text: "ok",
                  messages: [],
                  toolCalls: [],
                  status: "completed",
                  usage: {
                    promptTokens: 1,
                    completionTokens: 1,
                    totalTokens: 2,
                  },
                });
                return new ReadableStream<Uint8Array>({
                  start(controller) {
                    controller.close();
                  },
                });
              },
            };
          },
        });
        const body = createAgentStreamRequestBody({
          runId: `run-${testCase.id}`,
          credentials: { authToken: "request-scoped-user-token" },
        });
        const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
          audience: "support-agent-fork",
          requestId: `run-${testCase.id}`,
        });
        const result = await handler.handle(
          new Request(`https://example.com/api/control-plane/runs/run-${testCase.id}/stream`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-veryfront-control-plane-jws": jws,
            },
            body,
          }),
          {
            ...createCtx(publicKeyPem),
            proxyToken: "run-scoped-token",
            projectSlug: "support-agent-fork",
          },
        );

        assertExists(result.response);
        assertEquals(result.response.status, 200);
        assertEquals(mcpFetchCalls, testCase.expectedFetchCalls);
        assertEquals(capturedAllowedRemoteTools, undefined);
        assertEquals(capturedRemoteSourceCount, 0);
      }
    } finally {
      restoreMockFetch();
    }
  });

  it("exposes Veryfront API MCP tools requested through mcpServers policy", async () => {
    let capturedAllowedRemoteTools: string[] | undefined;
    let capturedRemoteToolNames: string[] = [];
    let capturedToolArguments: Record<string, unknown> | undefined;
    const originalApiUrl = Deno.env.get("VERYFRONT_API_URL");
    const originalApiBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");

    Deno.env.set("VERYFRONT_API_URL", TEST_PUBLIC_API_ORIGIN);
    Deno.env.delete("VERYFRONT_API_BASE_URL");
    installMockFetch(
      ((url, init) => {
        assertEquals(String(url), `${TEST_PUBLIC_API_ORIGIN}/mcp`);
        assertEquals(
          new Headers(observeFetchRequestInit(init).headers).get("authorization"),
          "Bearer request-scoped-user-token",
        );
        const request = JSON.parse(String(observeFetchRequestInit(init).body)) as {
          id: string;
          method: string;
          params?: { arguments?: Record<string, unknown> };
        };
        if (request.method === "tools/call") {
          capturedToolArguments = request.params?.arguments;
          return Promise.resolve(
            new Response(
              JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { content: [] } }),
              { headers: { "content-type": "application/json" } },
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: request.id,
              result: {
                tools: [
                  {
                    name: "list_uploads",
                    description: "List uploads",
                    inputSchema: {
                      type: "object",
                      properties: {
                        project_reference: { type: "string" },
                        limit: { type: "number" },
                      },
                      required: ["project_reference"],
                    },
                  },
                  {
                    name: "delete_upload",
                    description: "Delete upload",
                    inputSchema: { type: "object", properties: {} },
                  },
                ],
              },
            }),
            { headers: { "content-type": "application/json" } },
          ),
        );
      }) as typeof fetch,
    );

    try {
      const handler = createTestAgentStreamHandler({
        ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
        getAgent: (id) =>
          id === "assistant-1"
            ? createAgentWithConfig("assistant-1", {
              mcpServers: [{
                kind: "veryfront-api",
                toolPolicy: {
                  allow: ["list_uploads"],
                  deny: ["delete_upload"],
                },
              }],
            })
            : undefined,
        getAllAgentIds: () => ["assistant-1"],
        sessionManager: new AgentRunSessionManager(),
        createRuntime: (runtimeAgent) => ({
          stream: async (_messages, _context, callbacks) => {
            const runtimeConfig = runtimeAgent.config as
              & typeof runtimeAgent.config
              & RuntimeRemoteToolConfig;
            capturedAllowedRemoteTools = runtimeConfig.__vfAllowedRemoteTools;
            const platformSource = runtimeConfig.__vfRemoteToolSources?.[0];
            capturedRemoteToolNames = (await platformSource?.listTools({
              projectId: "untrusted-project",
            }))?.map((tool) => tool.name) ?? [];
            await platformSource?.executeTool(
              "list_uploads",
              { project_reference: "untrusted-project", limit: 10 },
              { projectId: "untrusted-project" },
            );
            callbacks?.onFinish?.({
              text: "ok",
              messages: [],
              toolCalls: [],
              status: "completed",
              usage: {
                promptTokens: 1,
                completionTokens: 1,
                totalTokens: 2,
              },
            });

            return new ReadableStream<Uint8Array>({
              start(controller) {
                controller.close();
              },
            });
          },
        }),
      });

      const body = createAgentStreamRequestBody({
        credentials: { authToken: "request-scoped-user-token" },
      });
      const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
        audience: "support-agent-fork",
        requestId: "run_1",
      });

      const result = await handler.handle(
        new Request("https://example.com/api/control-plane/runs/run_1/stream", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-veryfront-control-plane-jws": jws,
          },
          body,
        }),
        {
          ...createCtx(publicKeyPem),
          proxyToken: "run-scoped-token",
          projectSlug: "support-agent-fork",
        },
      );

      assertExists(result.response);
      assertEquals(result.response.status, 200);
      assertEquals(capturedAllowedRemoteTools, ["list_uploads"]);
      assertEquals(capturedRemoteToolNames, ["list_uploads", "delete_upload"]);
      assertEquals(capturedToolArguments, {
        project_reference: "proj-1",
        limit: 10,
      });
    } finally {
      restoreMockFetch();
      if (originalApiUrl === undefined) Deno.env.delete("VERYFRONT_API_URL");
      else Deno.env.set("VERYFRONT_API_URL", originalApiUrl);
      if (originalApiBaseUrl === undefined) Deno.env.delete("VERYFRONT_API_BASE_URL");
      else Deno.env.set("VERYFRONT_API_BASE_URL", originalApiBaseUrl);
    }
  });

  it("exposes request-scoped Veryfront env vars to dynamic agent systems and MCP headers", async () => {
    let capturedEnv: Record<string, string | undefined> | null = null;
    let capturedSystem: string | null = null;
    let capturedMcpRequest: { url: string; authorization: string | null } | null = null;
    let capturedAllowedRemoteTools: string[] | undefined;
    let capturedRemoteToolNames: string[] = [];

    const agent = createAgentWithConfig("assistant-1", {
      system: () => `project_reference=${getEnv("VERYFRONT_PROJECT_SLUG")}`,
      tools: { search_knowledge: true, list_projects: true },
    });

    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: (id) => id === "assistant-1" ? agent : undefined,
      getAllAgentIds: () => ["assistant-1"],
      sessionManager: new AgentRunSessionManager(),
      createRuntime: (runtimeAgent) => ({
        stream: async (_messages, _context, callbacks) => {
          capturedEnv = {
            VERYFRONT_API_TOKEN: getEnv("VERYFRONT_API_TOKEN"),
            VERYFRONT_API_URL: getEnv("VERYFRONT_API_URL"),
            VERYFRONT_PROJECT_SLUG: getEnv("VERYFRONT_PROJECT_SLUG"),
            CUSTOM_PROJECT_ENV: getEnv("CUSTOM_PROJECT_ENV"),
            OTEL_EXPORTER_OTLP_ENDPOINT: getEnv("OTEL_EXPORTER_OTLP_ENDPOINT"),
            OTEL_RESOURCE_ATTRIBUTES: getEnv("OTEL_RESOURCE_ATTRIBUTES"),
          };
          const resolvedSystem = typeof runtimeAgent.config.system === "function"
            ? await runtimeAgent.config.system()
            : runtimeAgent.config.system;
          capturedSystem = typeof resolvedSystem === "string"
            ? resolvedSystem
            : flattenSystemInstructions(resolvedSystem);
          const runtimeConfig = runtimeAgent.config as
            & typeof runtimeAgent.config
            & RuntimeRemoteToolConfig;
          capturedAllowedRemoteTools = runtimeConfig.__vfAllowedRemoteTools;
          capturedRemoteToolNames = (await runtimeConfig.__vfRemoteToolSources?.[0]?.listTools({
            projectId: "proj-1",
          }))?.map((tool) => tool.name) ?? [];
          callbacks?.onFinish?.({
            text: "ok",
            messages: [],
            toolCalls: [],
            status: "completed",
            usage: {
              promptTokens: 1,
              completionTokens: 1,
              totalTokens: 2,
            },
          });

          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.close();
            },
          });
        },
      }),
    });

    const body = createAgentStreamRequestBody({
      project: {
        runtimeTargetKind: "environment",
        runtimeTargetEnvironmentId: "10000000-1000-4000-8000-100000000097",
      },
      agentSource: {
        type: "environment",
        environmentName: "production",
        releaseId: "release-production",
      },
      credentials: { authToken: "request-scoped-user-token" },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      audience: "support-agent-fork",
      requestId: "run_1",
    });
    const ctx = {
      ...createCtx(publicKeyPem),
      proxyToken: "run-scoped-token",
      projectSlug: "support-agent-fork",
    };
    const originalApiUrl = Deno.env.get("VERYFRONT_API_URL");
    const originalApiBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");
    const fetchUrls: string[] = [];
    Deno.env.set("VERYFRONT_API_URL", TEST_PUBLIC_API_ORIGIN);
    Deno.env.delete("VERYFRONT_API_BASE_URL");
    installMockFetch(
      ((url, init) => {
        fetchUrls.push(String(url));
        assertEquals(
          new Headers(observeFetchRequestInit(init).headers).get("authorization"),
          "Bearer request-scoped-user-token",
        );

        if (String(url).endsWith("/projects/support-agent-fork/environments")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                data: [
                  { id: "env-staging", name: "staging", protected: true },
                  {
                    id: "10000000-1000-4000-8000-100000000097",
                    name: "production",
                    protected: false,
                    active_release_id: "release-production",
                  },
                ],
              }),
              { headers: { "content-type": "application/json" } },
            ),
          );
        }

        if (String(url).includes("/projects/support-agent-fork/environment-variables?")) {
          assertEquals(
            String(url).includes(
              "environment_id=10000000-1000-4000-8000-100000000097",
            ),
            true,
          );
          return Promise.resolve(
            new Response(
              JSON.stringify({
                data: [
                  { key: "CUSTOM_PROJECT_ENV", value: "project-value" },
                  { key: "VERYFRONT_API_TOKEN", value: "unsafe-project-token" },
                  { key: "VERYFRONT_API_URL", value: "https://evil.example" },
                  { key: "VERYFRONT_PROJECT_SLUG", value: "wrong-project" },
                  {
                    key: "OTEL_EXPORTER_OTLP_ENDPOINT",
                    value: "https://tenant-collector.example/otlp",
                  },
                  { key: "OTEL_RESOURCE_ATTRIBUTES", value: "tenant.secret=do-not-export" },
                ],
              }),
              { headers: { "content-type": "application/json" } },
            ),
          );
        }

        if (String(url) === `${TEST_PUBLIC_API_ORIGIN}/mcp`) {
          capturedMcpRequest = {
            url: String(url),
            authorization: new Headers(observeFetchRequestInit(init).headers).get("authorization"),
          };
          return Promise.resolve(
            new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id: "veryfront-platform-mcp:tools:list",
                result: {
                  tools: [
                    {
                      name: "search_knowledge",
                      description: "Search knowledge",
                      inputSchema: { type: "object", properties: {} },
                    },
                    {
                      name: "list_projects",
                      description: "List projects",
                      inputSchema: { type: "object", properties: {} },
                    },
                  ],
                },
              }),
              { headers: { "content-type": "application/json" } },
            ),
          );
        }

        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      }) as typeof fetch,
    );

    let result;
    try {
      result = await handler.handle(
        new Request("https://example.com/api/control-plane/runs/run_1/stream", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-veryfront-control-plane-jws": jws,
          },
          body,
        }),
        ctx,
      );
    } finally {
      restoreMockFetch();
      if (originalApiUrl === undefined) Deno.env.delete("VERYFRONT_API_URL");
      else Deno.env.set("VERYFRONT_API_URL", originalApiUrl);
      if (originalApiBaseUrl === undefined) Deno.env.delete("VERYFRONT_API_BASE_URL");
      else Deno.env.set("VERYFRONT_API_BASE_URL", originalApiBaseUrl);
    }

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(capturedEnv, {
      VERYFRONT_API_TOKEN: "request-scoped-user-token",
      VERYFRONT_API_URL: TEST_PUBLIC_API_ORIGIN,
      VERYFRONT_PROJECT_SLUG: "support-agent-fork",
      CUSTOM_PROJECT_ENV: "project-value",
      OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
      OTEL_RESOURCE_ATTRIBUTES: undefined,
    });
    assertStringIncludes(capturedSystem ?? "", "project_reference=support-agent-fork");
    assertStringIncludes(capturedSystem ?? "", '<project_context>\nproject_reference: "proj-1"');
    assertEquals(capturedMcpRequest, {
      url: `${TEST_PUBLIC_API_ORIGIN}/mcp`,
      authorization: "Bearer request-scoped-user-token",
    });
    assertEquals(capturedAllowedRemoteTools, ["list_projects", "search_knowledge"]);
    assertEquals(capturedRemoteToolNames, ["search_knowledge", "list_projects"]);
    // The environment is resolved before the source config is evaluated, so
    // both the config and the MCP tool headers see the same variables.
    assertEquals(fetchUrls, [
      `${TEST_PUBLIC_API_ORIGIN}/projects/support-agent-fork/environments`,
      `${TEST_PUBLIC_API_ORIGIN}/projects/support-agent-fork/environment-variables?environment_id=10000000-1000-4000-8000-100000000097&limit=100`,
      `${TEST_PUBLIC_API_ORIGIN}/mcp`,
    ]);
  });

  it("uses the validated runtime target environment without production discovery", async () => {
    const targetEnvironmentId = "10000000-1000-4000-8000-100000000088";
    let capturedProjectEnv: string | undefined;
    const fetchUrls: string[] = [];
    const originalApiUrl = Deno.env.get("VERYFRONT_API_URL");
    const originalApiBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");

    Deno.env.set("VERYFRONT_API_URL", "https://api.veryfront.org");
    Deno.env.delete("VERYFRONT_API_BASE_URL");
    installMockFetch(
      ((url, init) => {
        const urlString = String(url);
        fetchUrls.push(urlString);
        assertEquals(
          new Headers(observeFetchRequestInit(init).headers).get("authorization"),
          "Bearer request-scoped-user-token",
        );
        if (urlString === "https://api.veryfront.org/projects/demo-project/environments") {
          return Promise.resolve(Response.json({
            data: [{
              id: targetEnvironmentId,
              name: "staging",
              active_release_id: "release-staging",
            }],
          }));
        }
        assertEquals(
          urlString,
          `https://api.veryfront.org/projects/demo-project/environment-variables?environment_id=${targetEnvironmentId}&limit=100`,
        );
        return Promise.resolve(
          new Response(
            JSON.stringify({ data: [{ key: "TARGET_ENV_VALUE", value: "staging-value" }] }),
            { headers: { "content-type": "application/json" } },
          ),
        );
      }) as typeof fetch,
    );

    const agent = createAgentWithConfig("assistant-1", {
      system: () => `target=${getEnv("TARGET_ENV_VALUE")}`,
    });
    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: (id) => id === "assistant-1" ? agent : undefined,
      getAllAgentIds: () => ["assistant-1"],
      sessionManager: new AgentRunSessionManager(),
      createRuntime: (runtimeAgent) => ({
        stream: async (_messages, _context, callbacks) => {
          const resolvedSystem = typeof runtimeAgent.config.system === "function"
            ? await runtimeAgent.config.system()
            : runtimeAgent.config.system;
          capturedProjectEnv = typeof resolvedSystem === "string"
            ? resolvedSystem
            : flattenSystemInstructions(resolvedSystem);
          callbacks?.onFinish?.({
            text: "ok",
            messages: [],
            toolCalls: [],
            status: "completed",
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          });
          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.close();
            },
          });
        },
      }),
    });

    const body = createAgentStreamRequestBody({
      project: {
        runtimeTargetKind: "environment",
        runtimeTargetEnvironmentId: targetEnvironmentId,
      },
      agentSource: {
        type: "environment",
        environmentName: "staging",
        releaseId: "release-staging",
      },
      credentials: { authToken: "request-scoped-user-token" },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "run_1",
    });

    let result;
    try {
      result = await handler.handle(
        new Request("https://example.com/api/control-plane/runs/run_1/stream", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-veryfront-control-plane-jws": jws,
          },
          body,
        }),
        {
          ...createCtx(publicKeyPem),
          environmentId: "20000000-2000-4000-8000-200000000099",
        },
      );
    } finally {
      restoreMockFetch();
      if (originalApiUrl === undefined) Deno.env.delete("VERYFRONT_API_URL");
      else Deno.env.set("VERYFRONT_API_URL", originalApiUrl);
      if (originalApiBaseUrl === undefined) Deno.env.delete("VERYFRONT_API_BASE_URL");
      else Deno.env.set("VERYFRONT_API_BASE_URL", originalApiBaseUrl);
    }

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertStringIncludes(capturedProjectEnv ?? "", "target=staging-value");
    assertEquals(fetchUrls, [
      "https://api.veryfront.org/projects/demo-project/environments",
      `https://api.veryfront.org/projects/demo-project/environment-variables?environment_id=${targetEnvironmentId}&limit=100`,
    ]);
  });

  it("prefers VERYFRONT_API_BASE_URL over VERYFRONT_API_URL", async () => {
    const apiBaseUrl = "http://93.184.216.34:8080";
    const canonicalApiOrigin = new URL(apiBaseUrl).origin;
    let capturedEnv: Record<string, string | undefined> | null = null;
    let capturedSystem: string | null = null;

    const agent = createAgentWithConfig("assistant-1", {
      system: () => `api=${getEnv("VERYFRONT_API_URL")}`,
      tools: { list_projects: true },
    });

    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: (id) => id === "assistant-1" ? agent : undefined,
      getAllAgentIds: () => ["assistant-1"],
      sessionManager: new AgentRunSessionManager(),
      createRuntime: (runtimeAgent) => ({
        stream: async (_messages, _context, callbacks) => {
          capturedEnv = {
            VERYFRONT_API_TOKEN: getEnv("VERYFRONT_API_TOKEN"),
            VERYFRONT_API_URL: getEnv("VERYFRONT_API_URL"),
            VERYFRONT_PROJECT_SLUG: getEnv("VERYFRONT_PROJECT_SLUG"),
            CUSTOM_PROJECT_ENV: getEnv("CUSTOM_PROJECT_ENV"),
          };
          const resolvedSystem = typeof runtimeAgent.config.system === "function"
            ? await runtimeAgent.config.system()
            : runtimeAgent.config.system;
          capturedSystem = typeof resolvedSystem === "string"
            ? resolvedSystem
            : flattenSystemInstructions(resolvedSystem);
          callbacks?.onFinish?.({
            text: "ok",
            messages: [],
            toolCalls: [],
            status: "completed",
            usage: {
              promptTokens: 1,
              completionTokens: 1,
              totalTokens: 2,
            },
          });

          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.close();
            },
          });
        },
      }),
    });

    const body = createAgentStreamRequestBody({
      project: {
        runtimeTargetKind: "environment",
        runtimeTargetEnvironmentId: "10000000-1000-4000-8000-100000000096",
      },
      agentSource: {
        type: "environment",
        environmentName: "production",
        releaseId: "release-production",
      },
      credentials: { authToken: "request-scoped-user-token" },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      audience: "base-url-agent-fork",
      requestId: "run_1",
    });
    const ctx = {
      ...createCtx(publicKeyPem),
      proxyToken: "run-scoped-token",
      projectSlug: "base-url-agent-fork",
    };
    const originalApiUrl = Deno.env.get("VERYFRONT_API_URL");
    const originalApiBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");
    const fetchUrls: string[] = [];
    Deno.env.set("VERYFRONT_API_URL", "https://1.1.1.1/unused-fallback");
    Deno.env.set("VERYFRONT_API_BASE_URL", apiBaseUrl);
    installMockFetch(
      ((url, init) => {
        fetchUrls.push(String(url));
        assertEquals(
          new Headers(observeFetchRequestInit(init).headers).get("authorization"),
          "Bearer request-scoped-user-token",
        );

        if (String(url) === `${canonicalApiOrigin}/mcp`) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id: "veryfront-platform-mcp:tools:list",
                result: {
                  tools: [
                    {
                      name: "list_projects",
                      description: "List projects",
                      inputSchema: { type: "object", properties: {} },
                    },
                  ],
                },
              }),
              { headers: { "content-type": "application/json" } },
            ),
          );
        }

        if (String(url) === `${canonicalApiOrigin}/projects/base-url-agent-fork/environments`) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                data: [
                  {
                    id: "10000000-1000-4000-8000-100000000096",
                    name: "production",
                    protected: false,
                    active_release_id: "release-production",
                  },
                ],
              }),
              { headers: { "content-type": "application/json" } },
            ),
          );
        }

        if (
          String(url).includes(`${apiBaseUrl}/projects/base-url-agent-fork/environment-variables?`)
        ) {
          assertEquals(
            String(url).includes(
              "environment_id=10000000-1000-4000-8000-100000000096",
            ),
            true,
          );
          return Promise.resolve(
            new Response(
              JSON.stringify({
                data: [{ key: "CUSTOM_PROJECT_ENV", value: "project-value-from-base-url" }],
              }),
              { headers: { "content-type": "application/json" } },
            ),
          );
        }

        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      }) as typeof fetch,
    );

    let result;
    try {
      result = await handler.handle(
        new Request("https://example.com/api/control-plane/runs/run_1/stream", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-veryfront-control-plane-jws": jws,
          },
          body,
        }),
        ctx,
      );
    } finally {
      restoreMockFetch();
      if (originalApiUrl === undefined) Deno.env.delete("VERYFRONT_API_URL");
      else Deno.env.set("VERYFRONT_API_URL", originalApiUrl);
      if (originalApiBaseUrl === undefined) Deno.env.delete("VERYFRONT_API_BASE_URL");
      else Deno.env.set("VERYFRONT_API_BASE_URL", originalApiBaseUrl);
    }

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(capturedEnv, {
      VERYFRONT_API_TOKEN: "request-scoped-user-token",
      VERYFRONT_API_URL: apiBaseUrl,
      VERYFRONT_PROJECT_SLUG: "base-url-agent-fork",
      CUSTOM_PROJECT_ENV: "project-value-from-base-url",
    });
    assertStringIncludes(capturedSystem ?? "", `api=${apiBaseUrl}`);
    assertEquals(fetchUrls, [
      `${canonicalApiOrigin}/projects/base-url-agent-fork/environments`,
      `${apiBaseUrl}/projects/base-url-agent-fork/environment-variables?environment_id=10000000-1000-4000-8000-100000000096&limit=100`,
      `${canonicalApiOrigin}/mcp`,
    ]);
  });

  it("rejects oversized internal agent stream payloads before parsing", async () => {
    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: () => createAgent("assistant-1"),
      getAllAgentIds: () => ["assistant-1"],
      sessionManager: new AgentRunSessionManager(),
    });

    const body = createAgentStreamRequestBody({
      context: [{ type: "text", text: "x".repeat(DEFAULT_MAX_BODY_SIZE_BYTES + 1024) }],
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 413);
    assertEquals(await result.response.json(), { error: "Payload too large" });
  });

  it("returns 404 when the requested agent is not available", async () => {
    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: () => undefined,
      getAllAgentIds: () => [],
      sessionManager: new AgentRunSessionManager(),
    });

    const body = createAgentStreamRequestBody();
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 404);
    assertEquals(await result.response.json(), { error: "Agent not found" });
  });

  it("returns 400 for malformed internal agent stream payloads", async () => {
    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: () => createAgent("assistant-1"),
      getAllAgentIds: () => ["assistant-1"],
      sessionManager: new AgentRunSessionManager(),
    });

    const body = '{"agentId":"assistant-1"';
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 400);
    assertEquals(await result.response.json(), { error: "Invalid internal agent stream request" });
  });

  it("rejects a stream URL whose run id differs from the signed payload runId", async () => {
    let discoveryCalls = 0;
    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls++;
        return createEmptyDiscoveryResult();
      },
      getAgent: () => createAgent("assistant-1"),
      getAllAgentIds: () => ["assistant-1"],
      sessionManager: new AgentRunSessionManager(),
    });

    const body = createAgentStreamRequestBody();
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_2/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 400, "a stream URL must match the signed runId");
    assertEquals(await result.response.json(), { error: "CONTROL_PLANE_RUN_ID_MISMATCH" });
    assertEquals(
      discoveryCalls,
      0,
      "a run-id mismatch must be rejected before any project discovery side effect",
    );
  });

  it("returns 400 when the runtime input exceeds the message limit", async () => {
    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: () => createAgent("assistant-1"),
      getAllAgentIds: () => ["assistant-1"],
      sessionManager: new AgentRunSessionManager(),
    });

    const body = createAgentStreamRequestBody({
      messages: Array.from({ length: 101 }, (_, index) => ({
        id: `msg_${index}`,
        role: "user",
        parts: [{ type: "text", text: "hello" }],
      })),
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 400);
    assertEquals(await result.response.json(), { error: "Invalid internal agent stream request" });
  });

  it("accepts generic control-plane tool names like invoke_agent", async () => {
    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: (id) => id === "assistant-1" ? createAgent("assistant-1") : undefined,
      getAllAgentIds: () => ["assistant-1"],
      sessionManager: new AgentRunSessionManager(),
      createRuntime: () => ({
        stream: async (_messages, _context, callbacks) => {
          callbacks?.onFinish?.({
            text: "delegated",
            messages: [],
            toolCalls: [],
            status: "completed",
            usage: {
              promptTokens: 5,
              completionTokens: 2,
              totalTokens: 7,
            },
            metadata: {
              finishReason: "stop",
            },
          });

          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encodeDataStreamEvent({ type: "message-start", messageId: "assistant-msg-1" }),
              );
              controller.enqueue(encodeDataStreamEvent({ type: "text-start", id: "text-1" }));
              controller.enqueue(
                encodeDataStreamEvent({
                  type: "text-delta",
                  id: "text-1",
                  delta: "delegated",
                }),
              );
              controller.enqueue(encodeDataStreamEvent({ type: "text-end", id: "text-1" }));
              controller.close();
            },
          });
        },
      }),
    });

    const body = createAgentStreamRequestBody({
      tools: [{ name: "invoke_agent" }],
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);

    const text = await result.response.text();
    assertStringIncludes(text, "event: RunStarted");
    assertStringIncludes(text, "event: TextMessageContent");
    assertStringIncludes(text, "event: RunFinished");
  });

  it("uses the verified request credential for the exact agent source context", async () => {
    let observedCacheCredential:
      | ReturnType<typeof getVerifiedCacheApiCredential>
      | undefined;
    const runWithContextCalls: Array<{
      token?: string;
      productionMode?: boolean;
      releaseId?: string | null;
      branch?: string | null;
      environmentName?: string | null;
    }> = [];
    let observedEnvironmentTarget:
      | {
        environmentName: string;
        environmentId: string | null;
        token: string;
      }
      | undefined;

    const handler = createTestAgentStreamHandler({
      loadAgentSourceEnvironment: (_ctx, source, target, token) => {
        observedEnvironmentTarget = {
          environmentName: source.type === "environment" ? source.environmentName : source.type,
          environmentId: target.runtimeTargetEnvironmentId ?? null,
          token,
        };
        return Promise.resolve({});
      },
      ensureProjectDiscovery: async () => {
        observedCacheCredential = getVerifiedCacheApiCredential();
        return createEmptyDiscoveryResult();
      },
      getAgent: (id) => id === "assistant-1" ? createAgent("assistant-1") : undefined,
      getAllAgentIds: () => ["assistant-1"],
      sessionManager: new AgentRunSessionManager(),
      createRuntime: () => ({
        stream: async (_messages, _context, callbacks) => {
          callbacks?.onFinish?.({
            text: "resolved from main",
            messages: [],
            toolCalls: [],
            status: "completed",
            usage: {
              promptTokens: 5,
              completionTokens: 3,
              totalTokens: 8,
            },
            metadata: {
              finishReason: "stop",
            },
          });

          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encodeDataStreamEvent({ type: "message-start", messageId: "assistant-msg-1" }),
              );
              controller.enqueue(encodeDataStreamEvent({ type: "text-start", id: "text-1" }));
              controller.enqueue(
                encodeDataStreamEvent({
                  type: "text-delta",
                  id: "text-1",
                  delta: "resolved from main",
                }),
              );
              controller.enqueue(encodeDataStreamEvent({ type: "text-end", id: "text-1" }));
              controller.close();
            },
          });
        },
      }),
    });

    const body = createAgentStreamRequestBody({
      project: {
        runtimeTargetKind: "environment",
        runtimeTargetEnvironmentId: "10000000-1000-4000-8000-100000000098",
      },
      agentSource: {
        type: "environment",
        environmentName: "staging",
        releaseId: "10000000-1000-4000-8000-100000000099",
      },
      credentials: { authToken: "request-scoped-user-token" },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });
    const ctx = createCtx(publicKeyPem);
    ctx.adapter = {
      ...ctx.adapter,
      env: createNoopEnvAdapter(publicKeyPem),
      fs: createNoopFsAdapter(runWithContextCalls),
    };

    const originalHostToken = Deno.env.get("VERYFRONT_API_TOKEN");
    const signingKeyEnv = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
    const originalSigningKey = Deno.env.get(signingKeyEnv);
    Deno.env.set("VERYFRONT_API_TOKEN", "expired-host-token");
    Deno.env.set(signingKeyEnv, publicKeyPem);
    let result;
    try {
      result = await handler.handle(
        new Request("https://example.com/api/control-plane/runs/run_1/stream", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-veryfront-control-plane-jws": jws,
          },
          body,
        }),
        ctx,
      );
    } finally {
      if (originalHostToken === undefined) Deno.env.delete("VERYFRONT_API_TOKEN");
      else Deno.env.set("VERYFRONT_API_TOKEN", originalHostToken);
      if (originalSigningKey === undefined) Deno.env.delete(signingKeyEnv);
      else Deno.env.set(signingKeyEnv, originalSigningKey);
    }

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(runWithContextCalls.length, 1);
    assertEquals(runWithContextCalls[0]?.token, "request-scoped-user-token");
    assertEquals(runWithContextCalls[0]?.environmentName, "staging");
    assertEquals(runWithContextCalls[0]?.releaseId, "10000000-1000-4000-8000-100000000099");
    assertEquals(runWithContextCalls[0]?.productionMode, true);
    assertEquals(observedEnvironmentTarget, {
      environmentName: "staging",
      environmentId: "10000000-1000-4000-8000-100000000098",
      token: "request-scoped-user-token",
    });
    assertEquals(observedCacheCredential, {
      token: "request-scoped-user-token",
      projectId: "proj-1",
      projectSlug: "demo-project",
    });
    assertEquals(getVerifiedCacheApiCredential(), undefined);
  });

  it("does not promote an unsigned header fallback into the verified cache scope", async () => {
    let observedCacheCredential:
      | ReturnType<typeof getVerifiedCacheApiCredential>
      | undefined;
    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => {
        observedCacheCredential = getVerifiedCacheApiCredential();
        return createEmptyDiscoveryResult();
      },
      getAgent: () => undefined,
      getAllAgentIds: () => [],
      sessionManager: new AgentRunSessionManager(),
      createRuntime: () => {
        throw new Error("runtime should not be created for an unknown agent");
      },
    });
    const body = createAgentStreamRequestBody();
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "run_1",
    });
    const ctx = createCtx(publicKeyPem);
    ctx.proxyToken = "unsigned-header-token";
    const signingKeyEnv = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
    const originalSigningKey = Deno.env.get(signingKeyEnv);
    Deno.env.set(signingKeyEnv, publicKeyPem);

    let result;
    try {
      result = await handler.handle(
        new Request("https://example.com/api/control-plane/runs/run_1/stream", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-veryfront-control-plane-jws": jws,
          },
          body,
        }),
        ctx,
      );
    } finally {
      if (originalSigningKey === undefined) Deno.env.delete(signingKeyEnv);
      else Deno.env.set(signingKeyEnv, originalSigningKey);
    }

    assertExists(result.response);
    assertEquals(result.response.status, 404);
    assertEquals(observedCacheCredential, undefined);
    assertEquals(getVerifiedCacheApiCredential(), undefined);
  });

  it("does not fall back to the host token for a signed exact environment source", async () => {
    let environmentLoadCalls = 0;
    const runWithContextCalls: Array<{
      token?: string;
      productionMode?: boolean;
      releaseId?: string | null;
      branch?: string | null;
      environmentName?: string | null;
    }> = [];

    const handler = createTestAgentStreamHandler({
      loadAgentSourceEnvironment: () => {
        environmentLoadCalls += 1;
        return Promise.resolve({});
      },
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: (id) => id === "assistant-1" ? createAgent("assistant-1") : undefined,
      getAllAgentIds: () => ["assistant-1"],
      sessionManager: new AgentRunSessionManager(),
      createRuntime: () => {
        throw new Error("runtime should not be created before env lookup");
      },
    });

    const body = createAgentStreamRequestBody({
      project: {
        runtimeTargetKind: "environment",
        runtimeTargetEnvironmentId: "10000000-1000-4000-8000-100000000098",
      },
      agentSource: {
        type: "environment",
        environmentName: "staging",
        releaseId: "10000000-1000-4000-8000-100000000099",
      },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });
    const ctx = createCtx(publicKeyPem);
    ctx.proxyToken = undefined;
    ctx.adapter = {
      ...ctx.adapter,
      env: createNoopEnvAdapter(publicKeyPem),
      fs: createNoopFsAdapter(runWithContextCalls),
    };

    const originalHostToken = Deno.env.get("VERYFRONT_API_TOKEN");
    const signingKeyEnv = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
    const originalSigningKey = Deno.env.get(signingKeyEnv);
    Deno.env.set("VERYFRONT_API_TOKEN", "host-only-token");
    Deno.env.set(signingKeyEnv, publicKeyPem);
    let result;
    try {
      result = await handler.handle(
        new Request("https://example.com/api/control-plane/runs/run_1/stream", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-veryfront-control-plane-jws": jws,
          },
          body,
        }),
        ctx,
      );
    } finally {
      if (originalHostToken === undefined) Deno.env.delete("VERYFRONT_API_TOKEN");
      else Deno.env.set("VERYFRONT_API_TOKEN", originalHostToken);
      if (originalSigningKey === undefined) Deno.env.delete(signingKeyEnv);
      else Deno.env.set(signingKeyEnv, originalSigningKey);
    }

    assertExists(result.response);
    assertEquals(result.response.status, 401);
    assertEquals(runWithContextCalls.length, 0);
    assertEquals(environmentLoadCalls, 0);
  });

  it("returns 409 when the same run is started twice", async () => {
    const sessionManager = new AgentRunSessionManager();
    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: (id) => id === "assistant-1" ? createAgent("assistant-1") : undefined,
      getAllAgentIds: () => ["assistant-1"],
      sessionManager,
      createRuntime: () => ({
        stream: async () =>
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encodeDataStreamEvent({ type: "message-start", messageId: "assistant-msg-1" }),
              );
            },
          }),
      }),
    });

    const body = createAgentStreamRequestBody();
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });
    const request = new Request("https://example.com/api/control-plane/runs/run_1/stream", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-veryfront-control-plane-jws": jws,
      },
      body,
    });

    const firstResult = await handler.handle(request.clone(), createCtx(publicKeyPem));
    assertExists(firstResult.response);
    assertEquals(firstResult.response.status, 200);

    try {
      const secondResult = await handler.handle(request, createCtx(publicKeyPem));
      assertExists(secondResult.response);
      assertEquals(secondResult.response.status, 409);
      assertEquals(await secondResult.response.json(), { error: 'Run "run_1" is already active' });
    } finally {
      await firstResult.response.body?.cancel();
    }
  });

  it("returns 500 when runtime execution setup fails unexpectedly", async () => {
    const sessionManager = new AgentRunSessionManager();
    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: (id) => id === "assistant-1" ? createAgent("assistant-1") : undefined,
      getAllAgentIds: () => ["assistant-1"],
      sessionManager,
      createRuntime: () => {
        throw new Error("runtime boom");
      },
    });

    const body = createAgentStreamRequestBody();
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 500);
    assertEquals(await result.response.json(), { error: "Internal agent stream failed" });
    assertEquals(sessionManager.getRunStatus("run_1"), null);
  });

  it("fails closed with typed authorization semantics when named env lookup is denied", async () => {
    let discoveryCalls = 0;
    let redirect: RequestRedirect | undefined;
    installMockFetch(
      ((_input, init) => {
        redirect = observeFetchRequestInit(init).redirect;
        return Promise.resolve(new Response(null, { status: 403 }));
      }) as typeof fetch,
    );
    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls += 1;
        return createEmptyDiscoveryResult();
      },
      getAgent: () => undefined,
      getAllAgentIds: () => [],
      sessionManager: new AgentRunSessionManager(),
    });
    const body = createAgentStreamRequestBody({
      project: {
        runtimeTargetKind: "environment",
        runtimeTargetEnvironmentId: "10000000-1000-4000-8000-100000000098",
      },
      agentSource: {
        type: "environment",
        environmentName: "staging",
        releaseId: "10000000-1000-4000-8000-100000000099",
      },
      credentials: { authToken: "denied-project-token" },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "run_1",
    });

    try {
      const result = await handler.handle(
        new Request("https://example.com/api/control-plane/runs/run_1/stream", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-veryfront-control-plane-jws": jws,
          },
          body,
        }),
        createCtx(publicKeyPem),
      );

      assertExists(result.response);
      assertEquals(result.response.status, 403);
      assertEquals(result.response.headers.get("content-type"), "application/problem+json");
      assertEquals(
        (await result.response.json()).type,
        "https://veryfront.com/docs/code/guides/errors#permission-denied",
      );
      assertEquals(discoveryCalls, 0);
      assertEquals(redirect, "error");
    } finally {
      restoreMockFetch();
    }
  });

  it("rejects a stale named environment source before loading project secrets", async () => {
    let discoveryCalls = 0;
    let environmentVariableCalls = 0;
    installMockFetch(
      ((input) => {
        const url = String(input);
        if (url.endsWith("/projects/support-agent-fork/environments")) {
          return Promise.resolve(Response.json({
            data: [{
              id: "10000000-1000-4000-8000-100000000098",
              name: "staging",
              active_release_id: "release-new",
            }],
          }));
        }
        if (url.includes("/environment-variables?")) {
          environmentVariableCalls += 1;
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      }) as typeof fetch,
    );
    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls += 1;
        return createEmptyDiscoveryResult();
      },
      getAgent: () => undefined,
      getAllAgentIds: () => [],
      sessionManager: new AgentRunSessionManager(),
    });
    const body = createAgentStreamRequestBody({
      project: {
        runtimeTargetKind: "environment",
        runtimeTargetEnvironmentId: "10000000-1000-4000-8000-100000000098",
      },
      agentSource: {
        type: "environment",
        environmentName: "staging",
        releaseId: "release-old",
      },
      credentials: { authToken: "project-token" },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      audience: "support-agent-fork",
      requestId: "run_1",
    });

    try {
      const result = await handler.handle(
        new Request("https://example.com/api/control-plane/runs/run_1/stream", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-veryfront-control-plane-jws": jws,
          },
          body,
        }),
        { ...createCtx(publicKeyPem), projectSlug: "support-agent-fork" },
      );

      assertExists(result.response);
      assertEquals(result.response.status, 403);
      assertEquals(result.response.headers.get("content-type"), "application/problem+json");
      assertEquals(environmentVariableCalls, 0);
      assertEquals(discoveryCalls, 0);
    } finally {
      restoreMockFetch();
    }
  });

  it("does not discover or inject production secrets for a branch source", async () => {
    let fetchCalls = 0;
    installMockFetch(
      (() => {
        fetchCalls += 1;
        return Promise.reject(new Error("branch source must not fetch an environment"));
      }) as typeof fetch,
    );
    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: () => undefined,
      getAllAgentIds: () => [],
      sessionManager: new AgentRunSessionManager(),
    });
    const body = createAgentStreamRequestBody({
      credentials: { authToken: "branch-project-token" },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "run_1",
    });

    try {
      const result = await handler.handle(
        new Request("https://example.com/api/control-plane/runs/run_1/stream", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-veryfront-control-plane-jws": jws,
          },
          body,
        }),
        createCtx(publicKeyPem),
      );

      assertExists(result.response);
      assertEquals(result.response.status, 404);
      assertEquals(fetchCalls, 0);
    } finally {
      restoreMockFetch();
    }
  });

  it("emits a cancellation error instead of finishing after an abort during a pending read", async () => {
    const sessionManager = new TrackingSessionManager();
    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: (id) => id === "assistant-1" ? createAgent("assistant-1") : undefined,
      getAllAgentIds: () => ["assistant-1"],
      sessionManager,
      createRuntime: () => ({
        stream: async () =>
          new ReadableStream<Uint8Array>({
            cancel() {
              return Promise.resolve();
            },
          }),
      }),
    });

    const body = createAgentStreamRequestBody();
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertExists(result.response.body);

    const reader = result.response.body.getReader();
    let text = await readUntil(reader, (chunk) => chunk.includes("event: RunStarted"));

    assertEquals(sessionManager.cancelRun("run_1"), true);

    text += await readRemainingText(reader);

    assertStringIncludes(text, "event: RunError");
    assertStringIncludes(text, '"code":"CANCELLED"');
    assertEquals(text.includes("event: RunFinished"), false);
    assertEquals(sessionManager.stats.completeCalls, 0);
    assertEquals(sessionManager.stats.failCalls, 0);
  });

  it("keeps a waiting run resumable after the client disconnects", async () => {
    const sessionManager = new TrackingSessionManager();
    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: (id) => id === "assistant-1" ? createAgent("assistant-1") : undefined,
      getAllAgentIds: () => ["assistant-1"],
      sessionManager,
      createRuntime: createInjectedToolRuntime(
        "studio_focus_component",
        "tool-1",
        { focused: true },
      ),
    });
    const resumeHandler = new AgentRunResumeHandler(sessionManager);

    const body = createAgentStreamRequestBody();
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertExists(result.response.body);

    const reader = result.response.body.getReader();
    await readUntil(reader, (chunk) => chunk.includes("event: ToolCallEnd"));
    await reader.cancel();

    for (
      let attempt = 0;
      attempt < 20 && sessionManager.getRunStatus("run_1") !== "waiting";
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    assertEquals(sessionManager.getRunStatus("run_1"), "waiting");
    assertEquals(sessionManager.stats.cancelCalls, 0);

    const resumeBody = JSON.stringify({
      type: "tool_result",
      toolCallId: "tool-1",
      result: { focused: true },
    });
    const resumeSignature = await createControlPlaneSignature(resumeBody, {
      requestId: "run_1",
      requestMethod: "POST",
      requestPath: "/api/control-plane/runs/run_1/resume",
    });

    const resumeResult = await resumeHandler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/resume", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": resumeSignature.jws,
        },
        body: resumeBody,
      }),
      createCtx(resumeSignature.publicKeyPem),
    );

    assertExists(resumeResult.response);
    assertEquals(resumeResult.response.status, 200);

    for (
      let attempt = 0;
      attempt < 20 && sessionManager.getRunStatus("run_1") !== null;
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    assertEquals(sessionManager.getRunStatus("run_1"), null);
    assertEquals(sessionManager.stats.completeCalls, 1);
    assertEquals(sessionManager.stats.cancelCalls, 0);
    assertEquals(sessionManager.stats.failCalls, 0);
  });

  it("accepts an early resume before the runtime registers the tool wait", async () => {
    const sessionManager = new TrackingSessionManager();
    const resumeHandler = new AgentRunResumeHandler(sessionManager);
    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: (id) => id === "assistant-1" ? createAgent("assistant-1") : undefined,
      getAllAgentIds: () => ["assistant-1"],
      sessionManager,
      createRuntime: (_agent, mergedTools) => ({
        async stream(_messages, _context, callbacks) {
          const tool = mergedTools && mergedTools !== true
            ? mergedTools["studio_focus_component"] as {
              execute: (input: unknown, context?: unknown) => Promise<unknown>;
            }
            : undefined;
          if (!tool) {
            throw new Error("Expected injected tool");
          }

          return new ReadableStream<Uint8Array>({
            async start(controller) {
              controller.enqueue(
                encodeDataStreamEvent({ type: "message-start", messageId: "assistant-1" }),
              );
              controller.enqueue(encodeDataStreamEvent({ type: "text-start", id: "assistant-1" }));
              controller.enqueue(encodeDataStreamEvent({
                type: "tool-input-start",
                toolCallId: "tool-1",
                toolName: "studio_focus_component",
              }));
              controller.enqueue(encodeDataStreamEvent({
                type: "tool-input-available",
                toolCallId: "tool-1",
                toolName: "studio_focus_component",
                input: { target: "hero" },
              }));

              await new Promise((resolve) => setTimeout(resolve, 0));

              const output = await tool.execute(
                { target: "hero" },
                { toolCallId: "tool-1" },
              );

              controller.enqueue(encodeDataStreamEvent({
                type: "tool-output-available",
                toolCallId: "tool-1",
                output,
              }));
              controller.enqueue(encodeDataStreamEvent({
                type: "text-delta",
                id: "assistant-1",
                delta: "Done.",
              }));
              controller.enqueue(encodeDataStreamEvent({ type: "text-end", id: "assistant-1" }));
              controller.close();

              callbacks?.onFinish?.({
                text: "Done.",
                messages: [],
                toolCalls: [],
                status: "completed",
                usage: {
                  promptTokens: 5,
                  completionTokens: 3,
                  totalTokens: 8,
                },
                metadata: {
                  finishReason: "stop",
                },
              });
            },
          });
        },
      }),
    });

    const body = createAgentStreamRequestBody();
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertExists(result.response.body);

    const reader = result.response.body.getReader();
    const initialText = await readUntil(reader, (chunk) => chunk.includes("event: ToolCallEnd"));
    assertEquals(sessionManager.getRunStatus("run_1"), "running");
    assertStringIncludes(initialText, "event: ToolCallStart");

    const resumeBody = JSON.stringify({
      type: "tool_result",
      toolCallId: "tool-1",
      result: { focused: true },
    });
    const resumeSignature = await createControlPlaneSignature(resumeBody, {
      requestId: "run_1",
      requestMethod: "POST",
      requestPath: "/api/control-plane/runs/run_1/resume",
    });

    const resumeResult = await resumeHandler.handle(
      new Request("https://example.com/api/control-plane/runs/run_1/resume", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": resumeSignature.jws,
        },
        body: resumeBody,
      }),
      createCtx(resumeSignature.publicKeyPem),
    );

    assertExists(resumeResult.response);
    assertEquals(resumeResult.response.status, 200);
    assertEquals(await resumeResult.response.json(), { accepted: true });

    const finalText = initialText + await readRemainingText(reader);
    assertStringIncludes(finalText, "event: ToolCallResult");
    assertStringIncludes(finalText, "event: RunFinished");
    assertEquals(sessionManager.getRunStatus("run_1"), null);
    assertEquals(sessionManager.stats.completeCalls, 1);
    assertEquals(sessionManager.stats.cancelCalls, 0);
    assertEquals(sessionManager.stats.failCalls, 0);
  });

  it("rejects new agent stream requests with 503 while the runtime is shutting down", async () => {
    let discoveryCalls = 0;
    let resolveOwnerCalls = 0;
    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls += 1;
        return createEmptyDiscoveryResult();
      },
      getAgent: (id) => id === "assistant-1" ? createAgent("assistant-1") : undefined,
      getAllAgentIds: () => ["assistant-1"],
      sessionManager: new AgentRunSessionManager(),
      resolveRuntimeOwnerInvokeUrl: async () => {
        resolveOwnerCalls += 1;
        return "http://10.0.0.7:20000/channels/invoke";
      },
      createRuntime: () => ({
        stream: async () =>
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.close();
            },
          }),
      }),
    });

    const body = createAgentStreamRequestBody();
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    markServerShuttingDown();
    try {
      const result = await handler.handle(
        new Request("https://example.com/api/control-plane/runs/run_1/stream", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-veryfront-control-plane-jws": jws,
          },
          body,
        }),
        createCtx(publicKeyPem),
      );

      assertExists(result.response);
      assertEquals(result.response.status, 503);
      assertEquals(result.response.headers.get("connection"), "close");
      assertEquals(
        result.response.headers.get("x-veryfront-runtime-owner-invoke-url"),
        null,
      );
      const responseBody = await result.response.json();
      assertEquals(responseBody.code, "RUNTIME_SHUTTING_DOWN");
      assertEquals(typeof responseBody.message, "string");
      // Rejection must happen before discovery / runtime-owner resolution.
      assertEquals(discoveryCalls, 0);
      assertEquals(resolveOwnerCalls, 0);
    } finally {
      __resetServerShuttingDownForTests();
    }
  });
});

describe("agent stream handler 5xx logging", () => {
  it("logs slug, category, detail and cause for a 5xx VeryfrontError", async () => {
    const entries: LogEntry[] = [];
    const previousLogLevel = Deno.env.get("LOG_LEVEL");
    const detail = "Agent service context has not been initialized.";
    const thrown = SERVICE_OVERLOADED.create({ detail, cause: "adapter boot failed" });

    try {
      Deno.env.set("LOG_LEVEL", "DEBUG");
      refreshLoggerConfig();
      __registerLogRecordEmitter((entry) => entries.push(entry));

      const handler = createTestAgentStreamHandler({
        ensureProjectDiscovery: () => {
          throw thrown;
        },
        getAgent: () => undefined,
        getAllAgentIds: () => [],
        sessionManager: new AgentRunSessionManager(),
      });

      const body = createAgentStreamRequestBody({
        agentSource: { type: "branch", branch: "main" },
      });
      const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
        requestId: "run_1",
      });

      const result = await handler.handle(
        new Request("https://example.com/api/control-plane/runs/run_1/stream", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-veryfront-control-plane-jws": jws,
          },
          body,
        }),
        createCtx(publicKeyPem),
      );

      assertExists(result.response);
      assertEquals(result.response.status >= 500, true, `got ${result.response.status}`);

      // The caller still must not see the detail.
      const payload = await result.response.json();
      assertEquals(payload.detail, undefined);

      const logged = entries.find(
        (entry) => entry.message === "Internal agent stream request failed",
      );
      assertExists(
        logged,
        `handler did not log; saw: ${entries.map((e) => e.message).join(" | ")}`,
      );
      const serialized = JSON.stringify(logged);
      assertStringIncludes(serialized, detail);
      // cause is typed `unknown` and is frequently a string, not an Error.
      assertStringIncludes(serialized, "adapter boot failed");
      assertStringIncludes(serialized, thrown.slug);
      assertStringIncludes(serialized, thrown.category);
    } finally {
      __resetLogRecordEmitterForTests();
      if (previousLogLevel === undefined) Deno.env.delete("LOG_LEVEL");
      else Deno.env.set("LOG_LEVEL", previousLogLevel);
      refreshLoggerConfig();
    }
  });
});

describe("agent stream handler application-error reporting", () => {
  async function handleWithStubbedReporter(
    thrown: unknown,
    runIdSegment = "run_1",
  ): Promise<{ captures: CapturedApplicationError[]; response: Response }> {
    const { captures, restore } = stubApplicationErrorReporter();

    try {
      const handler = createTestAgentStreamHandler({
        ensureProjectDiscovery: () => {
          throw thrown;
        },
        getAgent: () => undefined,
        getAllAgentIds: () => [],
        sessionManager: new AgentRunSessionManager(),
      });

      const body = createAgentStreamRequestBody({
        agentSource: { type: "branch", branch: "main" },
      });
      const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
        requestId: "run_1",
      });

      const result = await handler.handle(
        new Request(`https://example.com/api/control-plane/runs/${runIdSegment}/stream`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-veryfront-control-plane-jws": jws,
          },
          body,
        }),
        createCtx(publicKeyPem),
      );

      assertExists(result.response);
      return { captures, response: result.response };
    } finally {
      restore();
    }
  }

  it("reports a 5xx VeryfrontError with context that is actionable without a log dive", async () => {
    const detail = "Remote executable discovery requires an isolated project runtime";
    const thrown = SERVICE_OVERLOADED.create({ detail, cause: "adapter boot failed" });

    const { captures, response } = await handleWithStubbedReporter(thrown);
    await response.body?.cancel();

    assertEquals(response.status, 503);
    // The two branches are mutually exclusive, so a rethrow that
    // double-reports turns this red.
    assertEquals(captures.length, 1);

    const captured = captures[0];
    assertExists(captured);
    assertEquals(captured.error, thrown);
    assertEquals(captured.context.boundary, "agent.stream.request");
    assertEquals(captured.context.method, "POST");
    assertEquals(captured.context.requestId, "run_1");

    const attributes = captured.context.attributes;
    assertExists(attributes);
    assertEquals(attributes["error.slug"], "service-overloaded");
    assertEquals(attributes["error.category"], "SERVER");
    assertEquals(attributes["error.detail"], detail);
    assertEquals(attributes["error.cause"], "adapter boot failed");
    assertEquals(attributes["http.status"], 503);
    assertEquals(attributes["project.id"], "proj-1");
    assertEquals(attributes["project.slug"], "demo-project");
  });

  it("reports and logs a shared environment failure only once across joiners and replays", async () => {
    const entries: LogEntry[] = [];
    const previousLogLevel = Deno.env.get("LOG_LEVEL");
    const failure = NETWORK_ERROR.create({
      detail: "Internal project environment request failed",
    });
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(
      async () => {
        fetchCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        throw failure;
      },
      60_000,
      100,
      { markFailureReplays: true },
    );
    const { captures, restore } = stubApplicationErrorReporter();

    try {
      Deno.env.set("LOG_LEVEL", "DEBUG");
      refreshLoggerConfig();
      __registerLogRecordEmitter((entry) => entries.push(entry));

      const handler = createTestAgentStreamHandler({
        loadAgentSourceEnvironment: () =>
          cache.get({
            projectSlug: "test-project",
            projectId: "10000000-1000-4000-8000-100000000005",
            environmentId: "10000000-1000-4000-8000-100000000098",
            token: "test-token",
          }),
        ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
        getAgent: () => undefined,
        getAllAgentIds: () => [],
        sessionManager: new AgentRunSessionManager(),
      });
      const body = createAgentStreamRequestBody({
        project: {
          runtimeTargetKind: "environment",
          runtimeTargetEnvironmentId: "10000000-1000-4000-8000-100000000098",
        },
        agentSource: {
          type: "environment",
          environmentName: "staging",
          releaseId: "10000000-1000-4000-8000-100000000099",
        },
        credentials: { authToken: "request-scoped-user-token" },
      });
      const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
        requestId: "run_1",
      });

      const handleRequest = async (): Promise<Response> => {
        const result = await handler.handle(
          new Request("https://example.com/api/control-plane/runs/run_1/stream", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-veryfront-control-plane-jws": jws,
            },
            body,
          }),
          createCtx(publicKeyPem),
        );
        assertExists(result.response);
        return result.response;
      };

      const responses = [
        ...await Promise.all([handleRequest(), handleRequest()]),
        await handleRequest(),
      ];

      assertEquals(fetchCount, 1);
      const firstResponse = responses[0];
      const joinedResponse = responses[1];
      const cachedResponse = responses[2];
      assertExists(firstResponse);
      assertExists(joinedResponse);
      assertExists(cachedResponse);
      assertEquals(
        [firstResponse.status, joinedResponse.status, cachedResponse.status],
        [502, 502, 502],
      );
      assertEquals(
        await firstResponse.clone().json(),
        await joinedResponse.clone().json(),
      );
      assertEquals(
        await firstResponse.clone().json(),
        await cachedResponse.clone().json(),
      );
      assertEquals(captures.length, 1);
      assertEquals(
        entries.filter((entry) => entry.message === "Internal agent stream request failed").length,
        1,
      );
      await Promise.all(responses.map((response) => response.body?.cancel()));
    } finally {
      restore();
      __resetLogRecordEmitterForTests();
      if (previousLogLevel === undefined) Deno.env.delete("LOG_LEVEL");
      else Deno.env.set("LOG_LEVEL", previousLogLevel);
      refreshLoggerConfig();
    }
  });

  // A malformed percent escape makes the run-id decode throw. Reporting runs
  // inside the catch, so an unguarded decode would throw past it and destroy
  // the 500 instead of describing it.
  it("still reports and still answers 500 when the run id cannot be decoded", async () => {
    const { captures, response } = await handleWithStubbedReporter(
      new TypeError("unused: the malformed path throws first"),
      "run_%ZZ",
    );
    await response.body?.cancel();

    assertEquals(response.status, 500);
    assertEquals(captures.length, 1);

    const captured = captures[0];
    assertExists(captured);
    assertEquals(captured.context.boundary, "agent.stream.handler");
    assertEquals(captured.context.requestId, undefined);

    const attributes = captured.context.attributes;
    assertExists(attributes);
    assertEquals(attributes["http.status"], 500);
    assertEquals(attributes["project.id"], "proj-1");
  });

  it("stays silent for a 4xx VeryfrontError so Sentry is not flooded", async () => {
    const thrown = INVALID_ARGUMENT.create({
      detail: "Agent source branch is not a known branch",
    });

    const { captures, response } = await handleWithStubbedReporter(thrown);
    await response.body?.cancel();

    assertEquals(response.status, 400);
    assertEquals(captures.length, 0);
  });
});
