import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { type AgUiCompletion, AgUiRequestSchema, createAgUiHandler } from "./handler.ts";
import { AgentRuntime, RunResumeSessionManager } from "../index.ts";
import { createEphemeralAgent } from "../factory.ts";
import { tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { registerSkill, skillRegistryInternal } from "#veryfront/skill/registry.ts";
import { getEffectiveAgentSystem } from "../runtime/effective-agent-system.ts";
import { flattenSystemInstructions } from "../runtime/tool-inventory.ts";
import type { ModelRuntime, ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import type { Agent, AgentResponse, Message } from "../types.ts";

const encoder = new TextEncoder();

function encodeDataStreamEvent(payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function createTestAgent() {
  let clearMemoryCalls = 0;
  let capturedMessages: Message[] = [];
  let capturedContext: Record<string, unknown> | undefined;
  let capturedModel: string | undefined;
  let capturedMaxOutputTokens: number | undefined;

  const agent: Agent = {
    id: "assistant-1",
    config: {
      id: "assistant-1",
      system: "You are helpful.",
      model: "anthropic/claude-sonnet-4-6",
    } as Agent["config"],
    generate: async () => {
      throw new Error("not used");
    },
    stream: async (input) => {
      capturedMessages = input.messages ?? [];
      capturedContext = input.context;
      capturedModel = input.model;
      capturedMaxOutputTokens = input.maxOutputTokens;

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encodeDataStreamEvent({ type: "message-start", messageId: "assistant-msg-1" }),
          );
          controller.enqueue(
            encodeDataStreamEvent({
              type: "data",
              data: {
                model: "anthropic/claude-sonnet-4-6",
                inferenceMode: "cloud",
              },
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
          controller.close();
        },
      });

      return {
        toDataStreamResponse: () =>
          new Response(stream, {
            headers: { "Content-Type": "text/event-stream" },
          }),
      };
    },
    respond: async () => new Response("not used"),
    getMemory: () => {
      throw new Error("not used");
    },
    getMemoryStats: async () => ({
      totalMessages: 0,
      estimatedTokens: 0,
      type: "conversation",
    }),
    clearMemory: async () => {
      clearMemoryCalls += 1;
    },
  };

  return {
    agent,
    get clearMemoryCalls() {
      return clearMemoryCalls;
    },
    get capturedMessages() {
      return capturedMessages;
    },
    get capturedContext() {
      return capturedContext;
    },
    get capturedModel() {
      return capturedModel;
    },
    get capturedMaxOutputTokens() {
      return capturedMaxOutputTokens;
    },
  };
}

describe("agent/ag-ui-handler", () => {
  it("applies defaults for optional AG-UI fields", () => {
    const parsed = AgUiRequestSchema.parse({
      messages: [{
        id: "msg-1",
        role: "user",
        parts: [{ type: "text", text: "hello" }],
      }],
    });

    assertEquals(parsed.tools, []);
    assertEquals(parsed.context, []);
  });

  it("streams AG-UI events from a direct agent instance", async () => {
    const testAgent = createTestAgent();
    const handler = createAgUiHandler({
      agent: testAgent.agent,
      context: { tenant: "acme" },
    });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          }],
          context: [{ type: "text", text: "Current file: app.tsx" }],
          forwardedProps: { traceId: "trace-1" },
          model: "anthropic/claude-sonnet-4-6",
          maxOutputTokens: 512,
        }),
      }),
    );

    assertEquals(response.status, 200);
    assertEquals(response.headers.get("content-type"), "text/event-stream");
    assertEquals(testAgent.clearMemoryCalls, 1);
    assertEquals(testAgent.capturedMessages.length, 1);
    assertEquals(testAgent.capturedMessages[0]?.role, "user");
    assertEquals(testAgent.capturedModel, "anthropic/claude-sonnet-4-6");
    assertEquals(testAgent.capturedMaxOutputTokens, 512);
    assertEquals(testAgent.capturedContext?.tenant, "acme");
    assertEquals(testAgent.capturedContext?.threadId !== undefined, true);
    assertEquals(testAgent.capturedContext?.runId !== undefined, true);
    assertEquals(testAgent.capturedContext?.runIdBindsToolAuthorization, false);
    assertEquals(
      testAgent.capturedContext?.agUi,
      {
        context: [{ type: "text", text: "Current file: app.tsx" }],
        forwardedProps: { traceId: "trace-1" },
      },
    );

    const body = await response.text();
    assertStringIncludes(body, "event: RunStarted");
    assertStringIncludes(body, "event: StateSnapshot");
    assertStringIncludes(body, 'data: {"snapshot":{}');
    assertStringIncludes(body, "event: MessagesSnapshot");
    assertStringIncludes(body, '"messages":[{"id":"msg-1","role":"user"');
    assertStringIncludes(body, "event: TextMessageStart");
    assertStringIncludes(body, "event: TextMessageContent");
    assertStringIncludes(body, "event: TextMessageEnd");
    assertStringIncludes(body, "event: RunFinished");
    assertStringIncludes(body, '"provider":"anthropic"');
    assertStringIncludes(body, '"model":"anthropic/claude-sonnet-4-6"');
    assertStringIncludes(body, '"delta":"hello from runtime"');
    assertStringIncludes(body, `"runId":"${testAgent.capturedContext?.runId}"`);
  });

  it("keeps a client-supplied direct AG-UI run ID eligible for binding", async () => {
    const testAgent = createTestAgent();
    const handler = createAgUiHandler({ agent: testAgent.agent });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: "run_client_1",
          messages: [{
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          }],
        }),
      }),
    );

    assertEquals(response.status, 200);
    assertEquals(testAgent.capturedContext?.runId, "run_client_1");
    assertEquals(testAgent.capturedContext?.runIdBindsToolAuthorization, undefined);
    assertStringIncludes(await response.text(), '"runId":"run_client_1"');
  });

  it("keeps client run IDs non-binding in a trusted local eval context", async () => {
    const testAgent = createTestAgent();
    const handler = createAgUiHandler({
      agent: testAgent.agent,
      context: { runIdBindsToolAuthorization: false },
    });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: "eval-run-local",
          messages: [{
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          }],
        }),
      }),
    );

    assertEquals(response.status, 200);
    assertEquals(testAgent.capturedContext?.runId, "eval-run-local");
    assertEquals(testAgent.capturedContext?.runIdBindsToolAuthorization, false);
  });

  it("omits provider-owned remote tool history before direct streaming", async () => {
    const testAgent = createTestAgent();
    testAgent.agent.config.providerTools = ["web_search"];
    const handler = createAgUiHandler({ agent: testAgent.agent });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              id: "user-1",
              role: "user",
              parts: [{ type: "text", text: "Explain Swedish tax residency." }],
            },
            {
              id: "assistant-1",
              role: "assistant",
              parts: [
                { type: "text", text: "I searched official sources." },
                {
                  type: "tool-web_search",
                  toolCallId: "toolu_search_1",
                  toolName: "web_search",
                  args: { query: "site:skatteverket.se tax residency" },
                  output: { results: [{ title: "Skatteverket" }] },
                },
              ],
            },
            {
              id: "user-2",
              role: "user",
              parts: [{ type: "text", text: "Cite the official source." }],
            },
          ],
        }),
      }),
    );

    await response.text();

    assertEquals(testAgent.capturedMessages, [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Explain Swedish tax residency." }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "I searched official sources." }],
      },
      {
        id: "user-2",
        role: "user",
        parts: [{ type: "text", text: "Cite the official source." }],
      },
    ]);
  });

  it("omits provider-owned remote tool-only messages before direct streaming", async () => {
    const testAgent = createTestAgent();
    testAgent.agent.config.providerTools = ["web_search"];
    const handler = createAgUiHandler({ agent: testAgent.agent });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              id: "user-1",
              role: "user",
              parts: [{ type: "text", text: "Explain Swedish tax residency." }],
            },
            {
              id: "assistant-search",
              role: "assistant",
              parts: [{
                type: "tool-web_search",
                toolCallId: "toolu_search_1",
                toolName: "web_search",
                args: { query: "site:skatteverket.se tax residency" },
                output: { results: [{ title: "Skatteverket" }] },
              }],
            },
            {
              id: "assistant-1",
              role: "assistant",
              parts: [{ type: "text", text: "I found the official guidance." }],
            },
            {
              id: "user-2",
              role: "user",
              parts: [{ type: "text", text: "Cite the official source." }],
            },
          ],
        }),
      }),
    );

    await response.text();

    assertEquals(testAgent.capturedMessages, [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Explain Swedish tax residency." }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "I found the official guidance." }],
      },
      {
        id: "user-2",
        role: "user",
        parts: [{ type: "text", text: "Cite the official source." }],
      },
    ]);
  });

  it("bridges direct tool data events into the AG-UI stream", async () => {
    const testAgent = createTestAgent();
    testAgent.agent.stream = async (input) => {
      const publishDataEvent = input.context?.publishDataEvent;
      if (typeof publishDataEvent === "function") {
        await publishDataEvent({
          type: "test.report",
          name: "test.report",
          value: { status: "ready" },
        });
      }

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encodeDataStreamEvent({ type: "message-start", messageId: "assistant-msg-1" }),
          );
          controller.enqueue(encodeDataStreamEvent({ type: "text-start", id: "text-1" }));
          controller.enqueue(
            encodeDataStreamEvent({ type: "text-delta", id: "text-1", delta: "done" }),
          );
          controller.enqueue(encodeDataStreamEvent({ type: "text-end", id: "text-1" }));
          controller.close();
        },
      });

      return {
        toDataStreamResponse: () =>
          new Response(stream, {
            headers: { "Content-Type": "text/event-stream" },
          }),
      };
    };

    const handler = createAgUiHandler({ agent: testAgent.agent });
    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          }],
        }),
      }),
    );

    const body = await response.text();
    assertStringIncludes(body, "event: Custom");
    assertStringIncludes(body, '"name":"test.report"');
    assertStringIncludes(body, '"status":"ready"');
  });

  it("bridges injected-tools tool data events into the AG-UI stream exactly once", async () => {
    const sessionManager = new RunResumeSessionManager<{
      result: unknown;
      isError: boolean;
    }>();
    const originalStream = AgentRuntime.prototype.stream;

    AgentRuntime.prototype.stream = async function (
      _messages,
      context,
    ): Promise<ReadableStream<Uint8Array>> {
      assertEquals(context?.runId, "run_data_1");
      assertEquals(context?.runIdBindsToolAuthorization, undefined);
      const publishDataEvent = context?.publishDataEvent;
      if (typeof publishDataEvent === "function") {
        await publishDataEvent({
          type: "test.report",
          name: "test.report",
          value: { status: "ready" },
        });
      }

      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encodeDataStreamEvent({ type: "message-start", messageId: "assistant-msg-1" }),
          );
          controller.enqueue(encodeDataStreamEvent({ type: "text-start", id: "text-1" }));
          controller.enqueue(
            encodeDataStreamEvent({ type: "text-delta", id: "text-1", delta: "done" }),
          );
          controller.enqueue(encodeDataStreamEvent({ type: "text-end", id: "text-1" }));
          controller.close();
        },
      });
    };

    try {
      const handler = createAgUiHandler({
        agent: createTestAgent().agent,
        sessionManager,
      });

      const response = await handler(
        new Request("http://localhost/api/ag-ui", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runId: "run_data_1",
            threadId: crypto.randomUUID(),
            messages: [{
              id: "msg-1",
              role: "user",
              parts: [{ type: "text", text: "hello" }],
            }],
            tools: [{ name: "client_confirm" }],
          }),
        }),
      );

      const body = await response.text();
      assertStringIncludes(body, "event: Custom");
      assertStringIncludes(body, '"name":"test.report"');
      assertStringIncludes(body, '"status":"ready"');
      // The injected path injects publishDataEvent and wraps the stream once,
      // so the event must surface exactly once (no double-emit).
      assertEquals(body.match(/"name":"test\.report"/g)?.length, 1);
    } finally {
      AgentRuntime.prototype.stream = originalStream;
    }
  });

  it("runs a restricted AG-UI request through a framework-built restricted agent", async () => {
    const originalStream = AgentRuntime.prototype.stream;
    let publicStreamCalls = 0;
    AgentRuntime.prototype.stream = function (): Promise<ReadableStream<Uint8Array>> {
      publicStreamCalls += 1;
      throw new Error("a restricted AG-UI run must not use mutable public stream dispatch");
    } as typeof AgentRuntime.prototype.stream;

    let observedToolNames: string[] = [];
    let observedPrompt = "";
    const model: ModelRuntime<ModelRuntimeCallOptions> = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      doGenerate: () => {
        throw new Error("Expected the streaming path");
      },
      doStream: (options) => {
        observedToolNames = (options.tools ?? []).map((definition) => definition.name).toSorted();
        observedPrompt = JSON.stringify(options.prompt ?? "");
        return Promise.resolve({
          stream: new ReadableStream<unknown>({
            start(controller) {
              controller.enqueue({ type: "text-delta", id: "text-1", delta: "restricted" });
              controller.enqueue({ type: "finish", finishReason: "stop" });
              controller.close();
            },
          }),
        });
      },
    };

    try {
      registerSkill(
        "ag-ui-restricted-skill",
        {
          id: "ag-ui-restricted-skill",
          metadata: { name: "ag-ui-restricted-skill", description: "Never reachable here" },
          rootPath: "/test/skills/ag-ui-restricted-skill",
        },
      );

      const restrictedAgent = createEphemeralAgent({
        id: "ag-ui-restricted-eval",
        model: "anthropic/claude-sonnet-4-6",
        system: "You are helpful.",
        environmentContext: "Environment: the AG-UI restriction fixture.",
        tools: {
          ag_ui_allowed_lookup: tool({
            id: "ag_ui_allowed_lookup",
            description: "Allowed by the eval ceiling.",
            inputSchema: defineSchema((v) => v.object({}))(),
            execute: () => Promise.resolve("ok"),
          }),
          ag_ui_denied_delete: tool({
            id: "ag_ui_denied_delete",
            description: "Denied by the eval ceiling.",
            inputSchema: defineSchema((v) => v.object({}))(),
            execute: () => Promise.resolve("ok"),
          }),
        },
        providerTools: ["web_search", "web_fetch"],
        skills: true,
        maxSteps: 20,
        resolveModelTransport: () => Promise.resolve({ model }),
      });

      // Unrestricted, this agent does advertise the skill catalog, so the
      // assertion below is about the ceiling and not about an empty registry.
      const unrestrictedSystem = getEffectiveAgentSystem(restrictedAgent);
      const resolvedSystem = typeof unrestrictedSystem === "function"
        ? await unrestrictedSystem()
        : unrestrictedSystem;
      const unrestrictedPrompt = typeof resolvedSystem === "string"
        ? resolvedSystem
        : flattenSystemInstructions(resolvedSystem);
      assertStringIncludes(unrestrictedPrompt, "ag-ui-restricted-skill");

      const handler = createAgUiHandler({
        agent: restrictedAgent,
        runtimeRestrictions: {
          allowedTools: ["ag_ui_allowed_lookup", "web_fetch"],
          maxSteps: 2,
        },
      });

      const response = await handler(
        new Request("http://localhost/api/ag-ui", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runId: "run_restricted_1",
            threadId: crypto.randomUUID(),
            messages: [{
              id: "msg-1",
              role: "user",
              parts: [{ type: "text", text: "hello" }],
            }],
            forwardedProps: {
              veryfront: {
                runtimeOverrides: { allowedTools: ["ag_ui_denied_delete"], maxSteps: 40 },
              },
            },
          }),
        }),
      );

      const body = await response.text();
      assertStringIncludes(body, "restricted");
      // Only the allowlisted local tool and provider tool reach the model, and
      // the request's own forwarded props never widen the ceiling.
      assertEquals(observedToolNames, ["ag_ui_allowed_lookup", "web_fetch"]);
      // The framework composes the restricted prompt, so authored environment
      // context survives...
      assertStringIncludes(observedPrompt, "Environment: the AG-UI restriction fixture.");
      // ...while the skill catalog stays out, because the ceiling excluded the
      // skill loader that would make it actionable.
      assertEquals(observedPrompt.includes("available_skills"), false);
      assertEquals(observedPrompt.includes("ag-ui-restricted-skill"), false);
      // The run dispatches through the framework-owned private capability.
      assertEquals(publicStreamCalls, 0);
    } finally {
      AgentRuntime.prototype.stream = originalStream;
      skillRegistryInternal.clearAll();
    }
  });

  it("refuses injected client tools on a restricted AG-UI run", async () => {
    const sessionManager = new RunResumeSessionManager<{
      result: unknown;
      isError: boolean;
    }>();
    const testAgent = createTestAgent();
    const handler = createAgUiHandler({
      agent: testAgent.agent,
      sessionManager,
      runtimeRestrictions: { allowedTools: [] },
    });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: "run_restricted_injected_1",
          threadId: crypto.randomUUID(),
          messages: [{
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          }],
          tools: [{ name: "client_confirm" }],
        }),
      }),
    );

    assertEquals(response.status, 400);
    assertEquals(testAgent.capturedMessages.length, 0);
  });

  it("allows injected client tools under a step-only restriction and applies the bound", async () => {
    const sessionManager = new RunResumeSessionManager<{
      result: unknown;
      isError: boolean;
    }>();
    const testAgent = createTestAgent();
    const agent: Agent = {
      ...testAgent.agent,
      config: { ...testAgent.agent.config, maxSteps: 20 } as Agent["config"],
    };
    const originalStream = AgentRuntime.prototype.stream;
    let capturedConfig: Record<string, unknown> | undefined;

    AgentRuntime.prototype.stream = function (
      this: AgentRuntime,
    ): Promise<ReadableStream<Uint8Array>> {
      capturedConfig = (this as unknown as { config: Record<string, unknown> }).config;
      return Promise.resolve(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encodeDataStreamEvent({ type: "message-start", messageId: "assistant-msg-1" }),
            );
            controller.enqueue(encodeDataStreamEvent({ type: "text-start", id: "text-1" }));
            controller.enqueue(
              encodeDataStreamEvent({ type: "text-delta", id: "text-1", delta: "stepped" }),
            );
            controller.enqueue(encodeDataStreamEvent({ type: "text-end", id: "text-1" }));
            controller.close();
          },
        }),
      );
    } as typeof AgentRuntime.prototype.stream;

    try {
      const handler = createAgUiHandler({
        agent,
        sessionManager,
        runtimeRestrictions: { maxSteps: 3 },
      });

      const response = await handler(
        new Request("http://localhost/api/ag-ui", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runId: "run_restricted_steps_1",
            threadId: crypto.randomUUID(),
            messages: [{
              id: "msg-1",
              role: "user",
              parts: [{ type: "text", text: "hello" }],
            }],
            tools: [{ name: "client_confirm" }],
          }),
        }),
      );

      const body = await response.text();
      assertEquals(response.status, 200);
      assertStringIncludes(body, "stepped");
      // No allowlist exists for the injected tools to bypass, so the run
      // proceeds with the merged tool surface under the narrowed step bound.
      assertEquals(capturedConfig?.maxSteps, 3);
      assert(capturedConfig?.tools !== undefined);
    } finally {
      AgentRuntime.prototype.stream = originalStream;
    }
  });

  it("runs beforeStream before direct AG-UI streaming", async () => {
    const testAgent = createTestAgent();
    const handler = createAgUiHandler({
      agent: testAgent.agent,
      context: (request) => {
        assertEquals(request.headers.get("authorization"), "Bearer public-user");
        assertEquals(request.headers.get("cookie"), "session=public");
        assertEquals(request.headers.get("x-token"), null);
        assertEquals(request.headers.get("x-project-id"), null);
        return { tenant: "acme" };
      },
      beforeStream: ({ request, lastUserText, context }) => {
        assertEquals(request.headers.get("authorization"), "Bearer public-user");
        assertEquals(request.headers.get("x-forwarded-host"), null);
        assertEquals(request.headers.get("x-veryfront-dispatch-jws"), null);
        return {
          prepend: [{
            role: "user",
            parts: [{
              type: "text",
              text: `Retrieved context for: ${lastUserText}`,
            }],
          }],
          context: {
            threadId: context.threadId,
            runId: context.runId,
            retrieval: "complete",
          },
        };
      },
    });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer public-user",
          Cookie: "session=public",
          "x-token": "host-secret",
          "x-project-id": "infrastructure-project",
          "x-forwarded-host": "trusted-proxy.example",
          "x-veryfront-dispatch-jws": "signed-infrastructure-token",
        },
        body: JSON.stringify({
          messages: [{
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "What changed?" }],
          }],
        }),
      }),
    );

    assertEquals(response.status, 200);
    assertEquals(testAgent.capturedMessages.length, 2);
    assertEquals(testAgent.capturedMessages[0]?.role, "user");
    assertEquals(
      testAgent.capturedMessages[0]?.parts[0],
      {
        type: "text",
        text: "Retrieved context for: What changed?",
      },
    );
    assertEquals(testAgent.capturedMessages[1]?.id, "msg-1");
    assertEquals(testAgent.capturedContext?.retrieval, "complete");
    assertEquals(testAgent.capturedContext?.runIdBindsToolAuthorization, false);
  });

  it("lets beforeStream short-circuit AG-UI requests", async () => {
    const testAgent = createTestAgent();
    const handler = createAgUiHandler({
      agent: testAgent.agent,
      beforeStream: () => Response.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "blocked" }],
          }],
        }),
      }),
    );

    assertEquals(response.status, 401);
    assertEquals(await response.json(), { error: "Unauthorized" });
    assertEquals(testAgent.capturedMessages.length, 0);
  });

  it("rejects oversized text parts before the agent runs", async () => {
    const testAgent = createTestAgent();
    const handler = createAgUiHandler({ agent: testAgent.agent });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "x".repeat(10_001) }],
          }],
        }),
      }),
    );

    assertEquals(response.status, 400);
    assertEquals(testAgent.clearMemoryCalls, 0);
    assertEquals(testAgent.capturedMessages.length, 0);
    const body = await response.json();
    assertEquals(body.error, "Invalid AG-UI request");
    assertStringIncludes(
      body.details[0]?.message ?? "",
      "Text message parts must include text less than 10000 characters",
    );
  });

  it("returns setup guidance when no agent runtime is available", async () => {
    const testAgent = createTestAgent();
    const noAiAvailable = toError(createError({
      type: "no_ai_available",
      message: "Local AI unavailable",
    }));
    testAgent.agent.stream = async () => {
      throw noAiAvailable;
    };

    const handler = createAgUiHandler({ agent: testAgent.agent });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "fallback" }],
          }],
        }),
      }),
    );

    assertEquals(response.status, 503);
    assertEquals(await response.json(), {
      code: "NO_AI_AVAILABLE",
      error:
        "No model credentials configured. Run veryfront login or set VERYFRONT_API_TOKEN, OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY.",
    });
  });

  it("returns setup guidance when model credentials are missing", async () => {
    const testAgent = createTestAgent();
    const missingCredentials = toError(createError({
      type: "config",
      message: "OPENAI_API_KEY not set",
    }));
    testAgent.agent.stream = async () => {
      throw missingCredentials;
    };

    const handler = createAgUiHandler({ agent: testAgent.agent });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "credentials" }],
          }],
        }),
      }),
    );

    assertEquals(response.status, 503);
    assertEquals(await response.json(), {
      code: "NO_MODEL_CREDENTIALS",
      error:
        "No model credentials configured. Run veryfront login or set VERYFRONT_API_TOKEN, OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY.",
    });
  });

  it("returns sanitized server errors when AG-UI agent streaming fails", async () => {
    const testAgent = createTestAgent();
    testAgent.agent.stream = async () => {
      throw new Error("provider secret detail");
    };

    const handler = createAgUiHandler({ agent: testAgent.agent });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          }],
        }),
      }),
    );

    assertEquals(response.status, 500);
    assertEquals(await response.json(), { error: "Internal server error" });
  });

  it("flushes the final runtime data event when the upstream stream ends without a trailing blank line", async () => {
    const agent: Agent = {
      id: "assistant-1",
      config: {
        id: "assistant-1",
        system: "You are helpful.",
        model: "anthropic/claude-sonnet-4-6",
      } as Agent["config"],
      generate: async () => {
        throw new Error("not used");
      },
      stream: async () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encodeDataStreamEvent({ type: "message-start", messageId: "assistant-msg-1" }),
            );
            controller.enqueue(
              encoder.encode('data: {"type":"text-delta","delta":"tail event survives"}'),
            );
            controller.close();
          },
        });

        return {
          toDataStreamResponse: () =>
            new Response(stream, {
              headers: { "Content-Type": "text/event-stream" },
            }),
        };
      },
      respond: async () => new Response("not used"),
      getMemory: () => {
        throw new Error("not used");
      },
      getMemoryStats: async () => ({
        totalMessages: 0,
        estimatedTokens: 0,
        type: "conversation",
      }),
      clearMemory: async () => {},
    };
    const handler = createAgUiHandler({ agent });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          }],
        }),
      }),
    );

    const body = await response.text();
    assertStringIncludes(body, "event: TextMessageStart");
    assertStringIncludes(body, '"delta":"tail event survives"');
  });

  it("accepts a Pages Router style request wrapper and generates default ids", async () => {
    const testAgent = createTestAgent();
    const handler = createAgUiHandler({ agent: testAgent.agent });

    const request = new Request("http://localhost/api/ag-ui", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "hello" }],
        }],
      }),
    });

    const response = await handler({ request });

    assertEquals(response.status, 200);
    assertMatch(String(testAgent.capturedContext?.threadId), /^[0-9a-f-]{36}$/);
    assertMatch(String(testAgent.capturedContext?.runId), /^run_[a-z0-9]+$/);
  });

  it("supports injected client tools when a public session manager is provided", async () => {
    const sessionManager = new RunResumeSessionManager<{
      result: unknown;
      isError: boolean;
    }>();
    const originalStream = AgentRuntime.prototype.stream;
    let streamedRunId: string | undefined;

    AgentRuntime.prototype.stream = async function (
      messages,
      context,
    ): Promise<ReadableStream<Uint8Array>> {
      const runtimeConfig = this as unknown as {
        config: {
          tools?: Record<string, {
            execute: (
              input: Record<string, unknown>,
              context?: { toolCallId?: string },
            ) => Promise<unknown>;
          }>;
        };
      };

      const injectedTool = runtimeConfig.config.tools?.client_confirm;
      if (!injectedTool) {
        throw new Error("Expected injected tool to be merged into the runtime config");
      }

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          void (async () => {
            controller.enqueue(
              encodeDataStreamEvent({
                type: "message-start",
                messageId: "assistant-msg-1",
              }),
            );
            controller.enqueue(
              encodeDataStreamEvent({
                type: "data",
                data: {
                  model: "anthropic/claude-sonnet-4-6",
                  inferenceMode: "cloud",
                },
              }),
            );
            controller.enqueue(
              encodeDataStreamEvent({
                type: "tool-input-start",
                toolCallId: "tool-call-1",
                toolName: "client_confirm",
              }),
            );
            controller.enqueue(
              encodeDataStreamEvent({
                type: "tool-input-delta",
                toolCallId: "tool-call-1",
                inputTextDelta: '{"approved":true}',
              }),
            );
            controller.enqueue(
              encodeDataStreamEvent({
                type: "tool-input-available",
                toolCallId: "tool-call-1",
              }),
            );

            const result = await injectedTool.execute(
              { approved: true },
              { toolCallId: "tool-call-1" },
            );

            controller.enqueue(
              encodeDataStreamEvent({
                type: "tool-output-available",
                toolCallId: "tool-call-1",
                output: result,
              }),
            );
            controller.close();
          })();
        },
      });

      assertEquals(messages[0]?.role, "user");
      if (typeof context?.runId !== "string") throw new Error("Expected a generated run ID");
      streamedRunId = context.runId;
      assertMatch(streamedRunId, /^run_[a-z0-9]+$/);
      assertEquals(context.replacement, true);
      assertEquals(context.runIdBindsToolAuthorization, false);
      return stream;
    };

    try {
      const handler = createAgUiHandler({
        agent: createTestAgent().agent,
        sessionManager,
        beforeStream: ({ context }) => ({
          context: {
            threadId: context.threadId,
            runId: context.runId,
            replacement: true,
          },
        }),
      });

      const response = await handler(
        new Request("http://localhost/api/ag-ui", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId: crypto.randomUUID(),
            messages: [{
              id: "msg-1",
              role: "user",
              parts: [{ type: "text", text: "hello" }],
            }],
            tools: [{ name: "client_confirm" }],
          }),
        }),
      );

      assertEquals(response.status, 200);
      if (streamedRunId === undefined) throw new Error("Expected the runtime to capture a run ID");

      const bodyPromise = response.text();
      const submitOutcome = sessionManager.submitSignal(streamedRunId, {
        waitKey: "tool-call-1",
        value: { result: { approved: true }, isError: false },
      });
      assertEquals(submitOutcome, { accepted: true });

      const body = await bodyPromise;
      assertStringIncludes(body, "event: ToolCallStart");
      assertStringIncludes(body, "event: ToolCallEnd");
      assertStringIncludes(body, "event: ToolCallResult");
      assertStringIncludes(body, '"toolCallId":"tool-call-1"');
      assertStringIncludes(body, '"approved":true');
      assertStringIncludes(body, "event: RunFinished");
    } finally {
      AgentRuntime.prototype.stream = originalStream;
    }
  });

  it("rejects injected client tools when no public session manager is provided", async () => {
    const testAgent = createTestAgent();
    const handler = createAgUiHandler({ agent: testAgent.agent });

    const response = await handler(
      new Request("http://localhost/api/ag-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          }],
          tools: [{ name: "client_confirm" }],
        }),
      }),
    );

    assertEquals(response.status, 501);
    assertEquals(testAgent.clearMemoryCalls, 0);
    assertStringIncludes(
      await response.text(),
      "Injected AG-UI tools require a public RunResumeSessionManager",
    );
  });

  it("returns 409 for a duplicate run id while the first run is still open", async () => {
    const sessionManager = new RunResumeSessionManager<{
      result: unknown;
      isError: boolean;
    }>();
    const originalStream = AgentRuntime.prototype.stream;
    let openController: ReadableStreamDefaultController<Uint8Array> | undefined;

    AgentRuntime.prototype.stream = async function (): Promise<ReadableStream<Uint8Array>> {
      return new ReadableStream<Uint8Array>({
        start(controller) {
          openController = controller;
        },
      });
    } as typeof AgentRuntime.prototype.stream;

    try {
      const handler = createAgUiHandler({
        agent: createTestAgent().agent,
        sessionManager,
      });
      const body = JSON.stringify({
        threadId: crypto.randomUUID(),
        runId: "run_dupe_1",
        messages: [{
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "hello" }],
        }],
        tools: [{ name: "client_confirm" }],
      });
      const agUiDuplicateRequest = () =>
        new Request("http://localhost/api/ag-ui", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });

      const first = await handler(agUiDuplicateRequest());
      assertEquals(first.status, 200, "the first run must stream normally");

      const second = await handler(agUiDuplicateRequest());
      assertEquals(second.status, 409, "a duplicate active runId must conflict, not 500");
      assertEquals(
        await second.json(),
        { error: "Run already active" },
        "409 body must match the documented conflict shape",
      );

      openController?.close();
      await first.text();
    } finally {
      AgentRuntime.prototype.stream = originalStream;
    }
  });

  it("releases the run when stream startup fails", async () => {
    const sessionManager = new RunResumeSessionManager<{
      result: unknown;
      isError: boolean;
    }>();
    const originalStream = AgentRuntime.prototype.stream;

    AgentRuntime.prototype.stream = function (): Promise<ReadableStream<Uint8Array>> {
      return Promise.reject(new Error("stream startup failed"));
    } as typeof AgentRuntime.prototype.stream;

    try {
      const handler = createAgUiHandler({
        agent: createTestAgent().agent,
        sessionManager,
      });

      const response = await handler(
        new Request("http://localhost/api/ag-ui", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId: crypto.randomUUID(),
            runId: "run_release_1",
            messages: [{
              id: "msg-1",
              role: "user",
              parts: [{ type: "text", text: "hello" }],
            }],
            tools: [{ name: "client_confirm" }],
          }),
        }),
      );

      assertEquals(response.status, 500, "a failed stream start must surface as a server error");
      assertEquals(await response.json(), { error: "Internal server error" });
      assertEquals(
        sessionManager.getRunStatus("run_release_1"),
        null,
        "a failed stream start must release the run instead of leaving it active",
      );
    } finally {
      AgentRuntime.prototype.stream = originalStream;
    }
  });
});

