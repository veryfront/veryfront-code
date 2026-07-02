import "#veryfront/schemas/_test-setup.ts";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import type { RuntimeRemoteToolConfig } from "#veryfront/agent/runtime/mcp-server-tool-sources.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DEFAULT_MAX_BODY_SIZE_BYTES } from "#veryfront/utils/constants/index.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { AgentRunResumeHandler } from "./agent-run-resume.handler.ts";
import { AgentStreamHandler } from "./agent-stream.handler.ts";
import {
  createAgent,
  createAgentWithConfig,
  createControlPlaneSignature,
  createCtx,
  createInjectedToolRuntime,
  encodeDataStreamEvent,
  readRemainingText,
  readUntil,
} from "./internal-agent-run.test-helpers.ts";
import {
  createAgentStreamRequestBody,
  createNoopEnvAdapter,
  createNoopFsAdapter,
  TrackingSessionManager,
} from "./agent-stream.handler.test-helpers.ts";
import { __resetServerShuttingDownForTests, markServerShuttingDown } from "../../shutdown-state.ts";

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
  it("streams AG-UI events for a valid signed request", async () => {
    let discoveryCalls = 0;
    let streamContext: Record<string, unknown> | undefined;
    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls += 1;
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
    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls += 1;
      },
      getAgent: (id) => id === "assistant-1" ? createAgent("assistant-1") : undefined,
      getAllAgentIds: () => ["assistant-1"],
      sessionManager: new AgentRunSessionManager(),
      createRuntime: () => ({
        stream: async (_messages, context, callbacks) => {
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

    const body = createRuntimeAgentRunInvocationBody();
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

    const text = await result.response.text();
    assertStringIncludes(text, "event: RunStarted");
    assertStringIncludes(text, "event: TextMessageContent");
    assertStringIncludes(text, "event: RunFinished");
  });

  it("accepts the public control-plane stream route", async () => {
    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => {},
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

  it("accepts the canonical runtime AG-UI request shape on the control-plane run stream route", async () => {
    let streamContext: Record<string, unknown> | undefined;

    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => {},
      getAgent: (id) => id === "assistant-1" ? createAgent("assistant-1") : undefined,
      getAllAgentIds: () => ["assistant-1"],
      sessionManager: new AgentRunSessionManager(),
      createRuntime: () => ({
        stream: async (_messages, context, callbacks) => {
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
      }),
    });

    const body = JSON.stringify({
      agentId: "assistant-1",
      threadId: "10000000-1000-4000-8000-100000000001",
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
    assertEquals(result.response.status, 200);
    assertEquals(streamContext, {
      threadId: "10000000-1000-4000-8000-100000000001",
      runId: "run_1",
      parentRunId: "run_parent",
      state: { phase: "draft" },
      context: [{
        description: "Current file",
        value: "src/main.ts",
      }],
      forwardedProps: undefined,
    });
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

    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => {},
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
    const fetchUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    const originalApiUrl = Deno.env.get("VERYFRONT_API_URL");

    Deno.env.set("VERYFRONT_API_URL", "https://api.veryfront.org");
    globalThis.fetch = ((url, init) => {
      fetchUrls.push(String(url));
      if (String(url) === "https://api.veryfront.org/mcp") {
        assertEquals(
          new Headers(init?.headers).get("authorization"),
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

      if (String(url) === "https://api.veryfront.org/projects/demo-project/environments") {
        return Promise.resolve(
          new Response(JSON.stringify({ data: [] }), {
            headers: { "content-type": "application/json" },
          }),
        );
      }

      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }) as typeof fetch;

    try {
      const handler = new AgentStreamHandler({
        ensureProjectDiscovery: async () => {},
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
          description: "Uses project-scoped skills and tools.",
          instructions: "Use project-scoped instructions.",
          skills: ["support-triage"],
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
      assertEquals(capturedSystem, "Use project-scoped instructions.");
      assertEquals(capturedSkills, ["support-triage"]);
      assertEquals((capturedTools as Record<string, unknown>).search_knowledge, true);
      assertEquals((capturedTools as Record<string, unknown>).get_file, true);
      assertEquals(capturedAllowedRemoteTools, ["get_file", "search_knowledge"]);
      assertEquals(fetchUrls.includes("https://api.veryfront.org/mcp"), true);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiUrl === undefined) Deno.env.delete("VERYFRONT_API_URL");
      else Deno.env.set("VERYFRONT_API_URL", originalApiUrl);
    }
  });

  it("does not pass undeclared forwarded remote tool allowlists into the runtime agent config", async () => {
    let capturedAllowedTools: string[] | undefined;

    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => {},
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
          allowedTools: ["gmail:list-emails", "gmail:get-email"],
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

  it("preserves server-resolved integration tool allowlists forwarded by the control plane", async () => {
    let capturedAllowedTools: string[] | undefined;

    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => {},
      getAgent: (id) =>
        id === "assistant-1"
          ? createAgentWithConfig("assistant-1", {
            tools: {
              "get-current-date": true,
              gmail__list_emails: true,
              gmail__delete_email: true,
            },
          })
          : undefined,
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
      tools: [{
        name: "get-current-date",
        description: "Return the current date",
        inputSchema: { type: "object", properties: {} },
      }],
      forwardedProps: {
        runtimeOverrides: {
          allowedTools: [
            "get-current-date",
            "gmail__list_emails",
            "list_emails",
            "gmail__delete_email",
          ],
          serverResolvedIntegrationTools: ["gmail__list_emails"],
          integrationToolDefinitions: [{
            name: "gmail__list_emails",
            description: "List Gmail emails",
            inputSchema: { type: "object", properties: {} },
          }],
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
    assertEquals(capturedAllowedTools, ["get-current-date", "gmail__list_emails"]);
  });

  it("drops undeclared Studio runtime tool allowlists for untrusted clients", async () => {
    let capturedAllowedTools: string[] | undefined;

    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => {},
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

  it("auto-exposes Studio MCP tools for trusted Studio project-agent requests", async () => {
    let capturedAllowedRemoteTools: string[] | undefined;
    let capturedRemoteToolNames: string[] = [];
    const originalFetch = globalThis.fetch;
    const originalStudioMcpUrl = Deno.env.get("VERYFRONT_STUDIO_MCP_URL");

    Deno.env.set("VERYFRONT_STUDIO_MCP_URL", "https://studio.veryfront.org/mcp");
    globalThis.fetch = ((url, init) => {
      assertEquals(String(url), "https://studio.veryfront.org/mcp");
      const headers = new Headers(init?.headers);
      assertEquals(headers.get("authorization"), "Bearer request-scoped-user-token");
      assertEquals(headers.get("x-project-id"), "proj-1");
      assertEquals(headers.get("x-conversation-id"), "10000000-1000-4000-8000-100000000001");

      return Promise.resolve(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "veryfront-studio-mcp:tools:list",
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
    }) as typeof fetch;

    try {
      const handler = new AgentStreamHandler({
        ensureProjectDiscovery: async () => {},
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
      assertEquals(capturedAllowedRemoteTools, ["studio_todo_write"]);
      assertEquals(capturedRemoteToolNames, ["studio_todo_write", "studio_panel_control"]);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalStudioMcpUrl === undefined) Deno.env.delete("VERYFRONT_STUDIO_MCP_URL");
      else Deno.env.set("VERYFRONT_STUDIO_MCP_URL", originalStudioMcpUrl);
    }
  });

  it("fails closed for malformed runtime integration tool allowlists from forwarded props", async () => {
    let capturedAllowedTools: string[] | undefined;

    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => {},
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
          allowedTools: ["gmail:list-emails", 123],
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
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ tools: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    try {
      const handler = new AgentStreamHandler({
        ensureProjectDiscovery: async () => {},
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
      globalThis.fetch = originalFetch;
    }
  });

  it("exposes Veryfront API MCP tools requested through mcpServers policy", async () => {
    let capturedAllowedRemoteTools: string[] | undefined;
    let capturedRemoteToolNames: string[] = [];
    const originalFetch = globalThis.fetch;
    const originalApiUrl = Deno.env.get("VERYFRONT_API_URL");

    Deno.env.set("VERYFRONT_API_URL", "https://api.veryfront.org");
    globalThis.fetch = ((url, init) => {
      assertEquals(String(url), "https://api.veryfront.org/mcp");
      assertEquals(
        new Headers(init?.headers).get("authorization"),
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
                  name: "list_uploads",
                  description: "List uploads",
                  inputSchema: { type: "object", properties: {} },
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
    }) as typeof fetch;

    try {
      const handler = new AgentStreamHandler({
        ensureProjectDiscovery: async () => {},
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
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiUrl === undefined) Deno.env.delete("VERYFRONT_API_URL");
      else Deno.env.set("VERYFRONT_API_URL", originalApiUrl);
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
      ensureProjectDiscovery: async () => {},
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
          capturedSystem = typeof runtimeAgent.config.system === "function"
            ? await runtimeAgent.config.system()
            : runtimeAgent.config.system;
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
    const originalFetch = globalThis.fetch;
    const originalApiUrl = Deno.env.get("VERYFRONT_API_URL");
    const fetchUrls: string[] = [];
    Deno.env.set("VERYFRONT_API_URL", "https://api.veryfront.org");
    globalThis.fetch = ((url, init) => {
      fetchUrls.push(String(url));
      assertEquals(
        new Headers(init?.headers).get("authorization"),
        "Bearer request-scoped-user-token",
      );

      if (String(url).endsWith("/projects/support-agent-fork/environments")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                { id: "env-staging", name: "staging", protected: true },
                { id: "env-production", name: "production", protected: false },
              ],
            }),
            { headers: { "content-type": "application/json" } },
          ),
        );
      }

      if (String(url).includes("/projects/support-agent-fork/environment-variables?")) {
        assertEquals(String(url).includes("environment_id=env-production"), true);
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

      if (String(url) === "https://api.veryfront.org/mcp") {
        capturedMcpRequest = {
          url: String(url),
          authorization: new Headers(init?.headers).get("authorization"),
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
    }) as typeof fetch;

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
      globalThis.fetch = originalFetch;
      if (originalApiUrl === undefined) Deno.env.delete("VERYFRONT_API_URL");
      else Deno.env.set("VERYFRONT_API_URL", originalApiUrl);
    }

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(capturedEnv, {
      VERYFRONT_API_TOKEN: "request-scoped-user-token",
      VERYFRONT_API_URL: "https://api.veryfront.org",
      VERYFRONT_PROJECT_SLUG: "support-agent-fork",
      CUSTOM_PROJECT_ENV: "project-value",
      OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
      OTEL_RESOURCE_ATTRIBUTES: undefined,
    });
    assertEquals(capturedSystem, "project_reference=support-agent-fork");
    assertEquals(capturedMcpRequest, {
      url: "https://api.veryfront.org/mcp",
      authorization: "Bearer request-scoped-user-token",
    });
    assertEquals(capturedAllowedRemoteTools, ["list_projects", "search_knowledge"]);
    assertEquals(capturedRemoteToolNames, ["search_knowledge", "list_projects"]);
    assertEquals(fetchUrls, [
      "https://api.veryfront.org/mcp",
      "https://api.veryfront.org/projects/support-agent-fork/environments",
      "https://api.veryfront.org/projects/support-agent-fork/environment-variables?environment_id=env-production&limit=100",
    ]);
  });

  it("rejects oversized internal agent stream payloads before parsing", async () => {
    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => {},
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
    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => {},
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
    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => {},
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

  it("returns 400 when the runtime input exceeds the message limit", async () => {
    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => {},
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
    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => {},
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

  it("uses explicit agent source context when the control plane requests a different source", async () => {
    const runWithContextCalls: Array<{
      productionMode?: boolean;
      releaseId?: string | null;
      branch?: string | null;
      environmentName?: string | null;
    }> = [];

    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => {},
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
      agentSource: { type: "branch", branch: "main" },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });
    const ctx = createCtx(publicKeyPem);
    ctx.parsedDomain = {
      slug: "demo-project",
      branch: "feature-a",
      environment: "preview",
      isVeryfrontDomain: true,
      isDraft: true,
      allowIframeEmbed: true,
    };
    ctx.resolvedEnvironment = "preview";
    ctx.requestContext = {
      slug: "demo-project",
      branch: "feature-a",
      mode: "preview",
      token: "",
    };
    ctx.adapter = {
      ...ctx.adapter,
      env: createNoopEnvAdapter(publicKeyPem),
      fs: createNoopFsAdapter(runWithContextCalls),
    };

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
    assertEquals(runWithContextCalls.length, 2);
    assertEquals(runWithContextCalls[0]?.branch, "feature-a");
    assertEquals(runWithContextCalls[1]?.branch, "main");
    assertEquals(runWithContextCalls[1]?.productionMode, false);
  });

  it("returns 409 when the same run is started twice", async () => {
    const sessionManager = new AgentRunSessionManager();
    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => {},
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
    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => {},
      getAgent: (id) => id === "assistant-1" ? createAgent("assistant-1") : undefined,
      getAllAgentIds: () => ["assistant-1"],
      sessionManager: new AgentRunSessionManager(),
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
  });

  it("emits a cancellation error instead of finishing after an abort during a pending read", async () => {
    const sessionManager = new TrackingSessionManager();
    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => {},
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
    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => {},
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
    const resumeSignature = await createControlPlaneSignature(resumeBody, { requestId: "run_1" });

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
    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => {},
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
    const resumeSignature = await createControlPlaneSignature(resumeBody, { requestId: "run_1" });

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
    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls += 1;
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
