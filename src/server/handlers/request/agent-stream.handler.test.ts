import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import type {
  EnvironmentAdapter,
  FileInfo,
  FileSystemAdapter,
} from "#veryfront/platform/adapters/base.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DEFAULT_MAX_BODY_SIZE_BYTES } from "#veryfront/utils/constants/index.ts";
import { AgentRunResumeHandler } from "./agent-run-resume.handler.ts";
import { AgentStreamHandler } from "./agent-stream.handler.ts";
import {
  createAgent,
  createControlPlaneSignature,
  createCtx,
  createInjectedToolRuntime,
  encodeDataStreamEvent,
  readRemainingText,
  readUntil,
} from "./internal-agent-run.test-helpers.ts";

function createAgentStreamRequestBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    agentId: "assistant-1",
    threadId: "10000000-1000-4000-8000-100000000001",
    runId: "run_1",
    messages: [
      {
        id: "msg_1",
        role: "user",
        parts: [{ type: "text", text: "hello" }],
      },
    ],
    tools: [{ name: "studio_focus_component" }],
    context: [{ type: "text", text: "Current file: app.tsx" }],
    ...overrides,
  });
}

class TrackingSessionManager extends AgentRunSessionManager {
  readonly stats = {
    cancelCalls: 0,
    completeCalls: 0,
    failCalls: 0,
  };

  override cancelRun(runId: string): boolean {
    this.stats.cancelCalls += 1;
    return super.cancelRun(runId);
  }

  override completeRun(runId: string): void {
    this.stats.completeCalls += 1;
    super.completeRun(runId);
  }

  override failRun(runId: string): void {
    this.stats.failCalls += 1;
    super.failRun(runId);
  }
}

function createNoopEnvAdapter(publicKeyPem: string): EnvironmentAdapter {
  const values = new Map<string, string>();
  values.set("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", publicKeyPem);

  return {
    get: (key) => values.get(key),
    set: (key, value) => {
      values.set(key, value);
    },
    toObject: () => Object.fromEntries(values),
  };
}

type SourceContextTestFsAdapter = FileSystemAdapter & {
  isMultiProjectMode(): boolean;
  runWithContext<R>(
    slug: string,
    token: string,
    fn: () => Promise<R>,
    projectId?: string,
    options?: {
      productionMode?: boolean;
      releaseId?: string | null;
      branch?: string | null;
      environmentName?: string | null;
    },
  ): Promise<R>;
};

function createNoopFsAdapter(
  runWithContextCalls: Array<{
    productionMode?: boolean;
    releaseId?: string | null;
    branch?: string | null;
    environmentName?: string | null;
  }>,
): SourceContextTestFsAdapter {
  return {
    readFile: async () => "",
    writeFile: async () => {},
    exists: async () => false,
    async *readDir() {},
    stat: async (): Promise<FileInfo> => ({
      size: 0,
      isFile: false,
      isDirectory: false,
      isSymlink: false,
      mtime: null,
    }),
    mkdir: async () => {},
    remove: async () => {},
    makeTempDir: async () => "/tmp/agent-stream-handler-test",
    watch: () => ({
      close: () => {},
      async *[Symbol.asyncIterator]() {},
    }),
    isMultiProjectMode: () => true,
    runWithContext: async (
      _projectSlug,
      _token,
      fn,
      _projectId,
      options,
    ) => {
      runWithContextCalls.push(options ?? {});
      return await fn();
    },
  };
}

describe("server/handlers/request/agent-stream.handler", () => {
  it("streams AG-UI events for a valid signed request", async () => {
    let discoveryCalls = 0;
    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls += 1;
      },
      getAgent: (id) => id === "assistant-1" ? createAgent("assistant-1") : undefined,
      getAllAgentIds: () => ["assistant-1"],
      sessionManager: new AgentRunSessionManager(),
      resolveRuntimeOwnerInvokeUrl: async () => "http://10.0.0.7:20000/channels/invoke",
      createRuntime: () => ({
        stream: async (_messages, _context, callbacks) => {
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

    const body = createAgentStreamRequestBody();
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/internal/agents/stream", {
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
    assertEquals(text.includes("event: StepStarted"), false);
    assertEquals(text.includes("event: StepFinished"), false);
    assertEquals(text.includes("event: Custom"), false);
    assertEquals(text.includes("event: ActivitySnapshot"), false);
    assertEquals(text.includes("event: ActivityDelta"), false);
    assertEquals(text.includes("event: ReasoningStart"), false);
    assertEquals(text.includes("event: ReasoningContent"), false);
    assertEquals(text.includes("event: ReasoningEnd"), false);
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
      new Request("https://example.com/internal/agents/stream", {
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
      new Request("https://example.com/internal/agents/stream", {
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
      new Request("https://example.com/internal/agents/stream", {
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
      new Request("https://example.com/internal/agents/stream", {
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
      new Request("https://example.com/internal/agents/stream", {
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
      new Request("https://example.com/internal/agents/stream", {
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
    const request = new Request("https://example.com/internal/agents/stream", {
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

    const secondResult = await handler.handle(request, createCtx(publicKeyPem));
    assertExists(secondResult.response);
    assertEquals(secondResult.response.status, 409);
    assertEquals(await secondResult.response.json(), { error: 'Run "run_1" is already active' });
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
      new Request("https://example.com/internal/agents/stream", {
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
      new Request("https://example.com/internal/agents/stream", {
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
      new Request("https://example.com/internal/agents/stream", {
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
      new Request("https://example.com/internal/agents/runs/run_1/resume", {
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
});