// A minimal deferred so a test can await the (post-close) onComplete callback.
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const FINALIZED_RESPONSE: AgentResponse = {
  text: "hello from runtime",
  messages: [
    { id: "assistant-msg-1", role: "assistant", parts: [{ type: "text", text: "hello" }] },
  ],
  toolCalls: [],
  status: "completed",
};

/** A test agent whose stream reports a finalized response via `onFinish`. */
function createFinishingAgent(
  options: { response?: AgentResponse | null; failMidStream?: boolean } = {},
): Agent {
  const { response = FINALIZED_RESPONSE, failMidStream = false } = options;
  return {
    id: "assistant-1",
    config: {
      id: "assistant-1",
      system: "You are helpful.",
      model: "anthropic/claude-sonnet-4-6",
    } as Agent["config"],
    generate: async () => {
      throw new Error("not used");
    },
    stream: async (input) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encodeDataStreamEvent({ type: "text-start", id: "text-1" }));
          controller.enqueue(
            encodeDataStreamEvent({ type: "text-delta", id: "text-1", delta: "hello" }),
          );
          if (failMidStream) {
            controller.error(new Error("upstream exploded"));
            return;
          }
          controller.enqueue(encodeDataStreamEvent({ type: "text-end", id: "text-1" }));
          controller.close();
        },
      });
      // A run may finalize server-side and still fail during flush, so the
      // finalized response is reported whenever the agent has one.
      if (response) input.onFinish?.(response);
      return {
        toDataStreamResponse: () =>
          new Response(stream, { headers: { "Content-Type": "text/event-stream" } }),
      };
    },
    respond: async () => new Response("not used"),
    getMemory: () => {
      throw new Error("not used");
    },
    getMemoryStats: async () => ({
      totalMessages: 0,
      estimatedTokens: 0,
      type: "conversation",
    }),
    clearMemory: async () => {},
  } as Agent;
}

function agUiRequest(text = "hello"): Request {
  return new Request("http://localhost/api/ag-ui", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ id: "msg-1", role: "user", parts: [{ type: "text", text }] }],
    }),
  });
}

describe("agent/ag-ui-handler onComplete (server-side persistence)", () => {
  it("fires once after a successful run with the finalized conversation", async () => {
    const seen: AgUiCompletion[] = [];
    const done = deferred();
    const handler = createAgUiHandler({
      agent: createFinishingAgent(),
      onComplete: (completion) => {
        seen.push(completion);
        done.resolve();
      },
    });

    const response = await handler(agUiRequest());
    await response.text();
    await done.promise;

    assertEquals(seen.length, 1);
    const completion = seen[0]!;
    assertEquals(completion.agentId, "assistant-1");
    assert(completion.threadId.length > 0);
    assert(completion.runId.length > 0);
    // The finalized assistant turn is handed back without reconstruction...
    assertEquals(completion.messages, FINALIZED_RESPONSE.messages);
    // ...alongside the input that produced it and the full response.
    assertEquals(completion.inputMessages.length, 1);
    assertEquals(completion.inputMessages[0]?.role, "user");
    assertEquals(completion.response.text, "hello from runtime");
  });

  it("does not fire when the run errors", async () => {
    let calls = 0;
    const handler = createAgUiHandler({
      agent: createFinishingAgent({ failMidStream: true }),
      onComplete: () => {
        calls += 1;
      },
    });

    const response = await handler(agUiRequest());
    // The onComplete decision runs synchronously with the stream close, so a
    // fully drained body is enough to observe that the callback never fired.
    const body = await response.text();

    assertStringIncludes(body, "event: RunError");
    assertEquals(
      calls,
      0,
      "onComplete must not fire after a RunError, even when the run already reported a finalized response",
    );
  });

  it("does not fire when the run produced no finalized response", async () => {
    let calls = 0;
    const handler = createAgUiHandler({
      // Stream succeeds but never reports a finalized response.
      agent: createFinishingAgent({ response: null }),
      onComplete: () => {
        calls += 1;
      },
    });

    const response = await handler(agUiRequest());
    await response.text();
    await new Promise((r) => setTimeout(r, 0));

    assertEquals(calls, 0);
  });

  it("contains a throwing callback without corrupting the stream", async () => {
    const done = deferred();
    const handler = createAgUiHandler({
      agent: createFinishingAgent(),
      onComplete: () => {
        done.resolve();
        throw new Error("persistence failed");
      },
    });

    const response = await handler(agUiRequest());
    const body = await response.text();
    await done.promise;

    // The stream still delivered a well-formed successful run.
    assertEquals(response.status, 200);
    assertStringIncludes(body, "event: RunFinished");
  });

  it("fires once for a resumable injected-tool run after the tool round-trip", async () => {
    const sessionManager = new RunResumeSessionManager<{
      result: unknown;
      isError: boolean;
    }>();
    const seen: AgUiCompletion[] = [];
    const done = deferred();
    const originalStream = AgentRuntime.prototype.stream;

    // The injected-tools path drives an AgentRuntime, not agent.stream: the tool
    // blocks inline on the session signal, then the run finalizes in the same
    // stream. onComplete must fire exactly once, after the round-trip.
    AgentRuntime.prototype.stream = async function (
      _messages,
      _context,
      callbacks,
    ): Promise<ReadableStream<Uint8Array>> {
      const runtimeConfig = this as unknown as {
        config: {
          tools?: Record<string, {
            execute: (
              input: Record<string, unknown>,
              context?: { toolCallId?: string },
            ) => Promise<unknown>;
          }>;
        };
      };
      const injectedTool = runtimeConfig.config.tools?.client_confirm;
      if (!injectedTool) {
        throw new Error("Expected injected tool to be merged into the runtime config");
      }

      return new ReadableStream<Uint8Array>({
        start(controller) {
          void (async () => {
            controller.enqueue(
              encodeDataStreamEvent({ type: "message-start", messageId: "assistant-msg-1" }),
            );
            controller.enqueue(
              encodeDataStreamEvent({
                type: "tool-input-start",
                toolCallId: "tool-call-1",
                toolName: "client_confirm",
              }),
            );
            controller.enqueue(
              encodeDataStreamEvent({ type: "tool-input-available", toolCallId: "tool-call-1" }),
            );
            const result = await injectedTool.execute(
              { approved: true },
              { toolCallId: "tool-call-1" },
            );
            controller.enqueue(
              encodeDataStreamEvent({
                type: "tool-output-available",
                toolCallId: "tool-call-1",
                output: result,
              }),
            );
            // The run finalizes server-side once the tool result is in.
            callbacks?.onFinish?.(FINALIZED_RESPONSE);
            controller.close();
          })();
        },
      });
    };

    try {
      const handler = createAgUiHandler({
        agent: createFinishingAgent(),
        sessionManager,
        onComplete: (completion) => {
          seen.push(completion);
          done.resolve();
        },
      });

      const response = await handler(
        new Request("http://localhost/api/ag-ui", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runId: "run_persist_1",
            threadId: crypto.randomUUID(),
            messages: [{ id: "msg-1", role: "user", parts: [{ type: "text", text: "hello" }] }],
            tools: [{ name: "client_confirm" }],
          }),
        }),
      );
      assertEquals(response.status, 200);

      const bodyPromise = response.text();
      const submitOutcome = sessionManager.submitSignal("run_persist_1", {
        waitKey: "tool-call-1",
        value: { result: { approved: true }, isError: false },
      });
      assertEquals(submitOutcome, { accepted: true });

      const body = await bodyPromise;
      await done.promise;

      // The whole tool round-trip completed inside one stream => one persistence.
      assertStringIncludes(body, "event: RunFinished");
      assertEquals(seen.length, 1);
      const completion = seen[0]!;
      assertEquals(completion.runId, "run_persist_1");
      assertEquals(completion.messages, FINALIZED_RESPONSE.messages);
      assertEquals(completion.inputMessages[0]?.role, "user");
      assertEquals(completion.response.text, FINALIZED_RESPONSE.text);
    } finally {
      AgentRuntime.prototype.stream = originalStream;
    }
  });

  it("does not fire when the client disconnects before the final flush", async () => {
    let completeCalls = 0;
    const gateOpen = deferred();

    // Finalizes server-side (onFinish fires, completedResponse is set) but holds
    // the stream open until the test lets it close — so the terminal RunFinished
    // flush is what lands on a dropped connection.
    const agent: Agent = {
      ...createFinishingAgent(),
      stream: async (_input) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encodeDataStreamEvent({ type: "text-start", id: "text-1" }));
            controller.enqueue(
              encodeDataStreamEvent({ type: "text-delta", id: "text-1", delta: "hello" }),
            );
            controller.enqueue(encodeDataStreamEvent({ type: "text-end", id: "text-1" }));
            void gateOpen.promise.then(() => {
              try {
                controller.close();
              } catch {
                // Upstream may already be torn down by the aborted downstream.
              }
            });
          },
        });
        // The run finalizes server-side regardless of client delivery.
        _input.onFinish?.(FINALIZED_RESPONSE);
        return {
          toDataStreamResponse: () =>
            new Response(stream, { headers: { "Content-Type": "text/event-stream" } }),
        };
      },
    } as Agent;

    const handler = createAgUiHandler({
      agent,
      onComplete: () => {
        completeCalls += 1;
      },
    });

    const response = await handler(agUiRequest());
    const reader = response.body!.getReader();
    // Receive the streamed head, then simulate the client dropping the socket.
    await reader.read();
    await reader.cancel();
    // Now let the run reach its terminal flush against the closed connection.
    gateOpen.resolve();
    await new Promise((r) => setTimeout(r, 20));

    // Persistence is coupled to clean client delivery: the server finalized, but
    // because the client never received the completed run, onComplete must NOT
    // fire. This pins the documented persist-on-clean-delivery semantic.
    assertEquals(completeCalls, 0);
  });
});
